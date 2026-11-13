/**
 * The cryptography and request checks behind the owner's admin dashboard.
 *
 * Nothing here is shared with the teacher or family login. One secret,
 * ADMIN_SECRET_KEY, is stretched with HKDF into a separate key for each job,
 * so a key used to seal TOTP secrets is never also a key used to hash a
 * session token:
 *
 *   pepper    HMAC'd into every password before scrypt
 *   totp      AES-256-GCM key for the authenticator secret at rest
 *   session   keyed hash of a session token (the database keeps only this)
 *   setup     keyed hash of a one-time setup link
 *   recovery  keyed hash of a recovery code
 *
 * Without ADMIN_SECRET_KEY the dashboard does not exist: /api/admin answers
 * 404 to everything. A copy of the database alone yields no password that
 * can be cracked offline, no TOTP secret and no live session.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';

const RAW = process.env.ADMIN_SECRET_KEY || '';

/** 32 characters is the floor; `openssl rand -hex 32` gives 64. */
export const adminEnabled = RAW.length >= 32;

const subkey = (label) =>
  Buffer.from(hkdfSync('sha256', Buffer.from(RAW, 'utf8'), Buffer.alloc(0), `plus-admin:${label}`, 32));

const KEYS = adminEnabled
  ? {
      pepper: subkey('pepper'),
      totp: subkey('totp'),
      session: subkey('session'),
      setup: subkey('setup'),
      recovery: subkey('recovery'),
    }
  : null;

const keyed = (name, value) => createHmac('sha256', KEYS[name]).update(String(value)).digest('hex');

/* --------------------------------------------------------------- passwords -- */

/*
 * scrypt at N = 2^17, r = 8: about 128 MB and a few hundred milliseconds per
 * guess. Slow on purpose, and this path runs a handful of times a day. Tests
 * turn it down with ADMIN_SCRYPT_LOG2; the cost is written into each hash, so
 * a stored hash is always checked at the cost it was made with.
 */
const LOG2N = Math.max(14, Math.min(20, Number(process.env.ADMIN_SCRYPT_LOG2 || 17)));
const R = 8;
const P = 1;

function scrypt(password, salt, log2n, r, p) {
  const N = 2 ** log2n;
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, 32, { N, r, p, maxmem: 256 * N * r }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

const peppered = (password) => createHmac('sha256', KEYS.pepper).update(String(password)).digest();

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(peppered(password), salt, LOG2N, R, P);
  return `scrypt$${LOG2N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/*
 * Built once, at the configured cost, so checking an email that has no
 * account spends the same time as checking one that does.
 */
let dummy = null;

export async function verifyPassword(password, stored) {
  if (!dummy) dummy = await hashPassword(randomBytes(18).toString('base64url'));
  const real = typeof stored === 'string' && stored.startsWith('scrypt$');
  const [, log2n, r, p, salt, hash] = (real ? stored : dummy).split('$');
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(peppered(password), Buffer.from(salt, 'base64url'), Number(log2n), Number(r), Number(p));
  const same = actual.length === expected.length && timingSafeEqual(actual, expected);
  return real && same;
}

/** Long enough, not the email, not a famous one. That is the whole rule. */
const COMMON = new Set([
  'password', 'password1', 'password123', '123456789012', '1234567890', 'qwertyuiop',
  'iloveyou', 'admin12345', 'administrator', 'welcome123', 'letmein123', 'srilanka123',
  'hmtech12345', 'plusadmin123', 'changeme123',
]);

export function passwordProblem(password, email = '') {
  const pw = String(password || '');
  if (pw.length < 12) return 'Use at least 12 characters.';
  if (pw.length > 200) return 'That password is too long.';
  if (new Set(pw).size < 5) return 'Use more different characters.';
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && pw.toLowerCase().includes(local)) return 'Do not put your email in the password.';
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common.';
  return null;
}

/* -------------------------------------------------------------------- TOTP -- */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160 random bits, the size RFC 4226 recommends. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export const STEP_SECONDS = 30;
export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/** RFC 6238 / 4226: HMAC-SHA1, dynamic truncation, six digits. */
export function totpAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(bin).padStart(6, '0');
}

/**
 * The step the code matched, or null.
 *
 * One step either side forgives a phone clock that is up to 30 seconds out.
 * A step at or before `lastStep` has been used already and is refused, so a
 * code seen over a shoulder cannot be typed in again.
 */
export function verifyTotp(secret, code, lastStep = null, now = Date.now()) {
  const given = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(given) || !secret) return null;
  const step = currentStep(now);
  for (const s of [step - 1, step, step + 1]) {
    if (lastStep !== null && lastStep !== undefined && s <= Number(lastStep)) continue;
    const expected = Buffer.from(totpAt(secret, s));
    if (timingSafeEqual(expected, Buffer.from(given))) return s;
  }
  return null;
}

export function otpauthUri(email, secret) {
  const issuer = 'Plus Admin';
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

/* ---------------------------------------------------------- sealed secrets -- */

/**
 * AES-256-GCM. The admin's id is the additional data, so a sealed secret
 * copied onto another admin's row fails to open.
 */
export function seal(plain, bindTo) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEYS.totp, iv);
  cipher.setAAD(Buffer.from(`admin:${bindTo}`));
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function unseal(sealed, bindTo) {
  try {
    const [v, iv, tag, body] = String(sealed || '').split('.');
    if (v !== 'v1') return null;
    const decipher = createDecipheriv('aes-256-gcm', KEYS.totp, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`admin:${bindTo}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/* --------------------------------------------------- tokens and recovery -- */

export const newToken = () => randomBytes(32).toString('base64url');
export const sessionHash = (token) => keyed('session', token);
export const setupHash = (token) => keyed('setup', token);

/* No 0/O, 1/I/L: a code read off paper must not be ambiguous. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newRecoveryCodes(count = 10) {
  const codes = [];
  while (codes.length < count) {
    let raw = '';
    for (const byte of randomBytes(10)) raw += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

export const normaliseRecovery = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const recoveryHash = (code) => keyed('recovery', normaliseRecovery(code));

/* ---------------------------------------------------------------- cookies -- */

const PRODUCTION = process.env.NODE_ENV === 'production';

/*
 * __Host- makes the browser refuse the cookie unless it is Secure, has no
 * Domain and has Path=/, so a subdomain can never plant or shadow it. It
 * needs HTTPS, so local development uses a plain name.
 */
export const COOKIE = PRODUCTION ? '__Host-plus_admin' : 'plus_admin';

export function setAdminCookie(res, token, maxAgeSeconds) {
  const secure = PRODUCTION ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`,
  );
}

export function clearAdminCookie(res) {
  const secure = PRODUCTION ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

export function adminCookie(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) {
      const value = part.slice(i + 1).trim();
      return /^[A-Za-z0-9_-]{40,60}$/.test(value) ? value : null;
    }
  }
  return null;
}

/* ------------------------------------------------------- request checks --- */

/** Vercel overwrites these, so a client cannot choose its own address. */
export function adminIp(req) {
  const h = req.headers;
  const raw = h['x-vercel-forwarded-for'] || h['x-real-ip'] || h['x-forwarded-for'] || req.socket?.remoteAddress || '';
  return String(raw).split(',')[0].trim() || 'unknown';
}

function ipv4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
  return parts.reduce((acc, p) => (acc << 8) + Number(p), 0) >>> 0;
}

/**
 * ADMIN_ALLOWED_IPS: optional, comma separated, exact addresses or IPv4 CIDR
 * ranges. Unset means anywhere - the password and the code still apply.
 */
export function ipAllowed(ip, list = process.env.ADMIN_ALLOWED_IPS || '') {
  const rules = String(list).split(',').map((s) => s.trim()).filter(Boolean);
  if (!rules.length) return true;
  const clean = String(ip).replace(/^::ffff:/, '');
  return rules.some((rule) => {
    if (!rule.includes('/')) return rule === clean;
    const [base, bitsText] = rule.split('/');
    const bits = Number(bitsText);
    const a = ipv4ToInt(base);
    const b = ipv4ToInt(clean);
    if (a === null || b === null || !(bits >= 0 && bits <= 32)) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (a & mask) === (b & mask);
  });
}

/**
 * Cross-site request forgery, three ways. SameSite=Strict keeps the cookie off
 * any request another site starts; a custom header cannot be sent cross-site
 * without a CORS preflight this API never grants; and where the browser says
 * where the request came from, it has to be here.
 */
export function sameOrigin(req) {
  const h = req.headers;
  if (h['x-plus-admin'] !== '1') return false;
  const site = h['sec-fetch-site'];
  if (site && site !== 'same-origin') return false;
  const origin = h.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== h.host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Headers that apply to every admin response, whatever vercel.json says. */
export function hardenHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}
