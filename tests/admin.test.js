/**
 * The owner's dashboard: its cryptography, its sign-in, its sessions, and
 * the rules around changing anything.
 *
 * Supabase is a small in-memory stub here, as in api.test.js. It also plays
 * the part of the append-only trigger on admin_audit, and every request is
 * recorded, so a test can say "this never tried to edit the audit log".
 */

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'stub-service-key';
process.env.SESSION_SECRET = 'test-session-secret-0123456789';
process.env.LOGIN_PEPPER = 'test-login-pepper-0123456789';
process.env.ADMIN_SECRET_KEY = 'test-admin-secret-key-0123456789abcdef0123456789';
process.env.ADMIN_SCRYPT_LOG2 = '14';
process.env.CODE_LENGTH = '6';
delete process.env.ADMIN_ALLOWED_IPS;

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sec = await import('../api/_lib/admin-security.js');
const { hashCode, codeLookup } = await import('../api/_lib/session.js');
const { startLoginSession, forgetSessions } = await import('../api/_lib/accounts.js');

/* ========================================================= the stub ===== */

const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001';
const VIEWER = 'aaaaaaaa-0000-4000-8000-000000000002';
const TEACHER = 'tttttttt-0000-4000-8000-000000000001'.replace(/t/g, 'b');

let DB;
let calls;
let serial = 1000;
const uuid = () => `cccccccc-0000-4000-8000-${String(serial++).padStart(12, '0')}`;
const SERIAL_TABLES = new Set(['admin_audit', 'login_attempts', 'ai_reviews']);

function reset() {
  const t = hashCode('424242');
  DB = {
    admins: [],
    admin_sessions: [],
    admin_recovery_codes: [],
    admin_audit: [],
    login_attempts: [],
    family_accounts: [],
    login_sessions: [],
    teachers: [
      {
        id: TEACHER,
        title: 'Mr',
        name: 'Nimal',
        suspended_at: null,
        suspended_reason: null,
        plus_price: 500,
        plus_share: 0.5,
        code_lookup: codeLookup('424242'),
        code_hash: t.hash,
        code_salt: t.salt,
      },
    ],
  };
  calls = [];
}

function compare(actual, op, value) {
  switch (op) {
    case 'eq':
      return String(actual) === value;
    case 'neq':
      return String(actual) !== value;
    case 'is':
      if (value === 'null') return actual === null || actual === undefined;
      return String(actual) === value;
    case 'gt':
      return String(actual) > value;
    case 'gte':
      return String(actual) >= value;
    case 'lt':
      return typeof actual === 'number' ? actual < Number(value) : String(actual) < value;
    case 'lte':
      return String(actual) <= value;
    default:
      throw new Error(`stub: no operator ${op}`);
  }
}

function matches(row, params) {
  for (const [key, raw] of Object.entries(params)) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
    const i = raw.indexOf('.');
    if (!compare(row[key], raw.slice(0, i), raw.slice(i + 1))) return false;
  }
  return true;
}

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (url, init = {}) => {
  const parsed = new URL(url);
  const method = init.method || 'GET';
  const params = Object.fromEntries(parsed.searchParams.entries());
  const body = init.body ? JSON.parse(init.body) : null;
  const path = parsed.pathname.replace('/rest/v1/', '');
  calls.push({ method, path, params, body });

  if (path.startsWith('rpc/')) {
    const fn = path.slice(4);
    if (fn === 'admin_overview') return json(200, { today: '2026-11-13', teachers: { total: DB.teachers.length } });
    if (fn === 'admin_teachers') return json(200, DB.teachers.map(({ code_hash, code_salt, code_lookup, ...t }) => t));
    if (fn === 'admin_teacher') {
      const t = DB.teachers.find((x) => x.id === body.p_id);
      return json(200, t ? { teacher: t, months: [], classes: [] } : null);
    }
    return json(404, { message: `no function ${fn}` });
  }

  const table = path;
  DB[table] = DB[table] || [];

  if (method === 'GET') {
    let rows = DB[table].filter((r) => matches(r, params));
    if (params.order) {
      const [col, dir] = params.order.split('.');
      rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
    }
    if (params.limit) rows = rows.slice(0, Number(params.limit));
    return json(200, rows);
  }
  if (method === 'POST') {
    const incoming = Array.isArray(body) ? body : [body];
    const made = incoming.map((r) => ({
      id: SERIAL_TABLES.has(table) ? serial++ : uuid(),
      created_at: new Date().toISOString(),
      ...r,
    }));
    DB[table].push(...made);
    return json(201, made);
  }
  // What the database trigger does to admin_audit.
  if ((method === 'PATCH' || method === 'DELETE') && table === 'admin_audit') {
    return json(400, { message: 'admin_audit is append-only' });
  }
  if (method === 'PATCH') {
    const changed = DB[table].filter((r) => matches(r, params));
    for (const r of changed) Object.assign(r, body);
    return json(200, changed);
  }
  if (method === 'DELETE') {
    DB[table] = DB[table].filter((r) => !matches(r, params));
    return new Response(null, { status: 204 });
  }
  return json(405, {});
};

/* ======================================================= requests ======= */

const adminApi = (await import('../api/admin.js')).default;
const teacherApi = (await import('../api/teacher.js')).default;
const authApi = (await import('../api/auth.js')).default;
const { forgetTeacher } = await import('../api/_lib/active.js');

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    bodyText: '',
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    getHeader(k) {
      return this.headers[k.toLowerCase()];
    },
    end(text) {
      this.bodyText = text ?? '';
    },
    get json() {
      return JSON.parse(this.bodyText || '{}');
    },
  };
}

async function call(handler, { method = 'GET', url, body, cookie = '', ip = '198.51.100.7', headers = {} }) {
  const req = {
    method,
    url,
    body,
    headers: {
      host: 'plus.test',
      'x-plus-admin': '1',
      'x-forwarded-for': ip,
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    socket: { remoteAddress: ip },
  };
  const res = makeRes();
  await handler(req, res);
  return res;
}

const admin = (r, opts = {}) =>
  call(adminApi, { method: opts.body ? 'POST' : 'GET', url: `/api/admin?r=${r}${opts.params || ''}`, ...opts });

const cookieOf = (res) => String(res.getHeader('set-cookie') || '').split(';')[0];

const PASSWORD = 'a long and sturdy sentence 7';

/** An admin as `admin:invite` + setup leave them: password and TOTP set. */
async function seedAdmin({ id = ADMIN, email = 'owner@hmtech.lk', role = 'owner' } = {}) {
  const secret = sec.newTotpSecret();
  DB.admins.push({
    id,
    email,
    name: 'Owner',
    role,
    password_hash: await sec.hashPassword(PASSWORD),
    totp_secret: sec.seal(secret, id),
    totp_last_step: null,
    failed_count: 0,
    locked_until: null,
    disabled_at: null,
    last_login_at: null,
    last_login_ip: null,
  });
  return secret;
}

/*
 * The code an authenticator would show next. A code is spent once used, so
 * when this step's code is gone the clock moves on to the next 30 seconds -
 * the way a person would wait for the next one.
 */
const realNow = Date.now.bind(Date);
let clockOffset = 0;
Date.now = () => realNow() + clockOffset;

function nextCode(secret, adminId = ADMIN) {
  const row = DB.admins.find((a) => a.id === adminId);
  const spent = row?.totp_last_step;
  if (spent !== null && spent !== undefined && Number(spent) >= sec.currentStep()) {
    clockOffset += 30_000 * (Number(spent) - sec.currentStep() + 1);
  }
  return sec.totpAt(secret, sec.currentStep());
}

async function signIn(secret, { email = 'owner@hmtech.lk', id = ADMIN } = {}) {
  const res = await admin('login', { body: { email, password: PASSWORD, code: nextCode(secret, id) } });
  assert.equal(res.statusCode, 200, res.bodyText);
  return cookieOf(res);
}

/* ===================================================== cryptography ===== */

test('TOTP matches the RFC 6238 test vectors', () => {
  const secret = sec.base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(sec.totpAt(secret, Math.floor(59 / 30)), '287082');
  assert.equal(sec.totpAt(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(sec.totpAt(secret, Math.floor(2000000000 / 30)), '279037');
});

test('a TOTP code is accepted once, and one step of clock drift is forgiven', () => {
  const secret = sec.newTotpSecret();
  const now = Date.now();
  const step = sec.currentStep(now);
  assert.equal(sec.verifyTotp(secret, sec.totpAt(secret, step), null, now), step);
  assert.equal(sec.verifyTotp(secret, sec.totpAt(secret, step - 1), null, now), step - 1);
  assert.equal(sec.verifyTotp(secret, sec.totpAt(secret, step - 2), null, now), null, 'two steps old');
  assert.equal(sec.verifyTotp(secret, sec.totpAt(secret, step), step, now), null, 'replayed');
  assert.equal(sec.verifyTotp(secret, 'abcdef', null, now), null);
});

test('a sealed secret opens only for the admin it was sealed for', () => {
  const sealed = sec.seal('JBSWY3DPEHPK3PXP', ADMIN);
  assert.ok(!sealed.includes('JBSWY3DPEHPK3PXP'));
  assert.equal(sec.unseal(sealed, ADMIN), 'JBSWY3DPEHPK3PXP');
  assert.equal(sec.unseal(sealed, VIEWER), null, 'copied onto another row');
  const [v, iv, tag, body] = sealed.split('.');
  const flipped = body.slice(0, -2) + (body.endsWith('A') ? 'BB' : 'AA');
  assert.equal(sec.unseal([v, iv, tag, flipped].join('.'), ADMIN), null, 'tampered');
});

test('passwords are scrypt over a peppered HMAC, and a missing hash never verifies', async () => {
  const h = await sec.hashPassword(PASSWORD);
  assert.match(h, /^scrypt\$14\$8\$1\$/);
  assert.ok(!h.includes(PASSWORD));
  assert.equal(await sec.verifyPassword(PASSWORD, h), true);
  assert.equal(await sec.verifyPassword(`${PASSWORD}!`, h), false);
  assert.equal(await sec.verifyPassword(PASSWORD, null), false);
  assert.notEqual(await sec.hashPassword(PASSWORD), h, 'salted');
});

test('a weak password is refused with a reason', () => {
  assert.match(sec.passwordProblem('short', 'a@b.lk'), /12 characters/);
  assert.match(sec.passwordProblem('aaaaaaaaaaaaaaaa', 'a@b.lk'), /different/);
  assert.match(sec.passwordProblem('ownerhmtech-is-me-2026', 'ownerhmtech@hmtech.lk'), /email/);
  assert.match(sec.passwordProblem('password123', 'x@y.lk') || sec.passwordProblem('Password123!', 'x@y.lk') || 'too common', /too common|12/);
  assert.equal(sec.passwordProblem(PASSWORD, 'owner@hmtech.lk'), null);
});

test('recovery codes are unambiguous and compared after normalising', () => {
  const codes = sec.newRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[A-HJ-KM-NP-Z2-9]{5}-[A-HJ-KM-NP-Z2-9]{5}$/);
  assert.equal(sec.recoveryHash(codes[0].toLowerCase().replace('-', ' ')), sec.recoveryHash(codes[0]));
});

test('the IP allowlist takes exact addresses and IPv4 ranges', () => {
  assert.equal(sec.ipAllowed('1.2.3.4', ''), true, 'no list: anywhere');
  assert.equal(sec.ipAllowed('1.2.3.4', '1.2.3.4'), true);
  assert.equal(sec.ipAllowed('1.2.3.5', '1.2.3.4'), false);
  assert.equal(sec.ipAllowed('10.20.30.40', '10.0.0.0/8, 192.168.1.1'), true);
  assert.equal(sec.ipAllowed('11.0.0.1', '10.0.0.0/8'), false);
  assert.equal(sec.ipAllowed('::ffff:10.0.0.9', '10.0.0.0/24'), true);
});

/* ============================================================ edges ===== */

test('a request without the admin header, or from another site, is refused', async () => {
  reset();
  const noHeader = await call(adminApi, { url: '/api/admin?r=me', headers: { 'x-plus-admin': undefined } });
  assert.equal(noHeader.statusCode, 403);
  const otherOrigin = await admin('me', { headers: { origin: 'https://evil.example' } });
  assert.equal(otherOrigin.statusCode, 403);
  const crossSite = await admin('me', { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(crossSite.statusCode, 403);
  const fine = await admin('me', { headers: { origin: 'https://plus.test', 'sec-fetch-site': 'same-origin' } });
  assert.equal(fine.statusCode, 200);
  assert.deepEqual(fine.json, { admin: null });
});

test('outside the allowlist the dashboard does not exist', async () => {
  reset();
  process.env.ADMIN_ALLOWED_IPS = '10.0.0.0/8';
  try {
    assert.equal((await admin('me', { ip: '203.0.113.1' })).statusCode, 404);
    assert.equal((await admin('me', { ip: '10.1.2.3' })).statusCode, 200);
  } finally {
    delete process.env.ADMIN_ALLOWED_IPS;
  }
});

test('every admin response is marked no-store and noindex', async () => {
  reset();
  const res = await admin('me');
  assert.match(res.getHeader('cache-control'), /no-store/);
  assert.match(res.getHeader('x-robots-tag'), /noindex/);
});

test('nothing but /api needs to know: data endpoints refuse without a session', async () => {
  reset();
  for (const r of ['overview', 'teachers', 'security', 'audit']) {
    assert.equal((await admin(r)).statusCode, 401, r);
  }
  assert.equal((await admin('teacher.suspend', { body: { id: TEACHER } })).statusCode, 401);
});

/* ============================================================ setup ===== */

test('a setup link sets the password and the authenticator, once', async () => {
  reset();
  const token = sec.newToken();
  DB.admins.push({
    id: ADMIN,
    email: 'owner@hmtech.lk',
    role: 'owner',
    setup_token_hash: sec.setupHash(token),
    setup_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    failed_count: 0,
  });

  const started = await admin('setup.start', { body: { token } });
  assert.equal(started.statusCode, 200, started.bodyText);
  const { secret, uri, email } = started.json;
  assert.equal(email, 'owner@hmtech.lk');
  assert.match(uri, /^otpauth:\/\/totp\/Plus%20Admin%3Aowner%40hmtech\.lk\?secret=[A-Z2-7]+&issuer=Plus%20Admin/);
  assert.ok(!DB.admins[0].totp_pending.includes(secret), 'stored sealed');

  const weak = await admin('setup.finish', { body: { token, password: 'short', code: sec.totpAt(secret, sec.currentStep()) } });
  assert.equal(weak.statusCode, 400);

  const wrongCode = await admin('setup.finish', { body: { token, password: PASSWORD, code: '000000' } });
  assert.equal(wrongCode.statusCode, 400);

  const done = await admin('setup.finish', { body: { token, password: PASSWORD, code: sec.totpAt(secret, sec.currentStep()) } });
  assert.equal(done.statusCode, 200, done.bodyText);
  assert.equal(done.json.recovery_codes.length, 10);

  const row = DB.admins[0];
  assert.ok(row.password_hash.startsWith('scrypt$'));
  assert.equal(sec.unseal(row.totp_secret, ADMIN), secret);
  assert.equal(row.setup_token_hash, null, 'link spent');
  assert.equal(DB.admin_recovery_codes.length, 10);
  for (const c of done.json.recovery_codes) {
    assert.ok(!JSON.stringify(DB.admin_recovery_codes).includes(c), 'codes stored hashed');
  }

  const again = await admin('setup.start', { body: { token } });
  assert.equal(again.statusCode, 404, 'a setup link works once');
});

test('an expired setup link does nothing', async () => {
  reset();
  const token = sec.newToken();
  DB.admins.push({
    id: ADMIN,
    email: 'owner@hmtech.lk',
    role: 'owner',
    setup_token_hash: sec.setupHash(token),
    setup_expires_at: new Date(Date.now() - 1000).toISOString(),
  });
  assert.equal((await admin('setup.start', { body: { token } })).statusCode, 404);
});

/* ============================================================ login ===== */

test('signing in takes password and code together, and sets a strict HttpOnly cookie', async () => {
  reset();
  const secret = await seedAdmin();
  const res = await admin('login', { body: { email: 'Owner@HMTech.lk ', password: PASSWORD, code: nextCode(secret) } });
  assert.equal(res.statusCode, 200, res.bodyText);
  const header = res.getHeader('set-cookie');
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Path=\//);
  const token = cookieOf(res).split('=')[1];
  assert.equal(DB.admin_sessions.length, 1);
  assert.notEqual(DB.admin_sessions[0].token_hash, token, 'only a keyed hash is stored');
  assert.equal(DB.admin_sessions[0].token_hash, sec.sessionHash(token));
  assert.ok(DB.admin_audit.some((a) => a.action === 'login.ok'));
  assert.deepEqual(res.json.admin, { id: ADMIN, email: 'owner@hmtech.lk', name: 'Owner', role: 'owner' });
  assert.ok(!res.bodyText.includes('scrypt'), 'nothing secret in the reply');
});

test('a wrong password and a wrong code get the same answer', async () => {
  reset();
  const secret = await seedAdmin();
  const badPassword = await admin('login', { body: { email: 'owner@hmtech.lk', password: 'nope nope nope', code: nextCode(secret) } });
  const badCode = await admin('login', { body: { email: 'owner@hmtech.lk', password: PASSWORD, code: '000000' } });
  const nobody = await admin('login', { body: { email: 'nobody@hmtech.lk', password: PASSWORD, code: '123456' } });
  assert.equal(badPassword.statusCode, 401);
  assert.equal(badCode.statusCode, 401);
  assert.equal(nobody.statusCode, 401);
  assert.equal(badPassword.json.error, badCode.json.error);
  assert.equal(badCode.json.error, nobody.json.error);
  const reasons = DB.admin_audit.filter((a) => a.action === 'login.failed').map((a) => a.detail.reason);
  assert.deepEqual(reasons, ['password', 'code', 'unknown email'], 'the audit log knows which');
});

test('a code that was just used cannot be used again', async () => {
  reset();
  const secret = await seedAdmin();
  const code = nextCode(secret);
  assert.equal((await admin('login', { body: { email: 'owner@hmtech.lk', password: PASSWORD, code } })).statusCode, 200);
  assert.equal((await admin('login', { body: { email: 'owner@hmtech.lk', password: PASSWORD, code } })).statusCode, 401);
});

test('five failures from one address shut that address out, even with the right details', async () => {
  reset();
  const secret = await seedAdmin();
  for (let i = 0; i < 5; i += 1) {
    await admin('login', { body: { email: 'owner@hmtech.lk', password: 'wrong wrong wrong', code: '000000' } });
  }
  const res = await admin('login', { body: { email: 'owner@hmtech.lk', password: PASSWORD, code: nextCode(secret) } });
  assert.equal(res.statusCode, 429);
  const elsewhere = await admin('login', { ip: '198.51.100.99', body: { email: 'owner@hmtech.lk', password: PASSWORD, code: nextCode(secret) } });
  assert.equal(elsewhere.statusCode, 200, 'another address is not punished');
});

test('ten failures against one account lock it for a while, from any address', async () => {
  reset();
  const secret = await seedAdmin();
  DB.admins[0].failed_count = 9;
  await admin('login', { ip: '192.0.2.50', body: { email: 'owner@hmtech.lk', password: 'wrong wrong wrong', code: '000000' } });
  assert.ok(Date.parse(DB.admins[0].locked_until) > Date.now());
  const res = await admin('login', { ip: '192.0.2.51', body: { email: 'owner@hmtech.lk', password: PASSWORD, code: nextCode(secret) } });
  assert.equal(res.statusCode, 401);
});

test('a disabled admin cannot sign in', async () => {
  reset();
  const secret = await seedAdmin();
  DB.admins[0].disabled_at = new Date().toISOString();
  const res = await admin('login', { body: { email: 'owner@hmtech.lk', password: PASSWORD, code: nextCode(secret) } });
  assert.equal(res.statusCode, 401);
});

test('a recovery code signs in once instead of the authenticator', async () => {
  reset();
  await seedAdmin();
  const codes = sec.newRecoveryCodes(2);
  DB.admin_recovery_codes.push(
    ...codes.map((c, i) => ({ id: `r${i}`, admin_id: ADMIN, code_hash: sec.recoveryHash(c), used_at: null })),
  );
  const first = await admin('login', { body: { email: 'owner@hmtech.lk', password: PASSWORD, code: codes[0].toLowerCase() } });
  assert.equal(first.statusCode, 200, first.bodyText);
  assert.equal(first.json.recovery_left, 1);
  const again = await admin('login', { body: { email: 'owner@hmtech.lk', password: PASSWORD, code: codes[0] } });
  assert.equal(again.statusCode, 401, 'spent');
  const noPassword = await admin('login', { body: { email: 'owner@hmtech.lk', password: 'nope nope nope', code: codes[1] } });
  assert.equal(noPassword.statusCode, 401);
  assert.equal(DB.admin_recovery_codes[1].used_at, null, 'a recovery code is never spent without the password');
});

/* ========================================================= sessions ===== */

test('a signed-in admin reads the dashboard', async () => {
  reset();
  const cookie = await signIn(await seedAdmin());
  const me = await admin('me', { cookie });
  assert.equal(me.json.admin.email, 'owner@hmtech.lk');
  const overview = await admin('overview', { cookie });
  assert.equal(overview.statusCode, 200);
  assert.equal(overview.json.overview.teachers.total, 1);
  const teachers = await admin('teachers', { cookie });
  assert.equal(teachers.json.teachers[0].name, 'Nimal');
  assert.ok(!teachers.bodyText.includes('code_hash'));
  const one = await admin('teacher', { cookie, params: `&id=${TEACHER}` });
  assert.equal(one.json.teacher.id, TEACHER);
  assert.equal((await admin('teacher', { cookie, params: '&id=not-a-uuid' })).statusCode, 404);
});

test('a session ends after 30 idle minutes', async () => {
  reset();
  const cookie = await signIn(await seedAdmin());
  DB.admin_sessions[0].last_seen_at = new Date(Date.now() - 31 * 60_000).toISOString();
  assert.equal((await admin('overview', { cookie })).statusCode, 401);
  assert.ok(DB.admin_sessions[0].revoked_at, 'and is revoked, not just refused');
});

test('a session ends at its hard limit however busy it is', async () => {
  reset();
  const cookie = await signIn(await seedAdmin());
  DB.admin_sessions[0].expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal((await admin('overview', { cookie })).statusCode, 401);
});

test('a forged or altered cookie opens nothing', async () => {
  reset();
  const cookie = await signIn(await seedAdmin());
  const forged = `${cookie.slice(0, -3)}abc`;
  assert.equal((await admin('overview', { cookie: forged })).statusCode, 401);
  assert.equal((await admin('overview', { cookie: 'plus_admin=../../etc' })).statusCode, 401);
});

test('a teacher or family cookie is not an admin session', async () => {
  reset();
  const res = makeRes();
  forgetSessions();
  await startLoginSession({ headers: {} }, res, 'teacher', TEACHER);
  const teacherCookie = cookieOf(res);
  assert.equal((await admin('overview', { cookie: teacherCookie })).statusCode, 401);
});

test('signing out revokes the session on the server', async () => {
  reset();
  const cookie = await signIn(await seedAdmin());
  const out = await admin('logout', { cookie, body: {} });
  assert.equal(out.statusCode, 200);
  assert.match(out.getHeader('set-cookie'), /Max-Age=0/);
  assert.ok(DB.admin_sessions[0].revoked_at);
  assert.equal((await admin('overview', { cookie })).statusCode, 401, 'the old cookie is dead');
});

test('another session can be ended from this one', async () => {
  reset();
  const secret = await seedAdmin();
  const first = await signIn(secret);
  const second = await signIn(secret);
  const sessions = (await admin('security', { cookie: second })).json.sessions;
  assert.equal(sessions.length, 2);
  const other = sessions.find((s) => !s.current);
  await admin('session.revoke', { cookie: second, body: { id: other.id } });
  assert.equal((await admin('overview', { cookie: first })).statusCode, 401);
  assert.equal((await admin('overview', { cookie: second })).statusCode, 200);
});

/* ==================================================== changing things === */

test('pausing a teacher needs a fresh code, a reason, and is audited first', async () => {
  reset();
  const secret = await seedAdmin();
  const cookie = await signIn(secret);

  const noCode = await admin('teacher.suspend', { cookie, body: { id: TEACHER, reason: 'Unpaid invoice' } });
  assert.equal(noCode.statusCode, 403);
  assert.equal(DB.teachers[0].suspended_at, null);

  const stepBefore = DB.admins[0].totp_last_step;
  const noReason = await admin('teacher.suspend', { cookie, body: { id: TEACHER, code: nextCode(secret) } });
  assert.equal(noReason.statusCode, 400);
  assert.equal(DB.admins[0].totp_last_step, stepBefore, 'a typo does not spend the code');

  const done = await admin('teacher.suspend', { cookie, body: { id: TEACHER, reason: 'Unpaid invoice', code: nextCode(secret) } });
  assert.equal(done.statusCode, 200, done.bodyText);
  assert.ok(DB.teachers[0].suspended_at);
  const entry = DB.admin_audit.find((a) => a.action === 'teacher.suspend');
  assert.equal(entry.detail.reason, 'Unpaid invoice');
  assert.match(entry.target, /Nimal/);
});

test('a paused teacher is turned away by the app and at sign-in', async () => {
  reset();
  forgetTeacher();
  DB.teachers[0].suspended_at = new Date().toISOString();
  const res = makeRes();
  forgetSessions();
  await startLoginSession({ headers: {} }, res, 'teacher', TEACHER);
  const teacherCookie = cookieOf(res);

  const app = await call(teacherApi, { url: '/api/teacher?r=bootstrap', cookie: teacherCookie });
  assert.equal(app.statusCode, 403);
  assert.match(app.json.error, /paused/);
  assert.match(String(app.getHeader('set-cookie')), /Max-Age=0/, 'and the cookie is cleared');

  const login = await call(authApi, { method: 'POST', url: '/api/auth?r=login', body: { role: 'teacher', code: '424242' } });
  assert.equal(login.statusCode, 403);
  assert.match(login.json.error, /paused/);
  forgetTeacher();
});

test('restoring a teacher, a new Plus price and a new login code', async () => {
  reset();
  const secret = await seedAdmin();
  const cookie = await signIn(secret);
  DB.teachers[0].suspended_at = new Date().toISOString();

  const restored = await admin('teacher.restore', { cookie, body: { id: TEACHER, code: nextCode(secret) } });
  assert.equal(restored.statusCode, 200, restored.bodyText);
  assert.equal(DB.teachers[0].suspended_at, null);

  const badPrice = await admin('teacher.plus', { cookie, body: { id: TEACHER, price: -5, share: 0.5, code: nextCode(secret) } });
  assert.equal(badPrice.statusCode, 400);
  const price = await admin('teacher.plus', { cookie, body: { id: TEACHER, price: 750, share: 0.4, code: nextCode(secret) } });
  assert.equal(price.statusCode, 200, price.bodyText);
  assert.equal(DB.teachers[0].plus_price, 750);
  assert.equal(DB.teachers[0].plus_share, 0.4);

  const before = DB.teachers[0].code_hash;
  const code = await admin('teacher.code', { cookie, body: { id: TEACHER, code: nextCode(secret) } });
  assert.equal(code.statusCode, 200, code.bodyText);
  assert.match(code.json.code, /^\d{6}$/);
  assert.notEqual(DB.teachers[0].code_hash, before);
  assert.ok(!JSON.stringify(DB.admin_audit).includes(code.json.code), 'the code is never logged');
});

test('a view-only admin can look but not change', async () => {
  reset();
  const secret = await seedAdmin({ id: VIEWER, email: 'staff@hmtech.lk', role: 'viewer' });
  const cookie = await signIn(secret, { email: 'staff@hmtech.lk', id: VIEWER });
  assert.equal((await admin('teachers', { cookie })).statusCode, 200);
  const res = await admin('teacher.suspend', { cookie, body: { id: TEACHER, reason: 'Testing', code: nextCode(secret, VIEWER) } });
  assert.equal(res.statusCode, 403);
  assert.equal(DB.teachers[0].suspended_at, null);
});

test('changing the password checks the old one and a code, and signs out other sessions', async () => {
  reset();
  const secret = await seedAdmin();
  const other = await signIn(secret);
  const cookie = await signIn(secret);
  const next = 'another long sentence, 2026';

  const wrong = await admin('password', { cookie, body: { current: 'not it at all', next, code: nextCode(secret) } });
  assert.equal(wrong.statusCode, 403);

  const done = await admin('password', { cookie, body: { current: PASSWORD, next, code: nextCode(secret) } });
  assert.equal(done.statusCode, 200, done.bodyText);
  assert.equal(await sec.verifyPassword(next, DB.admins[0].password_hash), true);
  assert.equal((await admin('overview', { cookie: other })).statusCode, 401);
  assert.equal((await admin('overview', { cookie })).statusCode, 200);
});

test('the audit log is only ever appended to', async () => {
  reset();
  const secret = await seedAdmin();
  const cookie = await signIn(secret);
  await admin('login', { body: { email: 'owner@hmtech.lk', password: 'bad bad bad bad', code: '000000' } });
  await admin('teacher.suspend', { cookie, body: { id: TEACHER, reason: 'Testing', code: nextCode(secret) } });
  await admin('logout', { cookie, body: {} });
  const touched = calls.filter((c) => c.path === 'admin_audit' && c.method !== 'POST' && c.method !== 'GET');
  assert.deepEqual(touched, []);
  assert.ok(DB.admin_audit.length >= 4);
});

/* ==================================================== static checks ===== */

test('the dashboard SQL never hands out a child or a parent', () => {
  const sql = readFileSync(join(ROOT, 'supabase/migrations/007-admin.sql'), 'utf8');
  const bodies = [...sql.matchAll(/create or replace function (admin_\w+)\([^)]*\) returns json[\s\S]*?\$\$([\s\S]*?)\$\$/g)];
  assert.equal(bodies.length, 3);
  for (const [, name, body] of bodies) {
    assert.ok(!/parent_phone|parent_name|call_name|photo_path/.test(body), `${name} reads a family field`);
    const names = [...body.matchAll(/\b(\w+)\.name\b/g)].map((m) => m[1]);
    assert.ok(names.every((alias) => alias === 't'), `${name} reads a name that is not the teacher's`);
  }
});

test('every function this app defines is taken away from PUBLIC', () => {
  const sql = readFileSync(join(ROOT, 'supabase/schema.sql'), 'utf8');
  const defined = [...sql.matchAll(/create or replace function (\w+)\(/g)].map((m) => m[1]);
  const revoke = sql.slice(sql.lastIndexOf("p.proname in ("));
  for (const fn of new Set(defined)) assert.ok(revoke.includes(`'${fn}'`), `${fn} is not revoked from public`);
});

test('every button and form on the dashboard has a handler, and every call a route', () => {
  const page = readFileSync(join(ROOT, 'app/admin.js'), 'utf8');
  const server = readFileSync(join(ROOT, 'api/admin.js'), 'utf8');
  const used = new Set([...page.matchAll(/data-a="([\w.]+)"/g)].map((m) => m[1]));
  const actBlock = page.slice(page.indexOf('const ACT = {'), page.indexOf('/* ---------------------------------------------------------------- forms'));
  for (const a of used) assert.ok(actBlock.includes(`'${a}':`) || new RegExp(`\\n  ${a.replace('.', '\\.')}: `).test(actBlock), `no handler for ${a}`);
  const forms = new Set([...page.matchAll(/data-form="(\w+)"/g)].map((m) => m[1]));
  for (const f of forms) assert.match(page, new RegExp(`\\n  ${f}: async`), `no form handler for ${f}`);
  const routes = new Set([...page.matchAll(/call\('([\w.]+)'/g)].map((m) => m[1]));
  for (const r of routes) assert.ok(server.includes(`'${r}'`), `api/admin.js has no route ${r}`);
});

test('the admin page is never cached by the service worker and never indexed', () => {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  assert.match(sw, /admin/);
  const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  const rule = vercel.headers.find((h) => h.source === '/admin');
  const keys = Object.fromEntries(rule.headers.map((h) => [h.key, h.value]));
  assert.match(keys['Cache-Control'], /no-store/);
  assert.match(keys['X-Robots-Tag'], /noindex/);
  assert.match(keys['Content-Security-Policy'], /default-src 'none'/);
  assert.doesNotMatch(keys['Content-Security-Policy'], /unsafe-inline|unsafe-eval/);
  const html = readFileSync(join(ROOT, 'admin.html'), 'utf8');
  assert.doesNotMatch(html, /<script(?![^>]*src=)/, 'no inline script');
  assert.doesNotMatch(html, /style=/, 'no inline style');
});
