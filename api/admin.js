/**
 * /api/admin  -  the owner's dashboard.
 *
 *   POST ?r=setup.start     { token }                     a one-time setup link was opened
 *   POST ?r=setup.finish    { token, password, code }     password + authenticator set
 *   POST ?r=login           { email, password, code }     code: 6 digits, or a recovery code
 *   POST ?r=logout
 *   GET  ?r=me | overview | teachers | teacher&id= | audit&before= | security
 *   POST ?r=teacher.suspend | teacher.restore | teacher.plus | teacher.code
 *   POST ?r=password | recovery.regen | session.revoke | sessions.revoke_others
 *
 * How it is protected, outermost first:
 *
 *  1. It does not exist unless ADMIN_SECRET_KEY is set (404), and if
 *     ADMIN_ALLOWED_IPS is set, it does not exist for anyone else either.
 *  2. Every request carries a header no other site can make a browser send,
 *     and where the browser names the origin it must be this one.
 *  3. There is no sign-up. An account is made by a developer with
 *     `npm run admin:invite`, which prints a link that works once, for 24 hours.
 *  4. Signing in takes the password AND a 6-digit authenticator code in one
 *     step, so a guesser never learns that the password alone was right. Five
 *     failures from one address in 15 minutes stop that address; ten against
 *     one account lock it for 15 minutes.
 *  5. The session is a random token in a __Host- cookie, SameSite=Strict,
 *     HttpOnly. The database keeps only a keyed hash of it. It ends after 30
 *     idle minutes or 12 hours, whichever comes first, and can be revoked.
 *  6. Anything that changes something - pausing a teacher, a price, a login
 *     code - needs a fresh authenticator code, not just the session.
 *  7. Everything is written to admin_audit first, and the database refuses to
 *     edit or delete that table.
 *
 * The owner sees teachers and the business. No child's name, no parent's
 * phone number and no mark ever leaves this function.
 */

import * as db from './_lib/db.js';
import { bad, guard, ok, query, readJson, resource } from './_lib/http.js';
import {
  adminCookie,
  adminEnabled,
  adminIp,
  clearAdminCookie,
  hardenHeaders,
  hashPassword,
  ipAllowed,
  newRecoveryCodes,
  newToken,
  newTotpSecret,
  otpauthUri,
  passwordProblem,
  recoveryHash,
  sameOrigin,
  seal,
  sessionHash,
  setAdminCookie,
  setupHash,
  unseal,
  verifyPassword,
  verifyTotp,
} from './_lib/admin-security.js';
import { forgetTeacher } from './_lib/active.js';
import { freeCode } from './_lib/codes.js';
import { codeLookup, hashCode } from './_lib/session.js';

const clamp = (n, lo, hi, fallback) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
};

const IDLE_MS = clamp(process.env.ADMIN_IDLE_MINUTES, 5, 120, 30) * 60_000;
const MAX_MS = clamp(process.env.ADMIN_MAX_HOURS, 1, 24, 12) * 3_600_000;
const WINDOW_MINUTES = 15;
const IP_MAX_FAILS = 5;
const ACCOUNT_MAX_FAILS = 10;
const ACCOUNT_LOCK_MS = 15 * 60_000;

const ADMIN_FIELDS =
  'id,email,name,role,password_hash,totp_secret,totp_last_step,disabled_at,' +
  'last_login_at,last_login_ip,failed_count,locked_until';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{40,60}$/;

const notFound = (res) => bad(res, 'Not found', 404);
const nowIso = () => new Date().toISOString();
const userAgent = (req) => String(req.headers['user-agent'] || '').slice(0, 200);
const cleanEmail = (v) => String(v || '').trim().toLowerCase().slice(0, 200);
const publicAdmin = (a) => ({ id: a.id, email: a.email, name: a.name || null, role: a.role });

/* ------------------------------------------------------------------ audit -- */

/**
 * Written before the thing it describes, and not swallowed: if the record
 * cannot be written, the action does not happen.
 */
function audit(req, who, action, { target = null, ok: success = true, detail = null } = {}) {
  return db.insert(
    'admin_audit',
    {
      admin_id: who?.id ?? null,
      email: who?.email ? String(who.email).slice(0, 200) : null,
      action,
      target: target === null ? null : String(target).slice(0, 200),
      ok: success,
      ip: adminIp(req),
      user_agent: userAgent(req),
      detail,
    },
    { returning: 'minimal' },
  );
}

/* --------------------------------------------------------- rate limiting -- */

async function ipFailures(ip) {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
  const rows = await db.select('login_attempts', {
    select: 'id',
    ip: `eq.${ip}`,
    role: 'eq.admin',
    ok: 'is.false',
    created_at: `gte.${since}`,
    limit: IP_MAX_FAILS + 1,
  });
  return rows.length;
}

const logAttempt = (ip, success) =>
  db.insert('login_attempts', { ip, role: 'admin', ok: success }, { returning: 'minimal' });

const tooMany = (res) =>
  bad(res, `Too many attempts from here. Wait ${WINDOW_MINUTES} minutes and try again.`, 429);

/* --------------------------------------------------------------- sessions -- */

async function loadSession(req) {
  const token = adminCookie(req);
  if (!token) return null;
  const session = await db.selectOne('admin_sessions', {
    select: 'id,admin_id,created_at,last_seen_at,expires_at,revoked_at,ip,user_agent',
    token_hash: `eq.${sessionHash(token)}`,
  });
  if (!session || session.revoked_at) return null;

  const now = Date.now();
  if (Date.parse(session.expires_at) <= now) return null;
  if (Date.parse(session.last_seen_at) + IDLE_MS <= now) {
    await db.update('admin_sessions', { revoked_at: nowIso() }, { id: `eq.${session.id}` });
    return null;
  }

  const admin = await db.selectOne('admins', { select: ADMIN_FIELDS, id: `eq.${session.admin_id}` });
  if (!admin || admin.disabled_at || !admin.password_hash || !admin.totp_secret) return null;

  // Sliding idle window, written at most once a minute.
  if (now - Date.parse(session.last_seen_at) > 60_000) {
    await db.update('admin_sessions', { last_seen_at: nowIso() }, { id: `eq.${session.id}` });
    session.last_seen_at = nowIso();
  }
  return { session, admin };
}

async function startAdminSession(req, res, admin, ip) {
  const token = newToken();
  await db.insert(
    'admin_sessions',
    {
      admin_id: admin.id,
      token_hash: sessionHash(token),
      ip,
      user_agent: userAgent(req),
      last_seen_at: nowIso(),
      expires_at: new Date(Date.now() + MAX_MS).toISOString(),
    },
    { returning: 'minimal' },
  );
  setAdminCookie(res, token, Math.floor(MAX_MS / 1000));
}

const revokeSessions = (adminId, exceptId = null) =>
  db.update(
    'admin_sessions',
    { revoked_at: nowIso() },
    { admin_id: `eq.${adminId}`, revoked_at: 'is.null', ...(exceptId ? { id: `neq.${exceptId}` } : {}) },
  );

/**
 * A fresh authenticator code for anything that changes something. A session
 * left open on a desk is not enough to pause a teacher.
 */
async function stepUp(req, res, ctx, code, ip) {
  if ((await ipFailures(ip)) >= IP_MAX_FAILS) {
    await revokeSessions(ctx.admin.id);
    clearAdminCookie(res);
    tooMany(res);
    return false;
  }
  const secret = unseal(ctx.admin.totp_secret, ctx.admin.id);
  const step = verifyTotp(secret, code, ctx.admin.totp_last_step);
  if (step === null) {
    await logAttempt(ip, false);
    await audit(req, ctx.admin, 'stepup.failed', { ok: false });
    bad(res, 'That code did not work. If you have just used it, wait for the next one.', 403);
    return false;
  }
  await db.update('admins', { totp_last_step: step }, { id: `eq.${ctx.admin.id}` });
  ctx.admin.totp_last_step = step;
  return true;
}

async function replaceRecoveryCodes(adminId) {
  const codes = newRecoveryCodes();
  await db.remove('admin_recovery_codes', { admin_id: `eq.${adminId}` });
  await db.insert(
    'admin_recovery_codes',
    codes.map((c) => ({ admin_id: adminId, code_hash: recoveryHash(c) })),
    { returning: 'minimal' },
  );
  return codes;
}

async function recoveryLeft(adminId) {
  const rows = await db.select('admin_recovery_codes', {
    select: 'id',
    admin_id: `eq.${adminId}`,
    used_at: 'is.null',
  });
  return rows.length;
}

/* ------------------------------------------------------- setup and login -- */

async function setupAdmin(token) {
  if (!TOKEN.test(String(token || ''))) return null;
  const admin = await db.selectOne('admins', {
    select: 'id,email,name,role,setup_expires_at,totp_pending,disabled_at',
    setup_token_hash: `eq.${setupHash(token)}`,
  });
  if (!admin || admin.disabled_at) return null;
  if (!admin.setup_expires_at || Date.parse(admin.setup_expires_at) <= Date.now()) return null;
  return admin;
}

const BAD_LINK = 'This setup link is not valid or has expired. Ask for a new one.';

async function setupStart(req, res, body, ip) {
  if ((await ipFailures(ip)) >= IP_MAX_FAILS) return tooMany(res);
  const admin = await setupAdmin(body.token);
  if (!admin) {
    await logAttempt(ip, false);
    await audit(req, null, 'setup.failed', { ok: false });
    return bad(res, BAD_LINK, 404);
  }
  // A new secret each time the page is opened; only the one confirmed with a
  // code is ever kept.
  const secret = newTotpSecret();
  await db.update('admins', { totp_pending: seal(secret, admin.id) }, { id: `eq.${admin.id}` });
  await audit(req, admin, 'setup.started');
  return ok(res, { email: admin.email, name: admin.name, secret, uri: otpauthUri(admin.email, secret) });
}

async function setupFinish(req, res, body, ip) {
  if ((await ipFailures(ip)) >= IP_MAX_FAILS) return tooMany(res);
  const admin = await setupAdmin(body.token);
  if (!admin) {
    await logAttempt(ip, false);
    return bad(res, BAD_LINK, 404);
  }

  const problem = passwordProblem(body.password, admin.email);
  if (problem) return bad(res, problem);

  const secret = unseal(admin.totp_pending, admin.id);
  const step = verifyTotp(secret, body.code, null);
  if (step === null) {
    await logAttempt(ip, false);
    return bad(res, 'That code did not match. Check the time on your phone and try the newest code.');
  }

  await audit(req, admin, 'setup.done');
  await db.update(
    'admins',
    {
      password_hash: await hashPassword(body.password),
      totp_secret: admin.totp_pending,
      totp_pending: null,
      totp_last_step: step,
      setup_token_hash: null,
      setup_expires_at: null,
      failed_count: 0,
      locked_until: null,
    },
    { id: `eq.${admin.id}` },
  );
  // A setup link also serves as the reset when a phone is lost: whoever held
  // a session before it is signed out.
  await revokeSessions(admin.id);
  const codes = await replaceRecoveryCodes(admin.id);
  return ok(res, { email: admin.email, recovery_codes: codes });
}

const LOGIN_FAILED = 'Sign-in failed. Check your email, password and code.';

async function login(req, res, body, ip) {
  const email = cleanEmail(body.email);
  const password = String(body.password || '').slice(0, 200);
  const code = String(body.code || '').trim().slice(0, 40);
  if (!email || !password || !code) return bad(res, 'Enter your email, password and code.');

  if ((await ipFailures(ip)) >= IP_MAX_FAILS) {
    await audit(req, { email }, 'login.blocked', { ok: false });
    return tooMany(res);
  }

  const admin = await db.selectOne('admins', { select: ADMIN_FIELDS, email: `eq.${email}` });
  // Always spends the full scrypt cost, account or not.
  const passwordOk = await verifyPassword(password, admin?.password_hash);
  const secret = admin?.totp_secret ? unseal(admin.totp_secret, admin.id) : null;

  let step = null;
  let recoveryId = null;
  if (/^\d{6}$/.test(code.replace(/\s/g, ''))) {
    step = verifyTotp(secret, code, admin?.totp_last_step);
  } else if (admin && passwordOk) {
    const row = await db.selectOne('admin_recovery_codes', {
      select: 'id',
      admin_id: `eq.${admin.id}`,
      code_hash: `eq.${recoveryHash(code)}`,
      used_at: 'is.null',
    });
    recoveryId = row?.id ?? null;
  }

  const locked = Boolean(admin?.locked_until && Date.parse(admin.locked_until) > Date.now());
  const good = Boolean(
    admin && !admin.disabled_at && !locked && passwordOk && secret && (step !== null || recoveryId),
  );

  if (!good) {
    await logAttempt(ip, false);
    if (admin) {
      const count = (admin.failed_count || 0) + 1;
      await db.update(
        'admins',
        count >= ACCOUNT_MAX_FAILS
          ? { failed_count: 0, locked_until: new Date(Date.now() + ACCOUNT_LOCK_MS).toISOString() }
          : { failed_count: count },
        { id: `eq.${admin.id}` },
      );
    }
    const reason = !admin
      ? 'unknown email'
      : admin.disabled_at
        ? 'disabled'
        : locked
          ? 'locked'
          : !passwordOk
            ? 'password'
            : 'code';
    await audit(req, admin ? publicAdmin(admin) : { email }, 'login.failed', { ok: false, detail: { reason } });
    return bad(res, LOGIN_FAILED, 401);
  }

  if (recoveryId) {
    // Conditional on still being unused, so two racing requests cannot both spend it.
    const spent = await db.update(
      'admin_recovery_codes',
      { used_at: nowIso() },
      { id: `eq.${recoveryId}`, used_at: 'is.null' },
    );
    if (!Array.isArray(spent) || !spent.length) return bad(res, LOGIN_FAILED, 401);
  }

  await audit(req, admin, 'login.ok', { detail: recoveryId ? { recovery_code: true } : null });
  await logAttempt(ip, true);
  await db.update(
    'admins',
    {
      failed_count: 0,
      locked_until: null,
      last_login_at: nowIso(),
      last_login_ip: ip,
      ...(step !== null ? { totp_last_step: step } : {}),
    },
    { id: `eq.${admin.id}` },
  );
  await startAdminSession(req, res, admin, ip);

  return ok(res, {
    admin: publicAdmin(admin),
    previous: { at: admin.last_login_at || null, ip: admin.last_login_ip || null },
    recovery_left: recoveryId ? await recoveryLeft(admin.id) : undefined,
  });
}

/* -------------------------------------------------------- teacher actions -- */

async function mustTeacher(id) {
  if (!UUID.test(String(id || ''))) return null;
  return db.selectOne('teachers', { select: 'id,name,title,suspended_at', id: `eq.${id}` });
}

const teacherLabel = (t) => `${t.title ? `${t.title} ` : ''}${t.name} (${t.id})`;

/**
 * What is wrong with the request, checked before the authenticator code is
 * spent - a typo in the reason should not cost the owner a code.
 */
function teacherActionProblem(r, body, teacher) {
  if (r === 'teacher.suspend') {
    if (String(body.reason || '').trim().length < 3) return ['Say why, so the record explains it later.', 400];
    if (teacher.suspended_at) return ['That teacher is already paused.', 409];
  }
  if (r === 'teacher.restore' && !teacher.suspended_at) return ['That teacher is not paused.', 409];
  if (r === 'teacher.plus') {
    const price = Number(body.price);
    const share = Number(body.share);
    if (!(body.price !== '' && Number.isFinite(price) && price >= 0 && price <= 100_000)) {
      return ['The price must be between 0 and 100,000 rupees.', 400];
    }
    if (!(body.share !== '' && Number.isFinite(share) && share >= 0 && share <= 1)) {
      return ["The teacher's share must be between 0% and 100%.", 400];
    }
  }
  return null;
}

async function teacherAction(req, res, ctx, r, body, teacher) {
  const target = teacherLabel(teacher);

  switch (r) {
    case 'teacher.suspend': {
      const reason = String(body.reason || '').trim().slice(0, 300);
      await audit(req, ctx.admin, r, { target, detail: { reason } });
      await db.update(
        'teachers',
        { suspended_at: nowIso(), suspended_reason: reason },
        { id: `eq.${teacher.id}` },
      );
      forgetTeacher(teacher.id);
      return ok(res, { suspended: true });
    }

    case 'teacher.restore': {
      await audit(req, ctx.admin, r, { target });
      await db.update('teachers', { suspended_at: null, suspended_reason: null }, { id: `eq.${teacher.id}` });
      forgetTeacher(teacher.id);
      return ok(res, { suspended: false });
    }

    case 'teacher.plus': {
      const price = Number(body.price);
      const share = Number(body.share);
      const patch = { plus_price: Math.round(price * 100) / 100, plus_share: Math.round(share * 1000) / 1000 };
      await audit(req, ctx.admin, r, { target, detail: patch });
      await db.update('teachers', patch, { id: `eq.${teacher.id}` });
      return ok(res, patch);
    }

    case 'teacher.code': {
      const code = await freeCode();
      const { hash, salt } = hashCode(code);
      // The code itself is never written to the log; only that one was issued.
      await audit(req, ctx.admin, r, { target });
      await db.update(
        'teachers',
        { code_lookup: codeLookup(code), code_hash: hash, code_salt: salt },
        { id: `eq.${teacher.id}` },
      );
      return ok(res, { code });
    }

    default:
      return notFound(res);
  }
}

/* ------------------------------------------------------------- the router -- */

export default guard(async (req, res) => {
  hardenHeaders(res);

  // Off, and silent about why, unless the key is set and the address allowed.
  if (!adminEnabled || !db.configured) return notFound(res);
  const ip = adminIp(req);
  if (!ipAllowed(ip)) return notFound(res);

  if (req.method !== 'GET' && req.method !== 'POST') return bad(res, 'Use GET or POST', 405);
  if (!sameOrigin(req)) return bad(res, 'Forbidden', 403);

  const r = resource(req);
  const body = req.method === 'POST' ? await readJson(req) : {};

  if (req.method === 'POST') {
    if (r === 'setup.start') return setupStart(req, res, body, ip);
    if (r === 'setup.finish') return setupFinish(req, res, body, ip);
    if (r === 'login') return login(req, res, body, ip);
    if (r === 'logout') {
      const ctx = await loadSession(req);
      if (ctx) {
        await audit(req, ctx.admin, 'logout');
        await db.update('admin_sessions', { revoked_at: nowIso() }, { id: `eq.${ctx.session.id}` });
      }
      clearAdminCookie(res);
      return ok(res, { admin: null });
    }
  }

  const ctx = await loadSession(req);
  if (!ctx) {
    clearAdminCookie(res);
    if (r === 'me') return ok(res, { admin: null });
    return bad(res, 'Please sign in again.', 401);
  }
  const { admin, session } = ctx;

  if (req.method === 'GET') {
    switch (r) {
      case 'me':
        return ok(res, {
          admin: publicAdmin(admin),
          session: { created_at: session.created_at, expires_at: session.expires_at },
          idle_minutes: IDLE_MS / 60_000,
        });

      case 'overview':
        return ok(res, { overview: await db.rpc('admin_overview', {}) });

      case 'teachers':
        return ok(res, { teachers: (await db.rpc('admin_teachers', {})) || [] });

      case 'teacher': {
        const { id } = query(req);
        if (!UUID.test(String(id || ''))) return bad(res, 'Teacher not found', 404);
        const detail = await db.rpc('admin_teacher', { p_id: id });
        if (!detail) return bad(res, 'Teacher not found', 404);
        return ok(res, detail);
      }

      case 'audit': {
        const { before } = query(req);
        const rows = await db.select('admin_audit', {
          select: 'id,email,action,target,ok,ip,user_agent,detail,created_at',
          order: 'id.desc',
          limit: 50,
          ...(/^\d+$/.test(String(before || '')) ? { id: `lt.${before}` } : {}),
        });
        return ok(res, { audit: rows, more: rows.length === 50 });
      }

      case 'security': {
        const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
        const [sessions, failed, left] = await Promise.all([
          db.select('admin_sessions', {
            select: 'id,ip,user_agent,created_at,last_seen_at,expires_at',
            admin_id: `eq.${admin.id}`,
            revoked_at: 'is.null',
            expires_at: `gt.${nowIso()}`,
            order: 'last_seen_at.desc',
          }),
          db.select('login_attempts', {
            select: 'ip,role,created_at',
            ok: 'is.false',
            created_at: `gte.${since}`,
            order: 'created_at.desc',
            limit: 100,
          }),
          recoveryLeft(admin.id),
        ]);
        const idleCutoff = Date.now() - IDLE_MS;
        return ok(res, {
          sessions: sessions
            .filter((s) => Date.parse(s.last_seen_at) > idleCutoff)
            .map((s) => ({ ...s, current: s.id === session.id })),
          failed_logins: failed,
          recovery_left: left,
        });
      }

      default:
        return notFound(res);
    }
  }

  /* POST, signed in. Every one of these is about the admin's own account,
     or changes something and so needs a fresh code. */
  switch (r) {
    case 'session.revoke': {
      if (!UUID.test(String(body.id || ''))) return bad(res, 'Session not found', 404);
      await audit(req, admin, r, { target: body.id });
      await db.update(
        'admin_sessions',
        { revoked_at: nowIso() },
        { id: `eq.${body.id}`, admin_id: `eq.${admin.id}` },
      );
      if (body.id === session.id) clearAdminCookie(res);
      return ok(res, { revoked: true });
    }

    case 'sessions.revoke_others': {
      await audit(req, admin, r);
      await revokeSessions(admin.id, session.id);
      return ok(res, { revoked: true });
    }

    case 'password': {
      if (!(await verifyPassword(String(body.current || '').slice(0, 200), admin.password_hash))) {
        await logAttempt(ip, false);
        await audit(req, admin, 'password.failed', { ok: false });
        return bad(res, 'Your current password is not right.', 403);
      }
      const problem = passwordProblem(body.next, admin.email);
      if (problem) return bad(res, problem);
      if (!(await stepUp(req, res, ctx, body.code, ip))) return undefined;
      await audit(req, admin, 'password.changed');
      await db.update('admins', { password_hash: await hashPassword(body.next) }, { id: `eq.${admin.id}` });
      await revokeSessions(admin.id, session.id);
      return ok(res, { changed: true });
    }

    case 'recovery.regen': {
      if (!(await stepUp(req, res, ctx, body.code, ip))) return undefined;
      await audit(req, admin, r);
      return ok(res, { recovery_codes: await replaceRecoveryCodes(admin.id) });
    }

    case 'teacher.suspend':
    case 'teacher.restore':
    case 'teacher.plus':
    case 'teacher.code': {
      if (admin.role !== 'owner') return bad(res, 'Your account can look but not change anything.', 403);
      const teacher = await mustTeacher(body.id);
      if (!teacher) return bad(res, 'Teacher not found', 404);
      const problem = teacherActionProblem(r, body, teacher);
      if (problem) return bad(res, problem[0], problem[1]);
      if (!(await stepUp(req, res, ctx, body.code, ip))) return undefined;
      return teacherAction(req, res, ctx, r, body, teacher);
    }

    default:
      return notFound(res);
  }
});
