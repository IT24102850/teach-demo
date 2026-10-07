/**
 * Supabase access over PostgREST, with no npm dependencies (global fetch).
 *
 * This module holds the SERVICE ROLE key, so it must only ever be imported by
 * files under /api. Row level security is on for every table and no policy is
 * granted to the anon key, so the database is unreachable from the browser.
 */

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const configured = Boolean(URL_BASE && KEY);

export class DbError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function headers(extra = {}) {
  return {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function request(path, init = {}) {
  if (!configured) {
    throw new DbError('Supabase is not configured on the server', 503);
  }
  const res = await fetch(`${URL_BASE}${path}`, { ...init, headers: headers(init.headers) });
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const message = (body && (body.message || body.error || body.hint)) || `Database error ${res.status}`;
    throw new DbError(message, res.status === 404 ? 500 : 500, body);
  }
  return body;
}

/** Build a PostgREST query string from a filter object. */
function qs(params = {}) {
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/** SELECT rows from a table or view. */
export function select(table, params = {}) {
  return request(`/rest/v1/${table}${qs(params)}`, { method: 'GET' });
}

/** SELECT a single row (or null). */
export async function selectOne(table, params = {}) {
  const rows = await select(table, { ...params, limit: 1 });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * PostgREST will only take a bulk insert whose objects all have the same keys,
 * and its own complaint ("All object keys must match") does not say which row
 * or which key. Say it here instead.
 */
function assertUniformRows(table, rows) {
  if (!Array.isArray(rows) || rows.length < 2) return;
  const expected = Object.keys(rows[0]).sort();
  for (let i = 1; i < rows.length; i += 1) {
    const actual = Object.keys(rows[i]).sort();
    if (actual.join() === expected.join()) continue;
    const missing = expected.filter((k) => !actual.includes(k));
    const extra = actual.filter((k) => !expected.includes(k));
    throw new DbError(
      `Bulk insert into "${table}": row ${i} has a different shape from row 0` +
        `${missing.length ? `, missing ${missing.join(', ')}` : ''}` +
        `${extra.length ? `, unexpected ${extra.join(', ')}` : ''}` +
        '. Every row of a bulk insert must carry the same keys.',
      500,
    );
  }
}

/** INSERT one or many rows; returns the inserted rows. */
export function insert(table, rows, { onConflict, returning = 'representation' } = {}) {
  assertUniformRows(table, rows);
  const params = {};
  if (onConflict) params.on_conflict = onConflict;
  const prefer = [`return=${returning}`];
  if (onConflict) prefer.push('resolution=merge-duplicates');
  return request(`/rest/v1/${table}${qs(params)}`, {
    method: 'POST',
    headers: { Prefer: prefer.join(',') },
    body: JSON.stringify(rows),
  });
}

/** PATCH rows matching the filter; returns the updated rows. */
export function update(table, patch, filter = {}) {
  return request(`/rest/v1/${table}${qs(filter)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
}

/** DELETE rows matching the filter. */
export function remove(table, filter = {}) {
  return request(`/rest/v1/${table}${qs(filter)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
}

/** Call a Postgres function (used for the transactional writes). */
export function rpc(fn, args = {}) {
  return request(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
}

/** PostgREST `in` filter value: in.(a,b,c) */
export const inList = (values) => `in.(${values.map((v) => `"${String(v).replace(/"/g, '')}"`).join(',')})`;

/* ----------------------------------------------------------------- storage -- */

/** Upload bytes to a private bucket. */
export async function uploadObject(bucket, path, bytes, contentType) {
  if (!configured) throw new DbError('Supabase is not configured on the server', 503);
  const res = await fetch(`${URL_BASE}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': contentType || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: bytes,
  });
  if (!res.ok) throw new DbError(`Upload failed: ${await res.text()}`, 500);
  return `${bucket}/${path}`;
}

/** Short-lived signed URL for a private object. */
export async function signObject(bucket, path, expiresIn = 600) {
  if (!configured) throw new DbError('Supabase is not configured on the server', 503);
  const res = await fetch(`${URL_BASE}/storage/v1/object/sign/${bucket}/${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body.signedURL ? `${URL_BASE}/storage/v1${body.signedURL}` : null;
}
