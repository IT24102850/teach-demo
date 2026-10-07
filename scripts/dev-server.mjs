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
import { createReadStream, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);

const read = (name) => {
  try {
    return readFileSync(join(ROOT, name), 'utf8');
  } catch {
    return '';
  }
};

/**
 * Apply the same response headers and the same exclusions as production, so a
 * thing that works here works there. Without this, local development quietly
 * runs without a Content-Security-Policy and serves the schema and the scripts.
 */
const VERCEL = (() => {
  try {
    return JSON.parse(read('vercel.json') || '{}');
  } catch {
    return {};
  }
})();

const HEADER_RULES = (VERCEL.headers || []).map((rule) => ({
  test: new RegExp(`^${String(rule.source).replace(/\(\.\*\)/g, '.*').replace(/:[A-Za-z]+/g, '[^/]+')}$`),
  headers: rule.headers || [],
}));

const IGNORED = read('.vercelignore')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
  .map((line) => line.replace(/^\/+|\/+$/g, ''));

/**
 * Files Vercel consumes at build time and never serves. They cannot go in
 * .vercelignore - the build needs them - so they are listed here instead.
 */
const NEVER_SERVED = new Set([
  'package.json', 'package-lock.json', 'vercel.json',
  '.gitignore', '.vercelignore', '.gitattributes',
]);

const isIgnored = (pathname) => {
  const clean = pathname.replace(/^\/+/, '');
  if (NEVER_SERVED.has(clean)) return true;
  // Vercel does not serve dotfiles, whatever .vercelignore says.
  if (clean.split('/').some((part) => part.startsWith('.'))) return true;
  return IGNORED.some((entry) => {
    if (entry.startsWith('*.')) return clean.endsWith(entry.slice(1));
    return clean === entry || clean.startsWith(`${entry}/`);
  });
};

function applyHeaders(res, pathname) {
  for (const rule of HEADER_RULES) {
    if (!rule.test.test(pathname)) continue;
    for (const { key, value } of rule.headers) res.setHeader(key, value);
  }
}

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

  applyHeaders(res, url.pathname);

  if (isIgnored(url.pathname)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

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
