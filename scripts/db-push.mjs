/**
 * Apply supabase/schema.sql to the database.
 *
 *   node --env-file=.env scripts/db-push.mjs          # apply
 *   node --env-file=.env scripts/db-push.mjs --dry    # parse and report only
 *
 * DATABASE_URL comes from the Supabase dashboard: Connect -> Session pooler
 * (the IPv4 one; the direct db.<ref>.supabase.co host is IPv6-only, which many
 * networks cannot reach).
 *
 * The whole file is sent as one simple-query message, so PostgreSQL runs it in
 * a single implicit transaction: either every statement lands or none does.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, PgError } from './pg.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');

export function parseDatabaseUrl(raw) {
  if (!raw || raw.startsWith('PASTE')) {
    throw new Error(
      'DATABASE_URL is not set.\n' +
        '  Supabase dashboard -> Connect -> Session pooler, copy the URL into .env as DATABASE_URL.',
    );
  }
  const url = new URL(raw);
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    throw new Error(`DATABASE_URL should start with postgresql:// (got ${url.protocol}//)`);
  }
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, '') || 'postgres',
  };
}

/** Point at the character the server complained about. */
function showPosition(sql, position) {
  const at = Number(position);
  if (!at || Number.isNaN(at)) return '';
  const before = sql.slice(0, at);
  const line = before.split('\n').length;
  const start = Math.max(0, before.lastIndexOf('\n'));
  const end = sql.indexOf('\n', at) === -1 ? sql.length : sql.indexOf('\n', at);
  return `\n  line ${line}: ${sql.slice(start, end).trim()}`;
}

async function main() {
  const sql = readFileSync(join(ROOT, 'supabase', 'schema.sql'), 'utf8');
  const statements = sql.split(/;\s*\n/).filter((s) => s.trim() && !/^\s*--/.test(s)).length;
  console.log(`\nschema.sql: ${sql.length.toLocaleString()} characters, about ${statements} statements`);

  if (DRY) {
    console.log('--dry: nothing was sent.\n');
    return;
  }

  const target = parseDatabaseUrl(process.env.DATABASE_URL);
  console.log(`connecting to ${target.host}:${target.port} as ${target.user}`);

  const db = await connect(target);
  try {
    const { notices } = await db.query(sql);
    for (const notice of notices) {
      if (notice.S && notice.S !== 'NOTICE') console.log(`  ${notice.S}: ${notice.M}`);
    }

    const [tables, views, functions, buckets] = await Promise.all([
      db.rows(
        "select count(*) n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'",
      ),
      db.rows("select count(*) n from information_schema.views where table_schema='public'"),
      db.rows(
        "select count(*) n from information_schema.routines where routine_schema='public' and routine_name in ('finish_class','start_class','record_payment','reverse_payment')",
      ),
      db.rows("select count(*) n from storage.buckets where id in ('slips','papers','photos')"),
    ]);

    console.log('\napplied.');
    console.log(`  tables    ${tables[0].n}`);
    console.log(`  views     ${views[0].n}`);
    console.log(`  functions ${functions[0].n} of 4`);
    console.log(`  buckets   ${buckets[0].n} of 3`);
    console.log('\nNext: node --env-file=.env scripts/db-verify.mjs\n');
  } finally {
    db.end();
  }
}

main().catch((err) => {
  if (err instanceof PgError) {
    const sql = readFileSync(join(ROOT, 'supabase', 'schema.sql'), 'utf8');
    console.error(`\nThe database refused the schema:\n  ${err.describe()}${showPosition(sql, err.position)}`);
    console.error('\nNothing was changed - the whole file runs as one transaction.\n');
  } else {
    console.error(`\n${err.message}\n`);
  }
  process.exit(1);
});
