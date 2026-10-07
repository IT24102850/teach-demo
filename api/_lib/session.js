/**
 * Login codes and sessions.
 *
 * Codes are never stored in plain text: each row keeps a random salt and
 * scrypt(code, salt + pepper). The session itself is a short HMAC-signed token
 * in an HttpOnly cookie - no library, no database round trip to read it.
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.SESSION_SECRET || '';
const PEPPER = process.env.LOGIN_PEPPER || SECRET;
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const COOKIE = 'plus_session';

export const secretsReady = Boolean(SECRET && PEPPER);

/* -------------------------------------------------------------- code hashes -- */

export function hashCode(code, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(code), salt + PEPPER, 32).toString('hex');
  return { hash, salt };
}

export function verifyCode(code, hash, salt) {
  if (!hash || !salt) return false;
  const candidate = Buffer.from(hashCode(code, salt).hash, 'hex');
  const stored = Buffer.from(hash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

/** A 4-digit code that is not already in use (checked by the caller). */
export function randomCode(length = Number(process.env.CODE_LENGTH || 4)) {
  let out = '';
  while (out.length < length) out += String(randomBytes(1)[0] % 10);
  return out;
}

/* ------------------------------------------------------------------ tokens -- */

const b64 = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const mac = createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token || !SECRET) return null;
  const [body, mac] = String(token).split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- cookies -- */

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * Create the session cookie.
 * `kind` is 'teacher' or 'family'; a family session carries the child ids it
 * may read, so no request can widen its own access.
 */
export function startSession(res, payload) {
  const token = sign({ ...payload, exp: Math.floor(Date.now() / 1000) + MAX_AGE });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure}`,
  );
  return token;
}

export function endSession(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

export function readSession(req) {
  return verify(parseCookies(req)[COOKIE]);
}

/** Session of a logged-in teacher, or null. */
export function teacherSession(req) {
  const s = readSession(req);
  return s && s.kind === 'teacher' ? s : null;
}

/**
 * Session of a logged-in family, or null. `role` is 'parent' or 'student' -
 * the same code opens both views (rule 7.7.4).
 */
export function familySession(req) {
  const s = readSession(req);
  return s && s.kind === 'family' ? s : null;
}

/* ---------------------------------------------------- indexed code lookup -- */

/**
 * A deterministic, keyed digest of the code. Stored alongside the scrypt hash
 * so a login can find the one candidate row with an index instead of scanning
 * every account, while the database alone still reveals nothing: reversing it
 * needs LOGIN_PEPPER, which lives only in the server's environment.
 */
export function codeLookup(code) {
  return createHmac('sha256', PEPPER).update(`code:${String(code)}`).digest('hex');
}
