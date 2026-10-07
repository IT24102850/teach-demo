/**
 * A local stand-in for Vercel, so the app runs without an account:
 *
 *   node --env-file=.env scripts/dev-server.mjs      then open http://localhost:3000
 *
 * It serves the static files from the repository root and routes /api/<name>
 * to api/<name>.js, exactly as Vercel does. `vercel dev` works too; this is
 * here so nothing about running the app depends on being logged in.
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

/** Same rewrites as vercel.json. */
function rewrite(pathname) {
  if (pathname === '/' || pathname === '') return '/index.html';
  if (pathname === '/join' || pathname.startsWith('/join/')) return '/join.html';
  return pathname;
}

const handlers = new Map();

async function apiHandler(name) {
  if (!handlers.has(name)) {
    const module = await import(`../api/${name}.js`);
    handlers.set(name, module.default);
  }
  return handlers.get(name);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/\/+$/, '');
    if (!/^[a-z-]+$/.test(name)) {
      res.writeHead(404).end('Not found');
      return;
    }
    try {
      const handler = await apiHandler(name);
      await handler(req, res);
    } catch (err) {
      console.error(`[api/${name}]`, err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  const target = normalize(join(ROOT, rewrite(decodeURIComponent(url.pathname))));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<p style="font:16px sans-serif;padding:24px">Not found</p>');
  }
});

server.listen(PORT, () => {
  const ready = process.env.SUPABASE_URL && process.env.SESSION_SECRET;
  console.log(`\n  Plus running on http://localhost:${PORT}`);
  console.log(
    ready
      ? '  Database: connected\n'
      : '  Database: not configured yet - fill in .env (see .env.example)\n',
  );
});
