/** Small helpers shared by every function in /api. */

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export const ok = (res, body = {}) => json(res, 200, body);
export const bad = (res, message, status = 400) => json(res, status, { error: message });

/** Read and parse a JSON body (Vercel does this for us, but not under every runtime). */
export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

/** `?r=` resource name used to route inside one serverless function. */
export function resource(req) {
  const url = new URL(req.url, 'http://localhost');
  return url.searchParams.get('r') || '';
}

export function query(req) {
  const url = new URL(req.url, 'http://localhost');
  return Object.fromEntries(url.searchParams.entries());
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Wrap a handler so an unexpected throw becomes a clean 500 instead of a
 * crashed function, and a DbError keeps its own status.
 */
export function guard(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
      if (status >= 500) console.error('[api]', err);
      json(res, status, { error: err?.message || 'Something went wrong' });
    }
  };
}
