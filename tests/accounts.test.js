/**
 * The accounts library (migration 008): passwords, lockout, invites and the
 * request checks. The parts that need the database are driven end to end in
 * api.test.js.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-'.padEnd(48, 'x');
process.env.LOGIN_PEPPER = process.env.LOGIN_PEPPER || 'test-pepper-'.padEnd(48, 'y');
process.env.PASSWORD_SCRYPT_LOG2 = '12'; // fast in tests; the cost travels in each hash

const A = await import('../api/_lib/accounts.js');
const { hashCode } = await import('../api/_lib/session.js');

test('a password must be long enough, not common, and not personal', () => {
  assert.equal(A.passwordProblem('short'), 'password_short');
  assert.equal(A.passwordProblem('password123'), 'password_common');
  assert.equal(A.passwordProblem('aaaaaaaaaa'), 'password_common', 'one character repeated');
  assert.equal(A.passwordProblem('0771234567', { phone: '94771234567' }), 'password_personal');
  assert.equal(A.passwordProblem('shehan2026!', { email: 'shehan@example.com' }), 'password_personal');
  assert.equal(A.passwordProblem('blue-kettle-42'), null);
  assert.equal(A.passwordProblem('x'.repeat(129)), 'password_long');
  for (const code of ['password_short', 'password_common', 'password_personal', 'password_long']) {
    assert.ok(A.PASSWORD_MESSAGES[code], `${code} has a sentence`);
  }
});

test('a hashed password checks out, and a wrong one does not', async () => {
  const stored = await A.hashPassword('blue-kettle-42');
  assert.match(stored, /^s2\$12\$[0-9a-f]{32}\$[0-9a-f]{64}$/, 'the cost is written into the hash');
  assert.deepEqual(await A.verifyPassword('blue-kettle-42', stored), { ok: true, rehash: false });
  assert.equal((await A.verifyPassword('blue-kettle-43', stored)).ok, false);
  assert.notEqual(await A.hashPassword('blue-kettle-42'), stored, 'a fresh salt every time');
});

test("a teacher's old-format password still works, and asks to be upgraded", async () => {
  const { hash, salt } = hashCode('old-password-1');
  assert.deepEqual(await A.verifyPassword('old-password-1', hash, salt), { ok: true, rehash: true });
  assert.equal((await A.verifyPassword('wrong-password', hash, salt)).ok, false);
  assert.equal((await A.verifyPassword('old-password-1', hash)).ok, false, 'no salt, no match');
});

test('five wrong passwords lock the account, and the lock doubles', () => {
  const now = Date.parse('2026-11-13T10:00:00Z');
  let row = { failed_logins: 0 };
  for (let i = 0; i < 4; i += 1) row = { ...row, ...A.failurePatch(row, now) };
  assert.equal(row.locked_until, undefined, 'four mistakes are allowed');
  row = { ...row, ...A.failurePatch(row, now) };
  assert.equal(A.lockedFor(row, now), 15, 'the fifth locks it for 15 minutes');
  for (let i = 0; i < 5; i += 1) row = { ...row, ...A.failurePatch(row, now) };
  assert.equal(A.lockedFor(row, now), 30, 'the tenth for 30');
  assert.equal(A.lockedFor(row, now + 31 * 60_000), 0, 'and it ends');
  assert.deepEqual(Object.keys(A.successPatch()).sort(), ['failed_logins', 'last_login_at', 'locked_until']);
});

test('an invite is 6 digits, and its lookup ignores spaces', () => {
  const codes = new Set(Array.from({ length: 200 }, A.inviteCode));
  for (const code of codes) assert.match(code, /^\d{6}$/);
  assert.ok(codes.size > 190, 'random, not repeating');
  assert.equal(A.inviteLookup('123 456'), A.inviteLookup('123456'));
  assert.notEqual(A.inviteLookup('123456'), A.inviteLookup('123457'));
});

test('a state-changing request must come from the app itself', () => {
  const req = (origin, host = 'plus.test') => ({ headers: { origin, host } });
  assert.equal(A.sameOrigin(req('https://plus.test')), true);
  assert.equal(A.sameOrigin(req('https://evil.example')), false);
  assert.equal(A.sameOrigin(req(undefined)), true, 'no Origin header: an older same-origin fetch');
  assert.equal(A.sameOrigin(req('not a url')), false);
});
