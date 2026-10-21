/**
 * /api/auth  -  login, logout and "who am I".
 *
 *   GET  ?r=config   what the login screen needs before anyone types
 *   GET  ?r=me       the current session, so a reload stays logged in
 *   POST ?r=login    { role, code }  or  { email, password }
 *   POST ?r=signup   a teacher makes their own account
 *   POST ?r=logout
 *
 * The code is checked here, on the server, never in the browser. Failed
 * attempts are counted per IP and the endpoint locks out after too many
 * (section 10: "a 4-digit code is easy to guess").
 */

import * as db from './_lib/db.js';
import { bad, clientIp, guard, ok, readJson, resource } from './_lib/http.js';
import {
  codeLookup,
  endSession,
  familySession,
  hashCode,
  readSession,
  secretsReady,
  startSession,
  teacherSession,
  verifyCode,
} from './_lib/session.js';
import { toLkMobile } from './_lib/rules.js';

/* A password has to be worth having; 8 characters is the floor. */
const MIN_PASSWORD = 8;
const SIGNUPS_PER_HOUR = Number(process.env.SIGNUP_MAX_PER_HOUR || 10);

const cleanEmail = (value) => String(value || '').trim().toLowerCase();
const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

const MAX_FAILS = Number(process.env.LOGIN_MAX_ATTEMPTS || 8);
const WINDOW_MINUTES = Number(process.env.LOGIN_WINDOW_MINUTES || 15);
const CODE_LENGTH = Number(process.env.CODE_LENGTH || 4);

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

/**
 * Sign in as a teacher with an email and a password.
 *
 * The same lock-out as the code path, and the same answer whether the email
 * is unknown or the password is wrong - telling them apart would hand an
 * attacker a list of who has an account here.
 */
async function loginWithPassword(req, res, body, ip) {
  const email = cleanEmail(body.email);
  const password = String(body.password || '');

  if (!email || !password) return bad(res, 'Enter your email and password');
  if ((await failuresFor(ip)) >= MAX_FAILS) {
    return bad(res, `Too many tries. Please wait ${WINDOW_MINUTES} minutes and try again.`, 429);
  }

  const teacher = await db.selectOne('teachers', {
    select: 'id,name,title,email,password_hash,password_salt',
    email: `eq.${email}`,
  });

  if (!teacher?.password_hash || !verifyCode(password, teacher.password_hash, teacher.password_salt)) {
    await logAttempt(ip, 'teacher', false);
    return bad(res, 'That email and password did not work', 401);
  }

  await logAttempt(ip, 'teacher', true);
  const session = { kind: 'teacher', tid: teacher.id };
  startSession(res, session);
  return ok(res, (await summaryOf(session)) ?? { role: 'teacher' });
}

/**
 * A teacher makes their own account.
 *
 * Open on purpose: a teacher who hears about Plus can start using it without
 * waiting for anybody. What that costs is that anybody can make an account
 * here, so it is rate limited per address and the sign-up collects enough to
 * be a real teacher rather than a drive-by row.
 *
 * They are signed in straight away - asking somebody to log in again with the
 * password they just chose is a pointless step.
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
  if (name.length < 2) return bad(res, 'Enter your full name');

  const email = cleanEmail(body.email);
  if (!looksLikeEmail(email)) return bad(res, 'Enter a valid email address');

  const password = String(body.password || '');
  if (password.length < MIN_PASSWORD) {
    return bad(res, `Your password needs at least ${MIN_PASSWORD} characters`);
  }

  const phone = toLkMobile(body.phone);
  if (!phone) return bad(res, 'Enter a Sri Lankan mobile number: 9 digits starting with 7');

  const subjects = (Array.isArray(body.subjects) ? body.subjects : [])
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 20);
  if (!subjects.length) return bad(res, 'Pick at least one subject');

  const area = String(body.area || '').trim();

  // Checked before inserting so the answer is a sentence rather than a
  // constraint violation. The unique index is still what guarantees it.
  const taken = await db.selectOne('teachers', { select: 'id', email: `eq.${email}` });
  if (taken) return bad(res, 'There is already an account with that email', 409);

  const sameNumber = await db.selectOne('teachers', { select: 'id', phone: `eq.${phone}` });
  if (sameNumber) return bad(res, 'There is already an account with that number', 409);

  const joinKey = await freeJoinKey(name);
  const { hash, salt } = hashCode(password);

  const [teacher] = await db.insert('teachers', {
    name,
    title: String(body.title || 'Mr').slice(0, 12),
    email,
    phone,
    join_key: joinKey,
    subjects,
    lang: body.lang === 'ta' ? 'ta' : 'en',
    password_hash: hash,
    password_salt: salt,
    own_place_area: area || null,
    plus_since: new Date().toISOString().slice(0, 10),
  });

  await db.insert('login_attempts', { ip, role: 'signup', ok: true }, { returning: 'minimal' });

  const session = { kind: 'teacher', tid: teacher.id };
  startSession(res, session);
  return ok(res, {
    ...((await summaryOf(session)) ?? { role: 'teacher' }),
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
 * What the app needs to know about itself. It takes the session explicitly,
 * because straight after a login the cookie is on the response and not yet on
 * the request - reading it back from the request would answer with nothing.
 */
async function summaryOf(session) {
  if (!session) return null;

  if (session.kind === 'teacher') {
    const teacher = await db.selectOne('teachers', {
      select: 'id,name,title,lang,theme,auto_reminders,remind_after_days,subjects,curricula,join_key',
      id: `eq.${session.tid}`,
    });
    return teacher ? { role: 'teacher', teacher } : null;
  }

  if (session.kind === 'family') {
    const children = await db.select('students', {
      select: 'id,name,grade,area,subject,curriculum',
      id: db.inList(session.children),
      order: 'name.asc',
    });
    if (!children.length) return null;
    const teacher = await db.selectOne('teachers', {
      select: 'id,name,title,lang,theme',
      id: `eq.${session.tid}`,
    });
    return {
      role: session.role,
      child_id: session.children.includes(session.child) ? session.child : children[0].id,
      children,
      teacher,
    };
  }
  return null;
}

async function login(req, res) {
  const ip = clientIp(req);
  const body = await readJson(req);
  const { role, code } = body;
  const wanted = String(role || '').toLowerCase();

  // A teacher may sign in with an email and a password instead of a code.
  if (body.email || body.password) return loginWithPassword(req, res, body, ip);

  if (!['teacher', 'parent', 'student'].includes(wanted)) return bad(res, 'Pick a role first');
  if (!/^\d{3,10}$/.test(String(code || ''))) return bad(res, 'Enter your code');

  if ((await failuresFor(ip)) >= MAX_FAILS) {
    return bad(res, `Too many tries. Please wait ${WINDOW_MINUTES} minutes and try again.`, 429);
  }

  const lookup = codeLookup(code);

  if (wanted === 'teacher') {
    const teacher = await db.selectOne('teachers', {
      select: 'id,name,title,code_hash,code_salt',
      code_lookup: `eq.${lookup}`,
    });
    if (!teacher || !verifyCode(code, teacher.code_hash, teacher.code_salt)) {
      await logAttempt(ip, wanted, false);
      return bad(res, 'That code did not work', 401);
    }
    await logAttempt(ip, wanted, true);
    const session = { kind: 'teacher', tid: teacher.id };
    startSession(res, session);
    return ok(res, (await summaryOf(session)) ?? { role: 'teacher' });
  }

  const account = await db.selectOne('family_accounts', {
    select: 'id,teacher_id,code_hash,code_salt,family_children(student_id)',
    code_lookup: `eq.${lookup}`,
  });
  if (!account || !verifyCode(code, account.code_hash, account.code_salt)) {
    await logAttempt(ip, wanted, false);
    return bad(res, 'That code did not work', 401);
  }

  const children = (account.family_children || []).map((c) => c.student_id);
  if (!children.length) {
    await logAttempt(ip, wanted, false);
    return bad(res, 'This code is not linked to a student yet', 403);
  }

  await logAttempt(ip, wanted, true);
  await db
    .update('family_accounts', { last_login_at: new Date().toISOString() }, { id: `eq.${account.id}` })
    .catch(() => {});

  // The session carries the exact child ids it may read. Nothing in a later
  // request can widen it, so one family can never reach another family's data.
  const session = {
    kind: 'family',
    role: wanted,
    aid: account.id,
    tid: account.teacher_id,
    children,
    child: children[0],
  };
  startSession(res, session);
  return ok(res, (await summaryOf(session)) ?? { role: wanted });
}

export default guard(async (req, res) => {
  const r = resource(req);

  if (r === 'config') {
    return ok(res, {
      code_length: CODE_LENGTH,
      configured: db.configured && secretsReady,
      demo_hint: process.env.DEMO_HINT === '1',
    });
  }

  if (r === 'me') {
    const session = readSession(req);
    if (!session) return ok(res, { role: null });
    const summary = await summaryOf(session);
    if (!summary) {
      endSession(res);
      return ok(res, { role: null });
    }
    return ok(res, summary);
  }

  if (req.method !== 'POST') return bad(res, 'Use POST', 405);

  if (r === 'logout') {
    endSession(res);
    return ok(res, { role: null });
  }

  if (r === 'login') {
    if (!db.configured) return bad(res, 'The server is not connected to a database yet', 503);
    if (!secretsReady) return bad(res, 'SESSION_SECRET is not set on the server', 503);
    return login(req, res);
  }

  if (r === 'signup') {
    if (!db.configured) return bad(res, 'The server is not connected to a database yet', 503);
    if (!secretsReady) return bad(res, 'SESSION_SECRET is not set on the server', 503);
    return signup(req, res);
  }

  if (r === 'child') {
    // Switch child within the same family session (rule: one code, many children).
    const f = familySession(req);
    if (!f) return bad(res, 'Please log in again', 401);
    const { child_id: childId } = await readJson(req);
    if (!f.children.includes(childId)) return bad(res, 'Not your child', 403);
    const next = { ...f, child: childId };
    startSession(res, next);
    return ok(res, await summaryOf(next));
  }

  if (r === 'role') {
    // Switch between the Parent and Student view with the same family code.
    const f = familySession(req);
    if (!f) return bad(res, 'Please log in again', 401);
    const { role } = await readJson(req);
    if (!['parent', 'student'].includes(role)) return bad(res, 'Unknown role');
    const next = { ...f, role };
    startSession(res, next);
    return ok(res, await summaryOf(next));
  }

  return bad(res, 'Unknown request', 404);
});
