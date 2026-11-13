/**
 * Admin accounts, from the command line only. The dashboard has no sign-up
 * page on purpose: an account exists because somebody with the server's keys
 * made it here.
 *
 *   npm run admin -- invite info@hmtech.lk "HM Tech"          an owner
 *   npm run admin -- invite staff@hmtech.lk "Front desk" --viewer
 *   npm run admin -- invite info@hmtech.lk                    lost phone: a new setup link
 *   npm run admin -- disable someone@hmtech.lk
 *   npm run admin -- enable  someone@hmtech.lk
 *   npm run admin -- list
 *
 * `invite` prints a link that works once, within 24 hours (--hours to change).
 * Opening it sets the password and the authenticator; finishing it signs out
 * every session that account had. The token is in the #fragment, which a
 * browser never sends to a server, so it cannot land in any access log.
 *
 * Needs SUPABASE_URL, SUPABASE_SERVICE_KEY and ADMIN_SECRET_KEY - the same
 * values production has, or the link will not open there.
 */

import * as db from '../api/_lib/db.js';
import { adminEnabled, newToken, setupHash } from '../api/_lib/admin-security.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !String(args[i - 1] || '').match(/^--(hours|url)$/));
const [command, rawEmail, name] = positional;
const email = String(rawEmail || '').trim().toLowerCase();

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const cliAudit = (action, target, detail = null) =>
  db.insert(
    'admin_audit',
    { admin_id: null, email: 'command line', action, target, ok: true, ip: 'cli', user_agent: 'scripts/admin.mjs', detail },
    { returning: 'minimal' },
  );

async function main() {
  if (!db.configured) fail('SUPABASE_URL and SUPABASE_SERVICE_KEY are not set.');
  if (!adminEnabled) {
    fail(
      'ADMIN_SECRET_KEY is not set (or is shorter than 32 characters).\n' +
        "  Make one:  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n" +
        '  and put the SAME value in .env and in Vercel (Production).',
    );
  }

  if (command === 'list') {
    const rows = await db.select('admins', {
      select: 'email,name,role,disabled_at,last_login_at,setup_expires_at,password_hash',
      order: 'created_at.asc',
    });
    if (!rows.length) console.log('\nNo admins yet. Start with: npm run admin -- invite <email> "<name>"\n');
    for (const a of rows) {
      const state = a.disabled_at
        ? 'disabled'
        : a.password_hash
          ? `active, last sign-in ${a.last_login_at || 'never'}`
          : `waiting for setup until ${a.setup_expires_at || '-'}`;
      console.log(`  ${a.email.padEnd(32)} ${a.role.padEnd(7)} ${state}`);
    }
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail('Give an email address.');
  const existing = await db.selectOne('admins', { select: 'id,email,role,disabled_at', email: `eq.${email}` });

  if (command === 'disable' || command === 'enable') {
    if (!existing) fail(`No admin with the email ${email}.`);
    const disabling = command === 'disable';
    await cliAudit(`admin.${command}`, email);
    await db.update('admins', { disabled_at: disabling ? new Date().toISOString() : null }, { id: `eq.${existing.id}` });
    if (disabling) {
      await db.update(
        'admin_sessions',
        { revoked_at: new Date().toISOString() },
        { admin_id: `eq.${existing.id}`, revoked_at: 'is.null' },
      );
    }
    console.log(`\n${email} is ${disabling ? 'disabled and signed out everywhere' : 'enabled again'}.\n`);
    return;
  }

  if (command !== 'invite') fail('Commands: invite, disable, enable, list.');

  const hours = Math.min(72, Math.max(1, Number(option('hours') || 24)));
  const token = newToken();
  const patch = {
    setup_token_hash: setupHash(token),
    setup_expires_at: new Date(Date.now() + hours * 3_600_000).toISOString(),
    totp_pending: null,
  };

  if (existing) {
    await cliAudit('invite.reissued', email, { hours });
    await db.update('admins', { ...patch, disabled_at: null }, { id: `eq.${existing.id}` });
  } else {
    await cliAudit('invite.issued', email, { hours, role: flag('viewer') ? 'viewer' : 'owner' });
    await db.insert(
      'admins',
      { email, name: name || null, role: flag('viewer') ? 'viewer' : 'owner', ...patch },
      { returning: 'minimal' },
    );
  }

  const base = String(option('url') || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  console.log(`\nSetup link for ${email} (works once, for ${hours} hours):\n`);
  console.log(`  ${base}/admin#setup=${token}\n`);
  console.log('Send it privately - whoever opens it first owns the account.');
  if (existing) console.log('Their current password and authenticator keep working until the link is used.');
  console.log('');
}

main().catch((err) => fail(err.message));
