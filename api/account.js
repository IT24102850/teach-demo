/**
 * /api/account  -  accounts for parents and students, and every password
 * flow (migration 008).
 *
 *   POST ?r=activate          phone + the invite code their teacher sent +
 *                             a password: first sign-up, another child, or
 *                             a forgotten password - all the same flow
 *   POST ?r=add_child         a signed-in parent adds another child's invite
 *   POST ?r=login             { who: 'parent', phone, password }
 *                             { who: 'student', username, password }
 *   GET  ?r=logins            a parent's children and their student logins
 *   POST ?r=student.create    a parent makes a child's own login
 *   POST ?r=student.password  ...sets a new password for it
 *   POST ?r=student.delete    ...or removes it
 *   POST ?r=password          anyone signed in changes their own password
 *   GET  ?r=sessions          the devices signed in to this account
 *   POST ?r=sessions.revoke   sign out every other device
 *   POST ?r=forgot            a teacher asks for a reset link by email
 *   POST ?r=reset             ...and sets a new password with it
 *
 * Every answer that could reveal whether an account exists is the same
 * either way. Wrong passwords are counted per address (login_attempts) and
 * per account (failed_logins, then a lock), so neither a single phone nor a
 * spread of addresses can guess for long.
 */

import * as db from './_lib/db.js';
import { bad, clientIp, guard, json, ok, readJson, resource } from './_lib/http.js';
import { toLkMobile } from './_lib/rules.js';
import {
  INVITE_DAYS,
  PASSWORD_MESSAGES,
  RESET_MINUTES,
  accountsReady,
  failurePatch,
  hashPassword,
  inviteLookup,
  listSessions,
  lockedFor,
  newResetToken,
  passwordProblem,
  readLoginSession,
  resetHash,
  revokeAllSessions,
  sameOrigin,
  startLoginSession,
  successPatch,
  verifyPassword,
} from './_lib/accounts.js';
import { familyAccess, familySummary } from './_lib/family-access.js';
import { resetEmail, sendEmail } from './_lib/email.js';

const MAX_FAILS = Number(process.env.LOGIN_MAX_ATTEMPTS || 8);
const WINDOW_MINUTES = Number(process.env.LOGIN_WINDOW_MINUTES || 15);
const RESETS_PER_HOUR = 5;

/** An error the app can translate: `code` is an i18n key, `error` the English. */
const fail = (res, status, code, error) => json(res, status, { error, code });

const tooMany = (res) =>
  fail(res, 429, 'too_many_tries_wait', `Too many tries. Please wait ${WINDOW_MINUTES} minutes and try again.`);

async function failuresFor(ip, role) {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
  const rows = await db.select('login_attempts', {
    select: 'id',
    ip: `eq.${ip}`,
    role: `eq.${role}`,
    ok: 'is.false',
    created_at: `gte.${since}`,
    limit: MAX_FAILS + 1,
  });
  return rows.length;
}

const logAttempt = (ip, role, success) =>
  db.insert('login_attempts', { ip, role, ok: success }, { returning: 'minimal' }).catch(() => {});

const passwordFail = (res, code) => fail(res, 400, code, PASSWORD_MESSAGES[code]);

const lockedFail = (res, minutes) =>
  fail(res, 423, 'account_locked', `Too many wrong passwords. Try again in ${minutes} minutes.`);

const cleanUsername = (value) => String(value || '').trim().toLowerCase();
const usernameOk = (u) => /^[a-z0-9][a-z0-9._]{2,29}$/.test(u);

const LANGS = ['en', 'si', 'ta'];

/* ------------------------------------------------------------- invites --- */

/**
 * Check an invite against the phone it was sent to, and claim it. Claiming
 * is one UPDATE ... WHERE used_at IS NULL, so two people racing with the same
 * code cannot both win.
 */
async function claimInvite(code, phone) {
  const digits = String(code || '').replace(/\D/g, '');
  if (digits.length !== 6) return null;
  const invite = await db.selectOne('account_invites', {
    select: 'id,teacher_id,student_id,phone,code_hash,expires_at,used_at',
    code_lookup: `eq.${inviteLookup(digits)}`,
  });
  if (!invite || invite.used_at || Date.parse(invite.expires_at) < Date.now()) return null;
  if (invite.phone !== phone) return null;
  if (!(await verifyPassword(digits, invite.code_hash)).ok) return null;
  const [claimed] = await db.update(
    'account_invites',
    { used_at: new Date().toISOString() },
    { id: `eq.${invite.id}`, used_at: 'is.null' },
  );
  return claimed ? invite : null;
}

const badInvite = (res) =>
  fail(
    res,
    401,
    'invite_bad',
    `That code did not work for this number, or it has expired. Codes last ${INVITE_DAYS} days - ask your teacher for a new one.`,
  );

const linkChild = (accountId, studentId) =>
  db.insert(
    'account_children',
    { account_id: accountId, student_id: studentId },
    { onConflict: 'account_id,student_id', returning: 'minimal' },
  );

/* --------------------------------------------------------------- handlers -- */

/**
 * Everything a parent does with an invite code, in one flow:
 *
 *   first time        makes their account and sets a password
 *   another child     links that child to the account they already have
 *   lost password     sets a new one
 *
 * The invite arrived on the parent's own WhatsApp, so holding it is the
 * proof - the same proof in all three cases. That is why an account that
 * already exists does not need its old password here: someone who forgot it
 * is exactly who this is for. Setting a password signs out every other device.
 */
async function activate(req, res, body) {
  const ip = clientIp(req);
  if ((await failuresFor(ip, 'activate')) >= MAX_FAILS) return tooMany(res);

  const phone = toLkMobile(body.phone);
  if (!phone) return fail(res, 400, 'tel_nine', 'Enter a Sri Lankan mobile number: 9 digits starting with 7');

  const existing = await db.selectOne('accounts', {
    select: 'id,display_name',
    kind: 'eq.parent',
    phone: `eq.${phone}`,
  });

  const name = String(body.name || '').trim() || existing?.display_name || '';
  if (name.length < 2) return fail(res, 400, 'enter_parent_name', "Please enter the parent's name");
  const problem = passwordProblem(body.password, { phone, name });
  if (problem) return passwordFail(res, problem);

  const invite = await claimInvite(body.code, phone);
  if (!invite) {
    await logAttempt(ip, 'activate', false);
    return badInvite(res);
  }

  const password_hash = await hashPassword(body.password);
  let accountId = existing?.id;
  if (existing) {
    await db.update(
      'accounts',
      { ...successPatch(), password_hash, password_changed_at: new Date().toISOString() },
      { id: `eq.${existing.id}` },
    );
    await revokeAllSessions('parent', existing.id);
  } else {
    const [account] = await db.insert('accounts', {
      kind: 'parent',
      phone,
      display_name: name.slice(0, 80),
      password_hash,
      lang: LANGS.includes(body.lang) ? body.lang : 'en',
      last_login_at: new Date().toISOString(),
    });
    accountId = account.id;
  }

  await linkChild(accountId, invite.student_id);
  await db.update('account_invites', { used_by: accountId }, { id: `eq.${invite.id}` });
  await logAttempt(ip, 'activate', true);
  await startLoginSession(req, res, 'parent', accountId);
  return ok(res, { ...(await familySummary(accountId)), created: !existing, existed: Boolean(existing) });
}

async function familyLogin(req, res, body) {
  const ip = clientIp(req);
  const who = body.who === 'student' ? 'student' : 'parent';
  if ((await failuresFor(ip, who)) >= MAX_FAILS) return tooMany(res);

  let account = null;
  if (who === 'parent') {
    const phone = toLkMobile(body.phone);
    if (!phone || !body.password) {
      return fail(res, 400, 'enter_phone_password', 'Enter your mobile number and password');
    }
    account = await db.selectOne('accounts', {
      select: 'id,kind,password_hash,failed_logins,locked_until',
      kind: 'eq.parent',
      phone: `eq.${phone}`,
    });
  } else {
    const username = cleanUsername(body.username);
    if (!username || !body.password) {
      return fail(res, 400, 'enter_username_password', 'Enter your username and password');
    }
    account = await db.selectOne('accounts', {
      select: 'id,kind,password_hash,failed_logins,locked_until',
      kind: 'eq.student',
      // Stored lowercased, so an exact match: `ilike` would treat _ as a wildcard.
      username: `eq.${username}`,
    });
  }

  if (account) {
    const minutes = lockedFor(account);
    if (minutes) return lockedFail(res, minutes);
  }

  // Hash even when there is no account, so the answer takes the same time.
  const check = await verifyPassword(body.password, account?.password_hash || 's2$12$00$00');
  if (!account || !check.ok) {
    if (account) await db.update('accounts', failurePatch(account), { id: `eq.${account.id}` });
    await logAttempt(ip, who, false);
    return fail(
      res,
      401,
      who === 'parent' ? 'phone_password_wrong' : 'username_password_wrong',
      who === 'parent'
        ? 'That mobile number and password did not work'
        : 'That username and password did not work',
    );
  }

  const patch = successPatch();
  if (check.rehash) patch.password_hash = await hashPassword(body.password);
  await db.update('accounts', patch, { id: `eq.${account.id}` });

  const summary = await familySummary(account.id);
  if (!summary) return fail(res, 403, 'no_children', 'This account is not linked to a student yet');

  await logAttempt(ip, who, true);
  await startLoginSession(req, res, who, account.id);
  return ok(res, summary);
}

/** A parent's own children, and the student login each one has (or not). */
async function logins(access) {
  const [children, students] = await Promise.all([
    db.select('students', {
      select: 'id,name,call_name,grade',
      id: db.inList(access.children),
      order: 'name.asc',
    }),
    db.select('accounts', {
      select: 'id,username,last_login_at,account_children(student_id)',
      kind: 'eq.student',
      parent_id: `eq.${access.accountId}`,
    }),
  ]);
  return children.map((c) => {
    const login = students.find((s) => (s.account_children || []).some((l) => l.student_id === c.id));
    return { ...c, login: login ? { username: login.username, last_login_at: login.last_login_at } : null };
  });
}

/** The student account a parent made for this child, or null. */
async function studentLoginFor(parentId, studentId) {
  const rows = await db.select('accounts', {
    select: 'id,username,account_children(student_id)',
    kind: 'eq.student',
    parent_id: `eq.${parentId}`,
  });
  return rows.find((s) => (s.account_children || []).some((l) => l.student_id === studentId)) || null;
}

/** The row behind any session, with what a password check needs. */
async function subjectRow(session) {
  if (session.kind === 'teacher') {
    const t = await db.selectOne('teachers', {
      select: 'id,name,email,phone,password_hash,password_salt',
      id: `eq.${session.sub}`,
    });
    return t && { table: 'teachers', ...t, about: { email: t.email, phone: t.phone, name: t.name } };
  }
  const a = await db.selectOne('accounts', {
    select: 'id,phone,username,display_name,password_hash',
    id: `eq.${session.sub}`,
  });
  return a && { table: 'accounts', ...a, about: { phone: a.phone, name: a.display_name } };
}

async function changePassword(req, res, body) {
  const session = await readLoginSession(req);
  if (!session) return fail(res, 401, 'log_in_again', 'Please sign in again');
  const row = await subjectRow(session);
  if (!row) return fail(res, 401, 'log_in_again', 'Please sign in again');

  const check = await verifyPassword(body.current, row.password_hash, row.password_salt || null);
  if (!check.ok) return fail(res, 401, 'current_password_wrong', 'Your current password is not right');
  const problem = passwordProblem(body.next, row.about);
  if (problem) return passwordFail(res, problem);

  const patch = { password_hash: await hashPassword(body.next), password_changed_at: new Date().toISOString() };
  if (row.table === 'teachers') patch.password_salt = null;
  await db.update(row.table, patch, { id: `eq.${row.id}` });
  // Every other device has to sign in again with the new password.
  await revokeAllSessions(session.kind, row.id, session.id);
  return ok(res, { changed: true });
}

/* --------------------------------------------- a teacher's lost password -- */

const appUrl = (req) => (process.env.APP_URL || `https://${req.headers.host}`).replace(/\/+$/, '');

async function forgot(req, res, body) {
  const ip = clientIp(req);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const recent = await db.select('login_attempts', {
    select: 'id',
    ip: `eq.${ip}`,
    role: 'eq.forgot',
    created_at: `gte.${since}`,
    limit: RESETS_PER_HOUR + 1,
  });
  if (recent.length >= RESETS_PER_HOUR) return tooMany(res);
  await logAttempt(ip, 'forgot', true);

  // The same answer whether or not the email has an account.
  const sent = { sent: true, minutes: RESET_MINUTES };
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return ok(res, sent);

  const teacher = await db.selectOne('teachers', {
    select: 'id,name,title,email,lang,suspended_at',
    email: `eq.${email}`,
  });
  if (!teacher || teacher.suspended_at) return ok(res, sent);

  // Three links an hour per teacher, however many addresses ask.
  const issued = await db.select('password_resets', {
    select: 'id',
    teacher_id: `eq.${teacher.id}`,
    created_at: `gte.${since}`,
    limit: 4,
  });
  if (issued.length >= 3) return ok(res, sent);

  const token = newResetToken();
  await db.insert(
    'password_resets',
    {
      teacher_id: teacher.id,
      token_hash: resetHash(token),
      expires_at: new Date(Date.now() + RESET_MINUTES * 60_000).toISOString(),
      ip: ip.slice(0, 64),
    },
    { returning: 'minimal' },
  );
  const mail = resetEmail({
    name: teacher.name,
    link: `${appUrl(req)}/?reset=${token}`,
    minutes: RESET_MINUTES,
    lang: teacher.lang,
  });
  const result = await sendEmail({ to: teacher.email, ...mail });
  if (result.status !== 'sent') console.error('[forgot] reset email not sent:', result.status);
  return ok(res, sent);
}

async function reset(req, res, body) {
  const ip = clientIp(req);
  if ((await failuresFor(ip, 'reset')) >= MAX_FAILS) return tooMany(res);

  const token = String(body.token || '');
  const row = token
    ? await db.selectOne('password_resets', {
        select: 'id,teacher_id,expires_at,used_at',
        token_hash: `eq.${resetHash(token)}`,
      })
    : null;
  if (!row || row.used_at || Date.parse(row.expires_at) < Date.now()) {
    await logAttempt(ip, 'reset', false);
    return fail(res, 400, 'reset_link_bad', 'This link has expired or was already used. Ask for a new one.');
  }

  const teacher = await db.selectOne('teachers', {
    select: 'id,name,email,phone,suspended_at',
    id: `eq.${row.teacher_id}`,
  });
  if (!teacher || teacher.suspended_at) {
    return fail(res, 400, 'reset_link_bad', 'This link has expired or was already used. Ask for a new one.');
  }
  const problem = passwordProblem(body.password, { email: teacher.email, phone: teacher.phone, name: teacher.name });
  if (problem) return passwordFail(res, problem);

  const [claimed] = await db.update(
    'password_resets',
    { used_at: new Date().toISOString() },
    { id: `eq.${row.id}`, used_at: 'is.null' },
  );
  if (!claimed) return fail(res, 400, 'reset_link_bad', 'This link has expired or was already used. Ask for a new one.');

  await db.update(
    'teachers',
    {
      password_hash: await hashPassword(body.password),
      password_salt: null,
      password_changed_at: new Date().toISOString(),
      failed_logins: 0,
      locked_until: null,
    },
    { id: `eq.${teacher.id}` },
  );
  // Whoever had the old password is out, on every device.
  await revokeAllSessions('teacher', teacher.id);
  await logAttempt(ip, 'reset', true);
  await startLoginSession(req, res, 'teacher', teacher.id);
  return ok(res, { reset: true });
}

/* ------------------------------------------------------------------ route -- */

export default guard(async (req, res) => {
  if (!db.configured || !accountsReady) return bad(res, 'The server is not set up for sign-in yet', 503);
  const r = resource(req);

  if (req.method === 'GET') {
    if (r === 'logins') {
      const access = await familyAccess(req);
      if (!access || access.kind !== 'parent') return fail(res, 403, 'parents_only', 'Only a parent can do this');
      return ok(res, { children: await logins(access) });
    }
    if (r === 'sessions') {
      const session = await readLoginSession(req);
      if (!session) return fail(res, 401, 'log_in_again', 'Please sign in again');
      const rows = await listSessions(session.kind, session.sub);
      return ok(res, { sessions: rows.map((s) => ({ ...s, current: s.id === session.id })) });
    }
    return bad(res, 'Unknown request', 404);
  }

  if (req.method !== 'POST') return bad(res, 'Use POST', 405);
  if (!sameOrigin(req)) return bad(res, 'Cross-site request refused', 403);
  const body = await readJson(req);

  switch (r) {
    case 'activate':
      return activate(req, res, body);
    case 'login':
      return familyLogin(req, res, body);
    case 'forgot':
      return forgot(req, res, body);
    case 'reset':
      return reset(req, res, body);
    case 'password':
      return changePassword(req, res, body);

    case 'sessions.revoke': {
      const session = await readLoginSession(req);
      if (!session) return fail(res, 401, 'log_in_again', 'Please sign in again');
      await revokeAllSessions(session.kind, session.sub, session.id);
      return ok(res, { revoked: true });
    }

    case 'add_child': {
      const access = await familyAccess(req);
      if (!access || access.kind !== 'parent') return fail(res, 403, 'parents_only', 'Only a parent can do this');
      const ip = clientIp(req);
      if ((await failuresFor(ip, 'activate')) >= MAX_FAILS) return tooMany(res);
      const me = await db.selectOne('accounts', { select: 'id,phone', id: `eq.${access.accountId}` });
      const invite = await claimInvite(body.code, me?.phone);
      if (!invite) {
        await logAttempt(ip, 'activate', false);
        return badInvite(res);
      }
      await linkChild(access.accountId, invite.student_id);
      await db.update('account_invites', { used_by: access.accountId }, { id: `eq.${invite.id}` });
      await logAttempt(ip, 'activate', true);
      return ok(res, await familySummary(access.accountId));
    }

    case 'student.create': {
      const access = await familyAccess(req);
      if (!access || access.kind !== 'parent') return fail(res, 403, 'parents_only', 'Only a parent can do this');
      const studentId = String(body.student_id || '');
      if (!access.children.includes(studentId)) return fail(res, 403, 'not_your_child', 'Not your child');
      if (await studentLoginFor(access.accountId, studentId)) {
        return fail(res, 409, 'student_login_exists', 'This child already has a login. Set a new password instead.');
      }
      const username = cleanUsername(body.username);
      if (!usernameOk(username)) {
        return fail(res, 400, 'username_rule', 'A username is 3-30 letters, numbers, dots or underscores');
      }
      const taken = await db.selectOne('accounts', { select: 'id', username: `eq.${username}` });
      if (taken) return fail(res, 409, 'username_taken', 'That username is taken. Try another.');
      const child = await db.selectOne('students', { select: 'id,name,call_name', id: `eq.${studentId}` });
      const problem = passwordProblem(body.password, { name: child?.name });
      if (problem) return passwordFail(res, problem);

      const [account] = await db.insert('accounts', {
        kind: 'student',
        username,
        display_name: child?.call_name || child?.name || username,
        password_hash: await hashPassword(body.password),
        parent_id: access.accountId,
        lang: access.lang || 'en',
      });
      await linkChild(account.id, studentId);
      return ok(res, { created: true, username });
    }

    case 'student.password': {
      const access = await familyAccess(req);
      if (!access || access.kind !== 'parent') return fail(res, 403, 'parents_only', 'Only a parent can do this');
      const login = await studentLoginFor(access.accountId, String(body.student_id || ''));
      if (!login) return fail(res, 404, 'no_student_login', 'This child has no login yet');
      const problem = passwordProblem(body.password, {});
      if (problem) return passwordFail(res, problem);
      await db.update(
        'accounts',
        { password_hash: await hashPassword(body.password), failed_logins: 0, locked_until: null, password_changed_at: new Date().toISOString() },
        { id: `eq.${login.id}` },
      );
      await revokeAllSessions('student', login.id);
      return ok(res, { changed: true });
    }

    case 'student.delete': {
      const access = await familyAccess(req);
      if (!access || access.kind !== 'parent') return fail(res, 403, 'parents_only', 'Only a parent can do this');
      const login = await studentLoginFor(access.accountId, String(body.student_id || ''));
      if (!login) return fail(res, 404, 'no_student_login', 'This child has no login yet');
      await revokeAllSessions('student', login.id);
      await db.remove('accounts', { id: `eq.${login.id}`, parent_id: `eq.${access.accountId}` });
      return ok(res, { deleted: true });
    }

    default:
      return bad(res, 'Unknown request', 404);
  }
});
