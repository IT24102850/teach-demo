/**
 * /api/auth  -  who is signed in, and the teacher's own sign-in.
 *
 *   GET  ?r=config   what the sign-in screen needs before anyone types
 *   GET  ?r=me       the current session, so a reload stays signed in
 *   POST ?r=login    a teacher: { email, password }, or { role: 'teacher', code }
 *   POST ?r=signup   a teacher makes their own account
 *   POST ?r=logout   ends this device's session on the server
 *
 * Parents and students sign in through /api/account (migration 008); the old
 * shared family code is retired, and saying so is all this file does with it.
 *
 * Every session is a row in login_sessions, so it can be listed and ended.
 * Wrong answers are counted per address here and per teacher on their row,
 * so neither a single phone nor a spread of addresses can guess for long.
 */

import * as db from './_lib/db.js';
import { bad, clientIp, guard, json, ok, readJson, resource } from './_lib/http.js';
import { codeLookup, secretsReady, verifyCode } from './_lib/session.js';
import { toLkMobile } from './_lib/rules.js';
import { SUSPENDED_MESSAGE } from './_lib/active.js';
import {
  PASSWORD_MESSAGES,
  endLoginSession,
  failurePatch,
  hashPassword,
  lockedFor,
  passwordProblem,
  readLoginSession,
  sameOrigin,
  startLoginSession,
  verifyPassword,
} from './_lib/accounts.js';
import { familySummary } from './_lib/family-access.js';

const SIGNUPS_PER_HOUR = Number(process.env.SIGNUP_MAX_PER_HOUR || 10);

const cleanEmail = (value) => String(value || '').trim().toLowerCase();
const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

const MAX_FAILS = Number(process.env.LOGIN_MAX_ATTEMPTS || 8);
const WINDOW_MINUTES = Number(process.env.LOGIN_WINDOW_MINUTES || 15);
const CODE_LENGTH = Number(process.env.CODE_LENGTH || 4);

/** An error the app can translate: `code` is an i18n key, `error` the English. */
const fail = (res, status, code, error) => json(res, status, { error, code });

async function failuresFor(ip) {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
  const rows = await db.select('login_attempts', {
    select: 'id',
    ip: `eq.${ip}`,
    ok: 'is.false',
    created_at: `gte.${since}`,
    limit: MAX_FAILS + 1,
  });
  return rows.length;
}

const logAttempt = (ip, role, success) =>
  db.insert('login_attempts', { ip, role, ok: success }, { returning: 'minimal' }).catch(() => {});

const tooMany = (res) =>
  fail(res, 429, 'too_many_tries_wait', `Too many tries. Please wait ${WINDOW_MINUTES} minutes and try again.`);

const lockedFail = (res, minutes) =>
  fail(res, 423, 'account_locked', `Too many wrong passwords. Try again in ${minutes} minutes.`);

/**
 * A good sign-in: the per-teacher counter is cleared, and the owner can see
 * when this teacher last used the app.
 */
const touchTeacher = (id, extra = {}) =>
  db
    .update(
      'teachers',
      { failed_logins: 0, locked_until: null, last_login_at: new Date().toISOString(), ...extra },
      { id: `eq.${id}` },
    )
    .catch(() => {});

const TEACHER_FIELDS =
  'id,name,title,email,password_hash,password_salt,suspended_at,failed_logins,locked_until';

/** Shared by both teacher paths once the teacher row is found. */
async function finishTeacher(req, res, ip, teacher, ok, rehashWith = null) {
  if (!ok) {
    await db.update('teachers', failurePatch(teacher), { id: `eq.${teacher.id}` }).catch(() => {});
    await logAttempt(ip, 'teacher', false);
    return null;
  }
  // Told only after the secret was right, so it reveals nothing to a guesser.
  if (teacher.suspended_at) {
    json(res, 403, { error: SUSPENDED_MESSAGE, code: 'account_paused' });
    return false;
  }
  await logAttempt(ip, 'teacher', true);
  const extra = rehashWith ? { password_hash: await hashPassword(rehashWith), password_salt: null } : {};
  await touchTeacher(teacher.id, extra);
  await startLoginSession(req, res, 'teacher', teacher.id);
  return true;
}

/**
 * Sign in as a teacher with an email and a password. The same answer
 * whether the email is unknown or the password is wrong - telling them apart
 * would hand an attacker a list of who has an account here.
 */
async function loginWithPassword(req, res, body, ip) {
  const email = cleanEmail(body.email);
  const password = String(body.password || '');
  if (!email || !password) return fail(res, 400, 'enter_email_password', 'Enter your email and password');

  const teacher = await db.selectOne('teachers', { select: TEACHER_FIELDS, email: `eq.${email}` });
  if (teacher) {
    const minutes = lockedFor(teacher);
    if (minutes) return lockedFail(res, minutes);
  }
  // Hash even when there is no such teacher, so the answer takes the same time.
  const check = await verifyPassword(
    password,
    teacher?.password_hash || 's2$12$00$00',
    teacher?.password_salt || null,
  );
  const done = teacher ? await finishTeacher(req, res, ip, teacher, check.ok, check.rehash ? password : null) : null;
  if (done === false) return undefined; // paused: already answered
  if (!done) {
    if (!teacher) await logAttempt(ip, 'teacher', false);
    return fail(res, 401, 'email_password_wrong', 'That email and password did not work');
  }
  return ok(res, await summaryOf({ kind: 'teacher', sub: teacher.id }));
}

/** The login code the owner or the onboarding tool gives a teacher. */
async function loginWithCode(req, res, body, ip) {
  const code = String(body.code || '');
  if (!/^\d{3,10}$/.test(code)) return fail(res, 400, 'enter_code', 'Enter your code');
  const teacher = await db.selectOne('teachers', {
    select: `${TEACHER_FIELDS},code_hash,code_salt`,
    code_lookup: `eq.${codeLookup(code)}`,
  });
  if (teacher) {
    const minutes = lockedFor(teacher);
    if (minutes) return lockedFail(res, minutes);
  }
  const done = teacher
    ? await finishTeacher(req, res, ip, teacher, verifyCode(code, teacher.code_hash, teacher.code_salt))
    : null;
  if (done === false) return undefined;
  if (!done) {
    if (!teacher) await logAttempt(ip, 'teacher', false);
    return fail(res, 401, 'wrong_code', 'That code did not work');
  }
  return ok(res, await summaryOf({ kind: 'teacher', sub: teacher.id }));
}

/**
 * A teacher makes their own account.
 *
 * Open on purpose: a teacher who hears about Plus can start without waiting
 * for anybody. So it is rate limited per address, and it collects enough to be
 * a real teacher rather than a drive-by row. They are signed in straight away.
 */
async function signup(req, res) {
  const ip = clientIp(req);
  const body = await readJson(req);

  const since = new Date(Date.now() - 3600_000).toISOString();
  const recent = await db.select('login_attempts', {
    select: 'id',
    ip: `eq.${ip}`,
    role: 'eq.signup',
    created_at: `gte.${since}`,
    limit: SIGNUPS_PER_HOUR + 1,
  });
  if (recent.length >= SIGNUPS_PER_HOUR) {
    return bad(res, 'Too many accounts from here. Please try again later.', 429);
  }

  const name = String(body.name || '').trim();
  if (name.length < 2) return fail(res, 400, 'enter_name', 'Enter your full name');

  const email = cleanEmail(body.email);
  if (!looksLikeEmail(email)) return fail(res, 400, 'enter_email', 'Enter a valid email address');

  const phone = toLkMobile(body.phone);
  if (!phone) return fail(res, 400, 'tel_nine', 'Enter a Sri Lankan mobile number: 9 digits starting with 7');

  const password = String(body.password || '');
  const problem = passwordProblem(password, { email, phone, name });
  if (problem) return fail(res, 400, problem, PASSWORD_MESSAGES[problem]);

  const subjects = (Array.isArray(body.subjects) ? body.subjects : [])
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 20);
  if (!subjects.length) return fail(res, 400, 'pick_subject', 'Pick at least one subject');

  const area = String(body.area || '').trim();

  // Checked before inserting so the answer is a sentence rather than a
  // constraint violation. The unique index is still what guarantees it.
  const taken = await db.selectOne('teachers', { select: 'id', email: `eq.${email}` });
  if (taken) return fail(res, 409, 'email_taken', 'There is already an account with that email');

  const sameNumber = await db.selectOne('teachers', { select: 'id', phone: `eq.${phone}` });
  if (sameNumber) return fail(res, 409, 'phone_taken', 'There is already an account with that number');

  const joinKey = await freeJoinKey(name);

  const [teacher] = await db.insert('teachers', {
    name,
    title: String(body.title || 'Mr').slice(0, 12),
    email,
    phone,
    join_key: joinKey,
    subjects,
    lang: ['en', 'si', 'ta'].includes(body.lang) ? body.lang : 'en',
    password_hash: await hashPassword(password),
    password_salt: null,
    password_changed_at: new Date().toISOString(),
    own_place_area: area || null,
    plus_since: new Date().toISOString().slice(0, 10),
  });

  await db.insert('login_attempts', { ip, role: 'signup', ok: true }, { returning: 'minimal' });
  await startLoginSession(req, res, 'teacher', teacher.id);
  return ok(res, {
    ...((await summaryOf({ kind: 'teacher', sub: teacher.id })) ?? { role: 'teacher' }),
    created: true,
    join_key: joinKey,
  });
}

/** A sign-up link from the teacher's name, made unique if it is taken. */
async function freeJoinKey(name) {
  const base =
    String(name || 'teacher')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 14) || 'teacher';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = attempt ? `${base}${attempt + 1}` : base;
    const taken = await db.selectOne('teachers', { select: 'id', join_key: `eq.${candidate}` });
    if (!taken) return candidate;
  }
  throw Object.assign(new Error('Could not make a sign-up link for that name'), { status: 500 });
}

/**
 * What the app needs to know about whoever is signed in, from a session
 * { kind, sub }. A paused teacher, or a family whose children are all gone,
 * is no session at all.
 */
async function summaryOf(session) {
  if (!session) return null;

  if (session.kind === 'teacher') {
    const teacher = await db.selectOne('teachers', {
      select: 'id,name,title,lang,theme,auto_reminders,remind_after_days,subjects,curricula,join_key,suspended_at',
      id: `eq.${session.sub}`,
    });
    // A paused teacher's session is ended by `me` rather than quietly honoured.
    if (!teacher || teacher.suspended_at) return null;
    delete teacher.suspended_at;
    return { role: 'teacher', teacher };
  }

  if (session.kind === 'parent' || session.kind === 'student') return familySummary(session.sub);
  return null;
}

async function login(req, res) {
  const ip = clientIp(req);
  const body = await readJson(req);
  if ((await failuresFor(ip)) >= MAX_FAILS) return tooMany(res);

  if (body.email || body.password) return loginWithPassword(req, res, body, ip);

  const role = String(body.role || '').toLowerCase();
  if (role === 'teacher') return loginWithCode(req, res, body, ip);
  if (role === 'parent' || role === 'student') {
    // The shared family code is gone: each person now has their own account.
    return fail(
      res,
      410,
      'family_codes_retired',
      'Family codes are no longer used. Sign in with your phone number, or ask your teacher for an app invite.',
    );
  }
  return fail(res, 400, 'pick_role', 'Pick a role first');
}

export default guard(async (req, res) => {
  const r = resource(req);

  if (r === 'config') {
    return ok(res, {
      code_length: CODE_LENGTH,
      configured: db.configured && secretsReady,
      demo_hint: false,
    });
  }

  if (r === 'me') {
    const session = await readLoginSession(req);
    const summary = session ? await summaryOf(session) : null;
    if (!summary) {
      // Also clears a cookie from before migration 008, which no longer opens anything.
      if (session || /plus_session=|plus_sid=/.test(String(req.headers.cookie || ''))) {
        await endLoginSession(req, res);
      }
      return ok(res, { role: null });
    }
    return ok(res, summary);
  }

  if (req.method !== 'POST') return bad(res, 'Use POST', 405);
  if (!sameOrigin(req)) return bad(res, 'Cross-site request refused', 403);

  if (r === 'logout') {
    await endLoginSession(req, res);
    return ok(res, { role: null });
  }

  if (!db.configured) return bad(res, 'The server is not connected to a database yet', 503);
  if (!secretsReady) return bad(res, 'SESSION_SECRET is not set on the server', 503);

  if (r === 'login') return login(req, res);
  if (r === 'signup') return signup(req, res);

  return bad(res, 'Unknown request', 404);
});
