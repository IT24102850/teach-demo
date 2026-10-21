/**
 * Static checks on the wiring, so a typo cannot ship as a dead button.
 *
 *  - every data-a="..." in the screens has a handler
 *  - every t('key') exists in the English dictionary
 *  - every English key also exists in Tamil
 *  - the service worker lists the files the page actually loads
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const SCREEN_FILES = [
  'app/main.js',
  'app/ui.js',
  'app/screens/login.js',
  'app/screens/teacher.js',
  'app/screens/teacher-forms.js',
  'app/screens/family.js',
  'app/screens/income.js',
  'app/join.js',
  'app/onboard.js',
  'app/fonts.js',
];

const sources = Object.fromEntries(SCREEN_FILES.map((f) => [f, read(f)]));
const allSource = Object.values(sources).join('\n');

/* ------------------------------------------------------------- actions --- */

/** Action names used in markup, e.g. data-a="fees.pay" or { act: 'fees.pay' }. */
function usedActions() {
  const names = new Set();
  for (const match of allSource.matchAll(/data-a="([a-zA-Z][\w.]*)"/g)) names.add(match[1]);
  for (const match of allSource.matchAll(/\bact:\s*'([\w.]+)'/g)) names.add(match[1]);
  return names;
}

/** Action names defined in an ACTIONS object or the shell table. */
function definedActions() {
  const names = new Set();
  for (const src of Object.values(sources)) {
    for (const match of src.matchAll(/^\s{2}'([\w.]+)':/gm)) names.add(match[1]);
    for (const match of src.matchAll(/^\s{2}([a-z][\w]*):\s*(\(|async)/gm)) names.add(match[1]);
  }
  // join.js routes the wizard with an if/else chain instead of a table, so
  // its actions are listed here. Keep this in step with the chain in join.js.
  for (const name of ['curriculum', 'subject', 'submit', 'step.next', 'step.back', 'photo.pick', 'close']) {
    names.add(name);
  }
  return names;
}

test('every button action has a handler', () => {
  const defined = definedActions();
  const missing = [...usedActions()].filter((name) => !defined.has(name));
  assert.deepEqual(missing, [], `actions with no handler: ${missing.join(', ')}`);
});

test('no handler is defined twice in the same table', () => {
  for (const [file, src] of Object.entries(sources)) {
    const seen = new Set();
    const duplicates = [];
    for (const match of src.matchAll(/^\s{2}'([\w.]+)':/gm)) {
      if (seen.has(match[1])) duplicates.push(match[1]);
      seen.add(match[1]);
    }
    assert.deepEqual(duplicates, [], `${file} defines ${duplicates.join(', ')} twice`);
  }
});

/* ---------------------------------------------------------- translation -- */

const i18n = read('app/i18n.js');

function dictKeys(name) {
  const start = i18n.indexOf(`const ${name} = {`);
  assert.ok(start > -1, `${name} dictionary not found`);
  const end = i18n.indexOf('\n};', start);
  const body = i18n.slice(start, end);
  return new Set([...body.matchAll(/^\s{2}([a-z][\w]*):/gm)].map((m) => m[1]));
}

const EN_KEYS = dictKeys('EN');
const TA_KEYS = dictKeys('TA');

test('every t() key exists in English', () => {
  const used = new Set([...allSource.matchAll(/\bt\('([\w]+)'/g)].map((m) => m[1]));
  // Tab labels and status keys are looked up from variables, so add them here.
  for (const extra of ['today', 'classes', 'students', 'fees', 'home', 'board', 'marks', 'papers',
    'done', 'not_marked', 'reminded', 'not_sent', 'individual', 'small_group', 'group', 'income',
    'day', 'week', 'month', 'absent', 'fee', 'paid', 'mark', 'report', 'class', 'slip', 'join']) {
    used.add(extra);
  }
  const missing = [...used].filter((key) => !EN_KEYS.has(key));
  assert.deepEqual(missing, [], `missing English keys: ${missing.join(', ')}`);
});

test('Tamil has every key English has', () => {
  const missing = [...EN_KEYS].filter((key) => !TA_KEYS.has(key));
  assert.deepEqual(missing, [], `missing Tamil keys: ${missing.join(', ')}`);
});

test('Tamil labels are short enough for a button', () => {
  // Tamil runs longer than English (section 8.4), so the short labels that sit
  // inside pills and segmented controls must stay short.
  const tight = ['save', 'cancel', 'done', 'send', 'open', 'add', 'day', 'week', 'month', 'paid', 'present'];
  const start = i18n.indexOf('const TA = {');
  const body = i18n.slice(start, i18n.indexOf('\n};', start));
  for (const key of tight) {
    const match = new RegExp(`^  ${key}: '([^']*)'`, 'm').exec(body);
    assert.ok(match, `${key} is missing from Tamil`);
    assert.ok(match[1].length <= 22, `Tamil "${key}" is ${match[1].length} characters: ${match[1]}`);
  }
});

/* ------------------------------------------------------ service worker --- */

test('the service worker caches every module the page loads', () => {
  const sw = read('sw.js');
  const modules = new Set(['/app/main.js']);
  for (const file of SCREEN_FILES) {
    const src = read(file);
    // Static `from './x.js'` and dynamic `import('./x.js')` both have to be
    // in the offline shell, or the app breaks the moment it is installed.
    const imports = [...src.matchAll(/from '(\.[^']+)'/g), ...src.matchAll(/import\('(\.[^']+)'\)/g)];
    for (const match of imports) {
      const resolved = join('/', dirname(file), match[1]).replace(/\\/g, '/');
      modules.add(resolved);
    }
  }
  const missing = [...modules].filter((m) => !sw.includes(`'${m}'`));
  assert.deepEqual(missing, [], `not cached by sw.js: ${missing.join(', ')}`);
});

/* ------------------------------------------------- client/server contract -- */

function serverCases(file) {
  return new Set([...read(file).matchAll(/case '([\w.]+)':/g)].map((m) => m[1]));
}

test('every action the browser posts exists on the server', () => {
  const screens = SCREEN_FILES.map(read).join('\n');

  const teacherCalls = [...screens.matchAll(/teacherDo\('([\w.]+)'/g)].map((m) => m[1]);
  const teacherHandled = serverCases('api/teacher.js');
  const missingTeacher = [...new Set(teacherCalls)].filter((a) => !teacherHandled.has(a));
  assert.deepEqual(missingTeacher, [], `api/teacher.js does not handle: ${missingTeacher.join(', ')}`);
  assert.ok(teacherCalls.length > 15, 'the teacher actions were not found at all');

  const familyCalls = [...screens.matchAll(/familyDo\('([\w.]+)'/g)].map((m) => m[1]);
  const familyHandled = serverCases('api/family.js');
  const missingFamily = [...new Set(familyCalls)].filter((a) => !familyHandled.has(a));
  assert.deepEqual(missingFamily, [], `api/family.js does not handle: ${missingFamily.join(', ')}`);
});

/* --------------------------------------------------- serverless budget --- */

test('the api stays inside Vercel’s free function count', () => {
  const functions = readdirSync(join(ROOT, 'api')).filter((f) => f.endsWith('.js'));
  assert.ok(functions.length <= 12, `${functions.length} functions: the Hobby plan allows 12`);
  assert.ok(functions.length > 0);
});

test('nothing outside /api can reach the service role key', () => {
  for (const file of SCREEN_FILES.concat(['app/api.js', 'app/state.js', 'app/rules.js'])) {
    const src = read(file);
    assert.ok(!src.includes('SUPABASE_SERVICE'), `${file} refers to the service key`);
    assert.ok(!src.includes('_lib/db.js'), `${file} imports the database client`);
  }
});

/* --------------------------------------------- the service worker strategy */

test('app code is served network first, so a deploy actually reaches people', () => {
  const sw = read('sw.js');

  /*
   * This used to be `caches.match(req).then(hit => hit || fetch(req))`:
   * cache first, network only on a miss. A browser that had opened the app
   * once kept serving the JS it already had, so new screens never arrived
   * and teachers saw the old login for as long as the cache name stayed put.
   * Bumping the name on every deploy is easy to forget and silent when you
   * do. Network first cannot be forgotten.
   */
  assert.match(sw, /async function networkFirst\(/);
  assert.match(sw, /networkFirst\(event\.request\)/, 'the default path is the network');
  assert.doesNotMatch(
    sw,
    /caches\.match\(event\.request\)\.then\(\s*\(hit\) =>\s*hit \|\|/,
    'app code must not be served cache-first',
  );

  // Offline still works: the cache is the fallback, and a navigation with
  // nothing cached still gets the shell.
  assert.match(sw, /const hit = await caches\.match\(request\)/);
  assert.match(sw, /request\.mode === 'navigate'/);

  // Bytes that never change without changing name stay cache-first.
  assert.match(sw, /const IMMUTABLE = /);
  assert.match(sw, /cacheFirst\(event\.request\) : networkFirst/);

  // A new worker has to take over at once, not on the next cold start.
  assert.match(sw, /self\.skipWaiting\(\)/);
  assert.match(sw, /self\.clients\.claim\(\)/);
});
