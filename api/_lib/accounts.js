/**
 * Accounts, passwords and server-side sessions for teachers, parents and
 * students (migration 008).
 *
 * The keys all come from the two secrets the server already has. HKDF
 * stretches them into one key per job, so the key that hashes a session token
 * is never the key that hashes an invite code:
 *
 *   LOGIN_PEPPER    mixed into every password before scrypt
 *   SESSION_SECRET  -> session  keyed hash of a session token
 *                   -> invite   keyed hash of an invite code (indexed lookup)
 *                   -> reset    keyed hash of a password-reset token
 *
 * A copy of the database alone therefore yields no password that can be
 * cracked offline, no usable session and no unused invite.
 */

import { createHmac, hkdfSync, randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import * as db from './db.js';
import { clientIp } from './http.js';
import { hashCode } from './session.js';

const SECRET = process.env.SESSION_SECRET || '';
const PEPPER = process.env.LOGIN_PEPPER || SECRET;

export const accountsReady = Boolean(SECRET && PEPPER);

const subkey = (label) =>
  Buffer.from(hkdfSync('sha256', Buffer.from(SECRET, 'utf8'), Buffer.alloc(0), `plus-login:${label}`, 32));
const keyed = (label, value) => createHmac('sha256', subkey(label)).update(String(value)).digest('hex');

/* ---------------------------------------------------------------- passwords -- */

export const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

/*
 * The passwords that top every breach list, and the ones a Sri Lankan family
 * would reach for first. A short list on purpose: the length rule does most of
 * the work, this only stops the obvious.
 */
const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', '11111111',
  '00000000', '87654321', 'qwerty123', 'qwertyuiop', 'iloveyou', 'abc12345', 'abcd1234',
  'welcome1', 'letmein1', 'admin123', 'srilanka', 'srilanka1', 'colombo1', 'sinhala1',
  'teacher1', 'student1', 'plus1234', 'whatsapp',
]);

/**
 * What is wrong with this password, as a code the app translates, or null.
 * `about` holds things the password must not simply repeat: the phone
 * number, the email, the name.
 */
export function passwordProblem(password, about = {}) {
  const pw = String(password || '');
  if (pw.length < MIN_PASSWORD) return 'password_short';
  if (pw.length > MAX_PASSWORD) return 'password_long';
  const lower = pw.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(pw)) return 'password_common';
  const digits = pw.replace(/\D/g, '');
  const phone = String(about.phone || '').replace(/\D/g, '');
  if (phone && digits.length >= 7 && phone.endsWith(digits.slice(-9))) return 'password_personal';
  const email = String(about.email || '').toLowerCase().split('@')[0];
  if (email && email.length >= 4 && lower.includes(email)) return 'password_personal';
  return null;
}

/* What each code says, for the server's own error sentence. */
export const PASSWORD_MESSAGES = {
  password_short: `Use at least ${MIN_PASSWORD} characters`,
  password_long: `Use at most ${MAX_PASSWORD} characters`,
  password_common: 'That password is too easy to guess. Pick another one.',
  password_personal: 'Do not use your phone number, email or name as the password',
};

/*
 * scrypt at N = 2^15, r = 8: 32 MB and about 100 ms per guess on a server.
 * The cost is written into each hash ("s2$15$salt$hash"), so it can be raised
 * later without breaking a single existing password.
 */
const LOG2N = Math.max(12, Math.min(18, Number(process.env.PASSWORD_SCRYPT_LOG2 || 15)));

const scrypt = (input, salt, log2n) =>
  new Promise((resolve, reject) =>
    scryptCallback(input, salt, 32, { N: 2 ** log2n, r: 8, p: 1, maxmem: 256 * 2 ** log2n * 8 * 2 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );

const peppered = (password) => createHmac('sha256', PEPPER).update(String(password)).digest();

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(peppered(password), salt, LOG2N);
  return `s2$${LOG2N}$${salt}$${key.toString('hex')}`;
}

/**
 * Check a password. `legacySalt` is for teachers whose password was saved
 * before this module (the old "hash + salt column" format).
 *
 * `rehash` says the hash should be replaced: it is in the old format, or was
 * made at a lower cost than today's. The caller saves a fresh one right after
 * a successful sign-in, so old hashes disappear without anyone resetting.
 */
export async function verifyPassword(password, stored, legacySalt = null) {
  if (!stored) return { ok: false, rehash: false };
  const parts = String(stored).split('$');
  if (parts[0] === 's2' && parts.length === 4) {
    const [, log2n, salt, hex] = parts;
    const want = Buffer.from(hex, 'hex');
    const got = await scrypt(peppered(password), salt, Number(log2n));
    const ok = got.length === want.length && timingSafeEqual(got, want);
    return { ok, rehash: ok && Number(log2n) < LOG2N };
  }
  if (!legacySalt) return { ok: false, rehash: false };
  const want = Buffer.from(String(stored), 'hex');
  const got = Buffer.from(hashCode(password, legacySalt).hash, 'hex');
  const ok = got.length === want.length && timingSafeEqual(got, want);
  return { ok, rehash: ok };
}

/* ------------------------------------------------------------------ lockout -- */

/*
 * Per account, on top of the per-address limit in auth.js: five wrong
 * passwords lock the account for 15 minutes, and each further five doubles
 * it, to a day at most. A guesser spread over many addresses still hits this.
 */
const LOCK_AFTER = 5;
const LOCK_BASE_MIN = 15;
const LOCK_MAX_MIN = 24 * 60;

export const lockedFor = (row, now = Date.now()) => {
  const until = row?.locked_until ? Date.parse(row.locked_until) : 0;
  return until > now ? Math.ceil((until - now) / 60_000) : 0;
};

/** The patch to save after a wrong password. */
export function failurePatch(row, now = Date.now()) {
  const fails = Number(row?.failed_logins || 0) + 1;
  const patch = { failed_logins: fails };
  if (fails % LOCK_AFTER === 0) {
    const minutes = Math.min(LOCK_MAX_MIN, LOCK_BASE_MIN * 2 ** (fails / LOCK_AFTER - 1));
    patch.locked_until = new Date(now + minutes * 60_000).toISOString();
  }
  return patch;
}

export const successPatch = () => ({
  failed_logins: 0,
  locked_until: null,
  last_login_at: new Date().toISOString(),
});

/* ------------------------------------------------------------------ invites -- */

export const INVITE_DAYS = 7;
const INVITE_LENGTH = 6;

/** A 6-digit code, every digit equally likely. */
export const inviteCode = () =>
  Array.from({ length: INVITE_LENGTH }, () => String(randomInt(10))).join('');

export const inviteLookup = (code) => keyed('invite', String(code).replace(/\D/g, ''));

/* ----------------------------------------------------------------- sessions -- */

const SESSION_DAYS = 30;
const IDLE_DAYS = 14; // unused this long, a session ends even before 30 days
const TOUCH_EVERY_MS = 10 * 60_000;

const PROD = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
/*
 * __Host- makes the browser refuse the cookie unless it is Secure, for this
 * exact host and path "/": a sub-domain can never set or overwrite it. It
 * needs https, so local development uses the plain name.
 */
export const SESSION_COOKIE = PROD ? '__Host-plus_sid' : 'plus_sid';
const LEGACY_COOKIE = 'plus_session';

const tokenHash = (token) => keyed('session', token);

function cookieValue(req, name) {
  for (const part of String(req.headers?.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setCookies(res, cookies) {
  const prior = res.getHeader?.('Set-Cookie');
  const list = [].concat(prior || [], cookies);
  res.setHeader('Set-Cookie', list);
}

const attrs = (maxAge) =>
  `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${PROD ? '; Secure' : ''}`;

/*
 * No cache: every request asks the database whether its session is still
 * live. It is one indexed lookup, and it means signing out, a password change
 * or a reset ends a session everywhere at once - with a cache, a copied cookie
 * kept working on another server for up to the cache's lifetime.
 */

/**
 * Start a session for `kind` ('teacher', 'parent', 'student') and `id`, and
 * set the cookie. The browser gets 32 random bytes; the database gets only a
 * keyed hash of them.
 */
export async function startLoginSession(req, res, kind, id) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  await db.insert(
    'login_sessions',
    {
      token_hash: tokenHash(token),
      subject_kind: kind,
      subject_id: id,
      last_seen_at: new Date(now).toISOString(),
      expires_at: new Date(now + SESSION_DAYS * 864e5).toISOString(),
      ip: clientIp(req).slice(0, 64),
      user_agent: String(req.headers?.['user-agent'] || '').slice(0, 200),
    },
    { returning: 'minimal' },
  );
  setCookies(res, [
    `${SESSION_COOKIE}=${token}; ${attrs(SESSION_DAYS * 86400)}`,
    // The old signed cookie is retired on every new sign-in.
    `${LEGACY_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${PROD ? '; Secure' : ''}`,
  ]);
}

/**
 * The live session behind this request, as { id, kind, sub }, or null.
 * Expired, revoked and idle sessions are all null.
 */
export async function readLoginSession(req) {
  const token = cookieValue(req, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const hash = tokenHash(token);

  const row = await db.selectOne('login_sessions', {
    select: 'id,subject_kind,subject_id,expires_at,last_seen_at,revoked_at',
    token_hash: `eq.${hash}`,
  });
  const now = Date.now();
  const alive =
    row &&
    !row.revoked_at &&
    Date.parse(row.expires_at) > now &&
    Date.parse(row.last_seen_at) > now - IDLE_DAYS * 864e5;
  const session = alive ? { id: row.id, kind: row.subject_kind, sub: row.subject_id } : null;

  if (alive && Date.parse(row.last_seen_at) < now - TOUCH_EVERY_MS) {
    db.update('login_sessions', { last_seen_at: new Date(now).toISOString() }, { id: `eq.${row.id}` }).catch(() => {});
  }
  return session;
}

/** Sign out this device: revoke the row and clear the cookie. */
export async function endLoginSession(req, res) {
  const token = cookieValue(req, SESSION_COOKIE);
  if (token) {
    const hash = tokenHash(token);
    await db
      .update('login_sessions', { revoked_at: new Date().toISOString() }, { token_hash: `eq.${hash}` })
      .catch(() => {});
  }
  setCookies(res, [
    `${SESSION_COOKIE}=; ${attrs(0)}`,
    `${LEGACY_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${PROD ? '; Secure' : ''}`,
  ]);
}

/**
 * Sign out everywhere: after a password change or reset, or when a parent
 * asks for it. `keep` is the session id to leave alone - the device the
 * person is using right now.
 */
export async function revokeAllSessions(kind, id, keep = null) {
  const filter = { subject_kind: `eq.${kind}`, subject_id: `eq.${id}`, revoked_at: 'is.null' };
  if (keep) filter.id = `neq.${keep}`;
  await db.update('login_sessions', { revoked_at: new Date().toISOString() }, filter);
}

/** The devices signed in to one account, newest first. */
export const listSessions = (kind, id) =>
  db.select('login_sessions', {
    select: 'id,created_at,last_seen_at,user_agent',
    subject_kind: `eq.${kind}`,
    subject_id: `eq.${id}`,
    revoked_at: 'is.null',
    expires_at: `gt.${new Date().toISOString()}`,
    order: 'last_seen_at.desc',
    limit: 20,
  });

/* ----------------------------------------------------------- password reset -- */

export const RESET_MINUTES = 30;
export const newResetToken = () => randomBytes(32).toString('base64url');
export const resetHash = (token) => keyed('reset', token);

/* ----------------------------------------------------------- request checks -- */

/**
 * Cross-site request forgery: a state-changing request must come from this
 * app's own pages. SameSite=Lax already keeps the cookie off cross-site POSTs;
 * this is the second lock, for browsers that do not honour it.
 */
export function sameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return true; // same-origin fetches from older browsers, and server-to-server
  try {
    const host = new URL(origin).host;
    const allowed = [req.headers.host, process.env.APP_URL && new URL(process.env.APP_URL).host].filter(Boolean);
    return allowed.includes(host);
  } catch {
    return false;
  }
}

/** The signed-in teacher, as { tid, sessionId }, or null. */
export async function teacherFrom(req) {
  const session = await readLoginSession(req);
  return session && session.kind === 'teacher' ? { tid: session.sub, sessionId: session.id } : null;
}

/** Kept for the tests that call it: there is no session cache to forget. */
export const forgetSessions = () => {};
