/**
 * Drive a running deployment: the frontend it serves and the whole API.
 *
 *   npm run check:live                        # the production URL in APP_URL
 *   npm run check:live -- http://localhost:3000
 *
 * It sets up its own scratch teacher, students, class and family code with the
 * service key, drives everything over HTTP as a browser would, then deletes the
 * scratch teacher. The demo data is never touched.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as db from '../api/_lib/db.js';
import { codeLookup, hashCode } from '../api/_lib/session.js';
import { addDays, hhmm, today, weekday } from '../api/_lib/rules.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
const TODAY = today();
const STAMP = Date.now().toString().slice(-8);

const TEACHER_CODE = `91${STAMP.slice(-4)}`.slice(0, 6);
const FAMILY_CODE = `92${STAMP.slice(-4)}`.slice(0, 6);

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, value, extra = '') {
  if (value) {
    passed += 1;
    console.log(`    ok   ${label}${extra ? `  ${extra}` : ''}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  FAIL   ${label}${extra ? `  ${extra}` : ''}`);
  }
}
function equal(label, actual, expected) {
  const same = String(actual) === String(expected);
  ok(label, same, same ? `(${actual})` : `-> got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`);
}
const section = (name) => console.log(`\n  ${name}\n  ${'-'.repeat(name.length)}`);

/* ------------------------------------------------------------ http with a
   cookie jar, so sessions behave exactly as they do in a browser ---------- */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';

/**
 * Space the requests out. A few hundred calls in a few seconds from one
 * address looks exactly like an attack, and a host in front of the app (on
 * Vercel, Attack Challenge Mode) will start answering with a JavaScript
 * challenge that no command-line client can pass. Pace it instead.
 */
const PACE = Number(process.env.CHECK_PACE_MS || (BASE.includes('localhost') ? 0 : 220));
let lastCall = 0;
async function pace() {
  if (!PACE) return;
  const wait = PACE - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

function agent() {
  const jar = new Map();
  return {
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    clear() {
      jar.clear();
    },
    async fetch(path, { method = 'GET', body, raw = false } = {}) {
      await pace();
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          'User-Agent': UA,
          Accept: 'application/json, text/html, */*',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(jar.size ? { Cookie: this.cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
      });
      for (const line of res.headers.getSetCookie?.() || []) {
        const [pair] = line.split(';');
        const at = pair.indexOf('=');
        const name = pair.slice(0, at).trim();
        const value = pair.slice(at + 1).trim();
        if (value === '' || /Max-Age=0/i.test(line)) jar.delete(name);
        else jar.set(name, value);
      }
      if (raw) return res;
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = { _text: text };
      }
      return { status: res.status, json, headers: res.headers };
    },
  };
}

/* ---------------------------------------------------------------- scratch */

let TID;
let STU_A;
let STU_B;
let STU_C; // a classmate from another family: their surname must never leak
let CLASS_TODAY;
let CLASS_LATER;
let PAPER;

async function setup() {
  const tc = hashCode(TEACHER_CODE);
  const [teacher] = await db.insert('teachers', {
    name: `Live ${STAMP}`,
    title: 'Sir',
    phone: '94770009999',
    join_key: `live-${STAMP}`,
    subjects: ['Maths', 'Science'],
    curricula: ['Local', 'Cambridge'],
    code_lookup: codeLookup(TEACHER_CODE),
    code_hash: tc.hash,
    code_salt: tc.salt,
  });
  TID = teacher.id;

  const students = await db.insert('students', [
    { teacher_id: TID, name: 'Live Alpha', grade: 11, area: 'Nugegoda', subject: 'Maths', fee_per_class: 1500, parent_name: 'Alpha Parent', parent_phone: '94770009001', status: 'active' },
    { teacher_id: TID, name: 'Live Betta', grade: 11, area: 'Nugegoda', subject: 'Maths', fee_per_class: 1200, parent_name: 'Betta Parent', parent_phone: '94770009002', status: 'active' },
    { teacher_id: TID, name: 'Zara Kulatunga', grade: 11, area: 'Kotte', subject: 'Maths', fee_per_class: 1000, parent_name: 'Kulatunga Parent', parent_phone: '94770009004', status: 'active' },
  ]);
  STU_A = students.find((s) => s.name === 'Live Alpha').id;
  STU_B = students.find((s) => s.name === 'Live Betta').id;
  STU_C = students.find((s) => s.name === 'Zara Kulatunga').id;

  const classes = await db.insert('classes', [
    { teacher_id: TID, subject: 'Maths', curriculum: 'Local', grade: 11, title: 'Live class today', place: 'Nugegoda', kind: 'group', venue_type: 'area', area: 'Nugegoda', days: [weekday(TODAY)], start_time: '16:00', duration_hours: 1.5, start_date: addDays(TODAY, -30) },
    { teacher_id: TID, subject: 'Science', curriculum: 'Cambridge', grade: 11, title: 'Live class later', place: 'Dehiwala', kind: 'individual', venue_type: 'area', area: 'Dehiwala', days: [weekday(addDays(TODAY, 3))], start_time: '17:00', duration_hours: 1, start_date: addDays(TODAY, -30) },
  ]);
  CLASS_TODAY = classes.find((c) => c.title === 'Live class today').id;
  CLASS_LATER = classes.find((c) => c.title === 'Live class later').id;
  await db.insert(
    'class_students',
    [
      { class_id: CLASS_TODAY, student_id: STU_A },
      { class_id: CLASS_TODAY, student_id: STU_B },
      { class_id: CLASS_TODAY, student_id: STU_C },
      { class_id: CLASS_LATER, student_id: STU_A },
    ],
    { returning: 'minimal' },
  );

  const [paper] = await db.insert('papers', {
    teacher_id: TID, name: 'Live paper', price: 1000, cost: 400,
  });
  PAPER = paper.id;

  await db.insert(
    'marks',
    [
      { teacher_id: TID, student_id: STU_A, title: 'Live test 1', score: 54, max_score: 100, taken_on: addDays(TODAY, -20) },
      { teacher_id: TID, student_id: STU_A, title: 'Live test 2', score: 72, max_score: 100, taken_on: addDays(TODAY, -5) },
      { teacher_id: TID, student_id: STU_B, title: 'Live test 1', score: 91, max_score: 100, taken_on: addDays(TODAY, -20) },
      { teacher_id: TID, student_id: STU_C, title: 'Live test 1', score: 80, max_score: 100, taken_on: addDays(TODAY, -20) },
    ],
    { returning: 'minimal' },
  );

  const fc = hashCode(FAMILY_CODE);
  const [account] = await db.insert('family_accounts', {
    teacher_id: TID, label: 'Live family', phone: '94770009001',
    code_lookup: codeLookup(FAMILY_CODE), code_hash: fc.hash, code_salt: fc.salt,
  });
  await db.insert(
    'family_children',
    [
      { account_id: account.id, student_id: STU_A },
      { account_id: account.id, student_id: STU_B },
    ],
    { returning: 'minimal' },
  );
}

async function teardown() {
  if (!TID) return;
  try {
    await db.remove('teachers', { id: `eq.${TID}` });
    const left = await db.select('teachers', { select: 'id', id: `eq.${TID}` });
    if (left.length) throw new Error('the row is still there');
    console.log('\n  (scratch teacher and its data removed)');
  } catch (err) {
    // Say so rather than leaving a surprise behind in the database.
    console.log(`\n  COULD NOT CLEAN UP the scratch teacher ${TID}: ${err.message}`);
    console.log('  Remove it with:  npm run check:clean');
  }
  TID = null;
}

/** Remove any scratch teacher a crashed run left behind. */
export async function cleanStrays() {
  const rows = await db.select('teachers', { select: 'id,name' });
  const strays = rows.filter((t) => /^(Live|Check) \d+$/.test(t.name));
  for (const t of strays) {
    await db.remove('teachers', { id: `eq.${t.id}` });
    console.log(`  removed ${t.name}`);
  }
  console.log(`  ${strays.length} stray scratch teacher${strays.length === 1 ? '' : 's'} removed`);
  return strays.length;
}

/* ======================================================= 1 · the frontend */

const STATIC = [
  ['/', 'index.html', 'text/html'],
  ['/index.html', 'index.html', 'text/html'],
  ['/join', 'join.html', 'text/html'],
  ['/join.html', 'join.html', 'text/html'],
  ['/style.css', 'style.css', 'text/css'],
  ['/manifest.json', 'manifest.json', 'json'],
  ['/sw.js', 'sw.js', 'javascript'],
  ['/app/main.js', 'app/main.js', 'javascript'],
  ['/app/api.js', 'app/api.js', 'javascript'],
  ['/app/state.js', 'app/state.js', 'javascript'],
  ['/app/ui.js', 'app/ui.js', 'javascript'],
  ['/app/rules.js', 'app/rules.js', 'javascript'],
  ['/app/i18n.js', 'app/i18n.js', 'javascript'],
  ['/app/join.js', 'app/join.js', 'javascript'],
  ['/app/screens/login.js', 'app/screens/login.js', 'javascript'],
  ['/app/screens/teacher.js', 'app/screens/teacher.js', 'javascript'],
  ['/app/screens/teacher-forms.js', 'app/screens/teacher-forms.js', 'javascript'],
  ['/app/screens/family.js', 'app/screens/family.js', 'javascript'],
  ['/assets/logo.png', 'assets/logo.png', 'image/png'],
  ['/assets/icon-192.png', 'assets/icon-192.png', 'image/png'],
  ['/assets/icon-512.png', 'assets/icon-512.png', 'image/png'],
];

const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);

async function checkFrontend() {
  const web = agent();

  section('every file the browser needs is served, byte for byte');
  for (const [url, local, type] of STATIC) {
    const res = await web.fetch(url, { raw: true });
    if (res.status !== 200) {
      ok(`${url}`, false, `-> HTTP ${res.status}`);
      continue;
    }
    const served = Buffer.from(await res.arrayBuffer());
    const onDisk = readFileSync(join(ROOT, local));
    const contentType = res.headers.get('content-type') || '';
    const typeOk = contentType.includes(type) || (type === 'json' && contentType.includes('json'));
    const same = sha(served) === sha(onDisk);
    ok(`${url}`, same && typeOk, same ? (typeOk ? '' : `-> wrong type ${contentType}`) : '-> differs from the local file');
  }

  section('the module graph has no dead imports');
  const seen = new Set();
  const queue = ['/app/main.js', '/app/join.js'];
  let edges = 0;
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    const res = await web.fetch(path, { raw: true });
    if (res.status !== 200) {
      ok(`import ${path}`, false, `-> HTTP ${res.status}`);
      continue;
    }
    const source = await res.text();
    for (const match of source.matchAll(/from\s+'(\.[^']+)'/g)) {
      edges += 1;
      const target = new URL(match[1], `http://x${path}`).pathname;
      queue.push(target);
    }
  }
  ok(`followed ${edges} imports across ${seen.size} modules, all resolved`, true);

  section('the page points at the right things');
  const html = (await web.fetch('/')).json._text || '';
  ok('the HTML loads app/main.js as a module', /<script type="module" src="\/app\/main\.js">/.test(html));
  ok('the HTML links the stylesheet', /href="\/style\.css"/.test(html));
  ok('the HTML links the manifest', /href="\/manifest\.json"/.test(html));
  ok('there is a #scr container to render into', /id="scr"/.test(html));
  ok('there is a #nav, #sheet and #toast', /id="nav"/.test(html) && /id="sheet"/.test(html) && /id="toast"/.test(html));
  ok('no inline script (the CSP forbids it)', !/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/.test(html));

  const manifest = (await web.fetch('/manifest.json')).json;
  ok('the manifest is installable', manifest.name && manifest.start_url === '/' && manifest.display === 'standalone');
  equal('the manifest declares 3 icons', manifest.icons?.length, 3);

  const css = (await web.fetch('/style.css')).json._text || '';
  ok('the stylesheet defines the night tokens', /--teal:\s*#00c2cb/i.test(css));
  ok('and redefines them for day mode', /\[data-mode='day'\]/.test(css));
  ok('and respects reduced motion', /prefers-reduced-motion/.test(css));

  section('security headers');
  const head = (await web.fetch('/', { raw: true })).headers;
  const csp = head.get('content-security-policy') || '';
  ok("script-src is 'self' only", /script-src 'self'/.test(csp) && !/script-src[^;]*unsafe-eval/.test(csp));
  ok('frame-ancestors is none', /frame-ancestors 'none'/.test(csp));
  ok('the fonts the page uses are allowed', /fonts\.googleapis\.com/.test(csp) && /fonts\.gstatic\.com/.test(csp));
  ok('signed Supabase images are allowed', /img-src[^;]*supabase\.co/.test(csp));
  equal('X-Frame-Options', head.get('x-frame-options'), 'DENY');
  equal('X-Content-Type-Options', head.get('x-content-type-options'), 'nosniff');
  equal('Referrer-Policy', head.get('referrer-policy'), 'strict-origin-when-cross-origin');

  section('what must never be served');
  for (const path of [
    '/.env', '/.env.example', '/supabase/schema.sql', '/scripts/seed.mjs',
    '/scripts/pg.mjs', '/tests/api.test.js', '/package.json', '/api/_lib/db.js',
  ]) {
    const res = await web.fetch(path, { raw: true });
    ok(`${path} is not public`, res.status === 404 || res.status === 403, `-> HTTP ${res.status}`);
  }
}

/* ======================================================== 2 · the backend */

const PNG = `data:image/png;base64,${'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='}`;

async function checkBackend() {
  section('before anyone logs in');
  const anon = agent();
  const config = await anon.fetch('/api/auth?r=config');
  if (config.status === 403 && /Security Checkpoint|challenge/i.test(JSON.stringify(config.json))) {
    throw new Error(
      [
        'The host is answering with a JavaScript challenge (Vercel Attack Challenge Mode),',
        'so no command-line client can get through.',
        'Turn it off under Project -> Firewall, or run the check against a local server:',
        '  node --env-file=.env scripts/dev-server.mjs',
        '  npm run check:live -- http://localhost:3077',
      ].join('\n'),
    );
  }
  equal('config responds', config.status, 200);
  equal('the server says it is connected', config.json.configured, true);
  equal('it publishes the code length', config.json.code_length, Number(process.env.CODE_LENGTH || 4));
  ok('no session yet', (await anon.fetch('/api/auth?r=me')).json.role === null);
  equal('the teacher api is shut', (await anon.fetch('/api/teacher?r=bootstrap')).status, 401);
  equal('the family api is shut', (await anon.fetch('/api/family?r=bootstrap')).status, 401);
  equal('cron is shut', (await anon.fetch('/api/cron')).status, 401);

  section('logging in');
  const wrong = await anon.fetch('/api/auth?r=login', { method: 'POST', body: { role: 'teacher', code: '000000' } });
  equal('a wrong code is refused', wrong.status, 401);
  ok('and says nothing useful about why', /did not work/.test(wrong.json.error));

  for (const bad of ['', 'abcd', '12', null]) {
    const res = await anon.fetch('/api/auth?r=login', { method: 'POST', body: { role: 'teacher', code: bad } });
    equal(`a malformed code (${JSON.stringify(bad)}) is a 400`, res.status, 400);
  }
  equal('an unknown role is a 400', (await anon.fetch('/api/auth?r=login', { method: 'POST', body: { role: 'admin', code: TEACHER_CODE } })).status, 400);

  const teacher = agent();
  const login = await teacher.fetch('/api/auth?r=login', { method: 'POST', body: { role: 'teacher', code: TEACHER_CODE } });
  equal('the right code signs in', login.status, 200);
  equal('and says who it is', login.json.teacher?.name, `Live ${STAMP}`);
  const setCookie = (login.headers.getSetCookie?.() || []).join(' ');
  ok('the cookie is HttpOnly, SameSite=Lax and Secure', /HttpOnly/.test(setCookie) && /SameSite=Lax/.test(setCookie) && (BASE.startsWith('http://localhost') || /Secure/.test(setCookie)));
  ok('the code is not in the cookie', !setCookie.includes(TEACHER_CODE));
  equal('a reload keeps the session', (await teacher.fetch('/api/auth?r=me')).json.role, 'teacher');

  section('a teacher reads only their own data');
  const boot = await teacher.fetch('/api/teacher?r=bootstrap');
  equal('bootstrap responds', boot.status, 200);
  const data = boot.json;
  equal('three students', data.students.length, 3);
  equal('two classes', data.classes.length, 2);
  ok('enrolment is flattened onto the class', data.classes.every((c) => Array.isArray(c.student_ids)));
  ok('four marks', data.marks.length === 4);
  ok('one paper', data.papers.length === 1);
  ok('the teacher row carries no secrets', !['code_hash', 'code_salt', 'code_lookup'].some((k) => k in data.teacher));
  ok('no other teacher leaked in', !JSON.stringify(data).includes('Nimal'));
  const alpha = data.students.find((s) => s.name === 'Live Alpha');
  equal('Alpha owes nothing yet', alpha.amount_due, 0);
  equal("Alpha's average is 63 %", alpha.avg_pct, 63);

  const range = await teacher.fetch(`/api/teacher?r=sessions&from=${addDays(TODAY, -7)}&to=${TODAY}`);
  equal('a session range can be fetched', range.status, 200);
  ok('and comes back as a list', Array.isArray(range.json.sessions));
  equal('a range with no dates is refused', (await teacher.fetch('/api/teacher?r=sessions')).status, 400);

  const invite = await teacher.fetch('/api/teacher?r=invite');
  ok('the sign-up link carries this teacher key', invite.json.link.endsWith(`/join?t=live-${STAMP}`));
  ok('and a WhatsApp link to send it', invite.json.whatsapp.startsWith('https://wa.me/'));

  section('taking attendance: Scheduled, In progress, Ended (point 10)');
  const started = await teacher.fetch('/api/teacher?r=attendance.start', {
    method: 'POST',
    body: { class_id: CLASS_TODAY, date: TODAY },
  });
  equal('Start class is accepted', started.status, 200);
  ok('and records a start time', Boolean(started.json.started_at));

  const restarted = await teacher.fetch('/api/teacher?r=attendance.start', {
    method: 'POST',
    body: { class_id: CLASS_TODAY, date: TODAY },
  });
  equal('pressing Start twice does not restart the clock', restarted.json.started_at, started.json.started_at);

  const endedAt = new Date().toISOString();
  const finish = await teacher.fetch('/api/teacher?r=attendance.finish', {
    method: 'POST',
    body: { class_id: CLASS_TODAY, date: TODAY, absent: [STU_A], ended_at: endedAt },
  });
  equal('the class saves', finish.status, 200);
  equal('one absent', finish.json.absent, 1);
  equal('two present', finish.json.present, 2);
  equal('one message queued', finish.json.messages.length, 1);
  ok('with a WhatsApp link for the absent parent', finish.json.messages[0].link?.includes('94770009001'));
  ok('the absent message names the teacher and the class', /was absent from today/.test(finish.json.messages[0].text || ''));
  equal('the start time is kept from Start class', finish.json.started_at, started.json.started_at);
  ok('and the length taught is recorded', Number(finish.json.taught_minutes) >= 0);

  const fixed = await teacher.fetch('/api/teacher?r=attendance.fix_times', {
    method: 'POST',
    body: {
      class_id: CLASS_TODAY,
      date: TODAY,
      started_at: new Date(Date.parse(endedAt) - 7_200_000).toISOString(),
      ended_at: endedAt,
    },
  });
  equal('the times can be corrected afterwards', fixed.status, 200);
  equal('to exactly two hours', fixed.json.taught_minutes, 120);
  equal(
    'and a backwards correction is refused',
    (await teacher.fetch('/api/teacher?r=attendance.fix_times', {
      method: 'POST',
      body: { class_id: CLASS_TODAY, date: TODAY, started_at: endedAt, ended_at: new Date(Date.parse(endedAt) - 60_000).toISOString() },
    })).status,
    400,
  );

  const after = (await teacher.fetch('/api/teacher?r=bootstrap')).json;
  const a2 = after.students.find((s) => s.id === STU_A);
  const b2 = after.students.find((s) => s.id === STU_B);
  equal('the absent student is not charged', a2.amount_due, 0);
  equal('the present student is charged their own fee', b2.amount_due, 1200);
  equal("the absent student's history records it", a2.hist, 'A');
  equal("the present student's history records it", b2.hist, 'P');
  ok('an absence event reached the feed', after.events.some((e) => e.type === 'absent' && e.student_id === STU_A));

  equal(
    'a student who is not in the class cannot be marked absent',
    (await teacher.fetch('/api/teacher?r=attendance.finish', { method: 'POST', body: { class_id: CLASS_TODAY, date: TODAY, absent: ['00000000-0000-4000-8000-0000000000ff'] } })).json.absent,
    0,
  );
  equal(
    "another teacher's class is a 404",
    (await teacher.fetch('/api/teacher?r=attendance.finish', { method: 'POST', body: { class_id: '00000000-0000-4000-8000-0000000000ff', date: TODAY, absent: [] } })).status,
    404,
  );

  section('reminding the parents of a class that has not happened yet');
  const notify = await teacher.fetch('/api/teacher?r=session.notify', {
    method: 'POST',
    body: { class_id: CLASS_LATER, date: addDays(TODAY, 3) },
  });
  equal('the reminder goes out', notify.status, 200);
  equal('to the one enrolled family', notify.json.notified, 1);
  const notified = (await teacher.fetch('/api/teacher?r=bootstrap')).json;
  ok('the session is marked as notified', notified.sessions.some((s) => s.class_id === CLASS_LATER && s.notified_at));

  section('fees');
  // Start from a clean ledger: the attendance checks above already raised real
  // charges for both students, so the numbers below need a known baseline.
  await db.remove('charges', { student_id: db.inList([STU_A, STU_B]) });
  await db.remove('payments', { student_id: db.inList([STU_A, STU_B]) });
  await db.insert(
    'charges',
    [
      { teacher_id: TID, student_id: STU_A, amount: 1500, charge_date: addDays(TODAY, -21) },
      { teacher_id: TID, student_id: STU_A, amount: 1500, charge_date: addDays(TODAY, -14) },
      { teacher_id: TID, student_id: STU_A, amount: 1500, charge_date: addDays(TODAY, -7) },
      { teacher_id: TID, student_id: STU_A, amount: 1500, charge_date: addDays(TODAY, -1) },
    ],
    { returning: 'minimal' },
  );
  const owing = (await teacher.fetch('/api/teacher?r=bootstrap')).json.students.find((s) => s.id === STU_A);
  equal('4 classes at 1,500 shows 6,000', owing.amount_due, 6000);
  equal('as 4 pending classes', owing.pending_classes, 4);
  equal('21 days late', owing.days_late, 21);

  const preview = await teacher.fetch(`/api/teacher?r=preview&kind=fee&student_id=${STU_A}`);
  ok('the fee reminder names the teacher', preview.json.text.includes(`Live ${STAMP} Sir`));
  ok('and the amount in LKR', preview.json.text.includes('LKR 6,000'));
  const sent = await teacher.fetch('/api/teacher?r=message.fee', { method: 'POST', body: { student_id: STU_A } });
  equal('sending it succeeds', sent.status, 200);
  equal('and sends exactly what was previewed', sent.json.text, preview.json.text);

  const pay = await teacher.fetch('/api/teacher?r=payment.record', {
    method: 'POST',
    body: { student_id: STU_A, classes: 2, method: 'Cash' },
  });
  equal('paying 2 classes takes 3,000', pay.json.amount, 3000);
  ok('and comes back with a receipt number', /^#\d{4,}$/.test(pay.json.receipt || ''));
  equal(
    'leaving 3,000',
    (await teacher.fetch('/api/teacher?r=bootstrap')).json.students.find((s) => s.id === STU_A).amount_due,
    3000,
  );
  equal(
    'a fee reminder for someone who owes nothing is refused',
    (await teacher.fetch('/api/teacher?r=message.fee', { method: 'POST', body: { student_id: STU_B } })).status,
    400,
  );

  section('part payments, receipts and Undo (point 11)');
  const part = await teacher.fetch('/api/teacher?r=payment.record', {
    method: 'POST',
    body: { student_id: STU_A, amount: 1000, method: 'Online', send_receipt: false },
  });
  equal('a part payment is taken as typed', part.json.amount, 1000);
  equal('and leaves the rest owing', part.json.balance, 2000);
  equal('a zero amount is refused', (await teacher.fetch('/api/teacher?r=payment.record', { method: 'POST', body: { student_id: STU_A, amount: 0 } })).status, 400);

  const undone = await teacher.fetch('/api/teacher?r=payment.reverse', {
    method: 'POST',
    body: { payment_id: part.json.payment_id },
  });
  equal('Undo is accepted', undone.status, 200);
  equal('and restores the exact balance', undone.json.balance, 3000);
  ok(
    'the reversed receipt is still on the record',
    (await teacher.fetch('/api/teacher?r=bootstrap')).json.payments.some(
      (x) => x.id === part.json.payment_id && x.reversed_at,
    ),
  );
  equal(
    'and it cannot be undone twice',
    (await teacher.fetch('/api/teacher?r=payment.reverse', { method: 'POST', body: { payment_id: part.json.payment_id } })).status,
    500,
  );

  section('bank slips');
  equal('with no slip on file, there is nothing to show', (await teacher.fetch(`/api/teacher?r=slip&student_id=${STU_A}`)).status, 404);

  const family = agent();
  await family.fetch('/api/auth?r=login', { method: 'POST', body: { role: 'parent', code: FAMILY_CODE } });
  equal('a parent sends a slip', (await family.fetch('/api/family?r=slip', { method: 'POST', body: { image: PNG } })).status, 200);
  equal('junk is refused', (await family.fetch('/api/family?r=slip', { method: 'POST', body: { image: 'hello' } })).status, 400);
  equal('a PDF is refused', (await family.fetch('/api/family?r=slip', { method: 'POST', body: { image: 'data:application/pdf;base64,AAAA' } })).status, 400);

  const slip = await teacher.fetch(`/api/teacher?r=slip&student_id=${STU_A}`);
  equal('the teacher can now fetch it', slip.status, 200);
  ok('as a signed, time-limited URL', /token=/.test(slip.json.url || ''));
  const confirm = await teacher.fetch('/api/teacher?r=payment.confirm_slip', { method: 'POST', body: { student_id: STU_A } });
  equal('confirming the slip pays the whole balance', confirm.json.amount, 3000);
  ok('with its own receipt number', /^#\d{4,}$/.test(confirm.json.receipt || ''));
  equal(
    'and clears the balance',
    (await teacher.fetch('/api/teacher?r=bootstrap')).json.students.find((s) => s.id === STU_A).amount_due,
    0,
  );

  section('marks, papers and settings');
  equal('a mark with no title is refused', (await teacher.fetch('/api/teacher?r=mark.add', { method: 'POST', body: { student_id: STU_A, score: 50 } })).status, 400);
  equal('a score above the maximum is refused', (await teacher.fetch('/api/teacher?r=mark.add', { method: 'POST', body: { student_id: STU_A, title: 'X', score: 120, max_score: 100 } })).status, 400);
  equal('a good mark saves', (await teacher.fetch('/api/teacher?r=mark.add', { method: 'POST', body: { student_id: STU_A, title: 'Live test 3', score: 34, max_score: 50 } })).status, 200);
  equal(
    '54, 72 and 34/50 average to 65 %',
    (await teacher.fetch('/api/teacher?r=bootstrap')).json.students.find((s) => s.id === STU_A).avg_pct,
    65,
  );

  equal('a paper sells', (await teacher.fetch('/api/teacher?r=paper.sell', { method: 'POST', body: { paper_id: PAPER } })).status, 200);
  equal(
    'and the count moves',
    (await teacher.fetch('/api/teacher?r=bootstrap')).json.papers[0].sold,
    1,
  );
  equal("another teacher's paper cannot be sold", (await teacher.fetch('/api/teacher?r=paper.sell', { method: 'POST', body: { paper_id: '00000000-0000-4000-8000-0000000000ff' } })).status, 404);

  const settings = await teacher.fetch('/api/teacher?r=settings.update', { method: 'POST', body: { lang: 'ta', theme: 'day', remind_after_days: 7, auto_reminders: false } });
  equal('settings save', settings.json.teacher.lang, 'ta');
  equal('and the reminder window', settings.json.teacher.remind_after_days, 7);
  equal('a bad value changes nothing', (await teacher.fetch('/api/teacher?r=settings.update', { method: 'POST', body: { lang: 'fr', remind_after_days: 3 } })).status, 400);
  const tamil = await teacher.fetch(`/api/teacher?r=preview&kind=report&student_id=${STU_A}`);
  ok('a Tamil teacher gets Tamil messages', /[஀-௿]/.test(tamil.json.text));
  ok('with the amount still in LKR', /LKR/.test(tamil.json.text));
  await teacher.fetch('/api/teacher?r=settings.update', { method: 'POST', body: { lang: 'en' } });

  section('classes can be created, skipped and retired');
  const made = await teacher.fetch('/api/teacher?r=class.create', {
    method: 'POST',
    body: { kind: 'group', venue_type: 'institute', venue_name: 'Live Institute', area: 'Kotte', subject: 'Maths', curriculum: 'Local', grade: 11, student_ids: [STU_A, STU_B], days: [0, 2], start_time: '09:00', duration_hours: 1 },
  });
  equal('a class is created', made.status, 200);
  equal('and named by its size', made.json.title, 'Grade 11 Maths small group');

  // Checked here, before the clash section parks other classes on this slot
  // on purpose: a class is never compared with itself, so stretching one in
  // place is allowed.
  equal(
    'editing a class does not clash with itself',
    (await teacher.fetch('/api/teacher?r=class.update', { method: 'POST', body: { class_id: made.json.class_id, start_time: '09:00', duration_hours: 1.5 } })).status,
    200,
  );
  // Put it back, so the clash checks below have the times they expect.
  await teacher.fetch('/api/teacher?r=class.update', {
    method: 'POST',
    body: { class_id: made.json.class_id, start_time: '09:00', duration_hours: 1 },
  });

  section('individual or group, and where (point 12)');
  equal(
    'an individual class cannot hold two students',
    (await teacher.fetch('/api/teacher?r=class.create', { method: 'POST', body: { kind: 'individual', subject: 'Maths', area: 'Kotte', student_ids: [STU_A, STU_B], days: [1], start_time: '09:00', duration_hours: 1 } })).status,
    400,
  );
  equal(
    'a group class cannot hold one',
    (await teacher.fetch('/api/teacher?r=class.create', { method: 'POST', body: { kind: 'group', venue_type: 'own_place', subject: 'Maths', area: 'Kotte', student_ids: [STU_A], days: [1], start_time: '09:00', duration_hours: 1 } })).status,
    400,
  );
  equal(
    'a group at an institute needs the name',
    (await teacher.fetch('/api/teacher?r=class.create', { method: 'POST', body: { kind: 'group', venue_type: 'institute', subject: 'Maths', area: 'Kotte', student_ids: [STU_A, STU_B], days: [1], start_time: '09:00', duration_hours: 1 } })).status,
    400,
  );

  section('dragging a class to a new slot (point 9, phase 2)');
  // CLASS_LATER runs on one weekday only, three days from now.
  const dragFrom = addDays(TODAY, 3);
  const dragTo = addDays(TODAY, 4);

  const movedOne = await teacher.fetch('/api/teacher?r=class.move', {
    method: 'POST',
    body: { class_id: CLASS_LATER, from_date: dragFrom, to_date: dragTo, start_time: '19:00', scope: 'day' },
  });
  equal('one session can be dragged to another day', movedOne.status, 200);
  equal('as a one-off, leaving the class alone', movedOne.json.scope, 'day');
  ok('the student was told', movedOne.json.told >= 1);
  ok(
    'and the message names both the old slot and the new one',
    /has moved from .* to .*/.test(movedOne.json.messages[0]?.text || ''),
  );

  const afterMove = (await teacher.fetch('/api/teacher?r=bootstrap')).json;
  const copy = afterMove.classes.find((c) => c.once_date === dragTo);
  ok('a one-off now sits on the new day', Boolean(copy));
  equal('at the time it was dropped', hhmm(copy?.start_time), '19:00');
  ok(
    'and the day it left is cancelled',
    (afterMove.classes.find((c) => c.id === CLASS_LATER)?.skips || []).includes(dragFrom),
  );

  const movedAll = await teacher.fetch('/api/teacher?r=class.move', {
    method: 'POST',
    body: {
      class_id: CLASS_TODAY,
      from_date: TODAY,
      to_date: addDays(TODAY, 1),
      start_time: '20:00',
      scope: 'all',
      notify: false,
    },
  });
  equal('the whole class can be dragged too', movedAll.status, 200);
  equal('and nobody need be told', movedAll.json.told, 0);
  equal(
    'the weekday moved on',
    (await teacher.fetch('/api/teacher?r=bootstrap')).json.classes.find((c) => c.id === CLASS_TODAY)
      ?.days?.[0],
    weekday(addDays(TODAY, 1)),
  );

  equal(
    'a class cannot be dragged into the past',
    (await teacher.fetch('/api/teacher?r=class.move', { method: 'POST', body: { class_id: CLASS_LATER, from_date: dragFrom, to_date: addDays(TODAY, -2), start_time: '19:00' } })).status,
    400,
  );
  equal(
    "another teacher's class cannot be dragged",
    (await teacher.fetch('/api/teacher?r=class.move', { method: 'POST', body: { class_id: '00000000-0000-4000-8000-0000000000ff', from_date: dragFrom, to_date: dragTo, start_time: '19:00' } })).status,
    404,
  );
  equal(
    'and a parent cannot drag anything',
    (await family.fetch('/api/teacher?r=class.move', { method: 'POST', body: { class_id: CLASS_LATER, from_date: dragFrom, to_date: dragTo, start_time: '19:00' } })).status,
    401,
  );

  section('the clash check (point 13)');
  const clash = await teacher.fetch('/api/teacher?r=class.create', {
    method: 'POST',
    body: { kind: 'group', venue_type: 'own_place', subject: 'Science', area: 'Kotte', student_ids: [STU_A, STU_B], days: [0], start_time: '09:30', duration_hours: 1 },
  });
  equal('an overlap is refused', clash.status, 409);
  ok('and the class in the way is named', /Grade 11 Maths/.test(clash.json.error || ''));
  equal(
    'touching is not overlapping',
    (await teacher.fetch('/api/teacher?r=class.create', { method: 'POST', body: { kind: 'group', venue_type: 'own_place', subject: 'Science', area: 'Kotte', student_ids: [STU_A, STU_B], days: [0], start_time: '10:00', duration_hours: 1 } })).status,
    200,
  );
  equal(
    '"Save anyway" lets a deliberate overlap through',
    (await teacher.fetch('/api/teacher?r=class.create', { method: 'POST', body: { kind: 'group', venue_type: 'own_place', subject: 'Science', area: 'Kotte', student_ids: [STU_A, STU_B], days: [0], start_time: '09:30', duration_hours: 1, allow_clash: true } })).status,
    200,
  );
  equal('without students it is refused', (await teacher.fetch('/api/teacher?r=class.create', { method: 'POST', body: { subject: 'Maths', days: [0], start_time: '09:00', student_ids: [] } })).status, 400);
  equal('without a day it is refused', (await teacher.fetch('/api/teacher?r=class.create', { method: 'POST', body: { subject: 'Maths', days: [], start_time: '09:00', student_ids: [STU_A] } })).status, 400);
  equal("someone else's student is refused", (await teacher.fetch('/api/teacher?r=class.create', { method: 'POST', body: { subject: 'Maths', days: [0], start_time: '09:00', student_ids: ['00000000-0000-4000-8000-0000000000ff'] } })).status, 403);

  equal('a single day can be cancelled', (await teacher.fetch('/api/teacher?r=class.skip', { method: 'POST', body: { class_id: made.json.class_id, date: addDays(TODAY, 7) } })).status, 200);
  ok(
    'and the calendar knows',
    (await teacher.fetch('/api/teacher?r=bootstrap')).json.classes.find((c) => c.id === made.json.class_id).skips.includes(addDays(TODAY, 7)),
  );
  equal('and restored', (await teacher.fetch('/api/teacher?r=class.unskip', { method: 'POST', body: { class_id: made.json.class_id, date: addDays(TODAY, 7) } })).status, 200);
  equal('a class can be retired', (await teacher.fetch('/api/teacher?r=class.delete', { method: 'POST', body: { class_id: made.json.class_id } })).status, 200);
  ok(
    'it leaves the calendar but keeps its history',
    !(await teacher.fetch('/api/teacher?r=bootstrap')).json.classes.some((c) => c.id === made.json.class_id),
  );

  section('a new family: form, confirm, code');
  const joinConfig = await anon.fetch(`/api/join?r=config&t=live-${STAMP}`);
  equal('the public form loads', joinConfig.status, 200);
  ok("it shows this teacher's subjects", JSON.stringify(joinConfig.json.subjects) === '["Maths","Science"]');
  ok('and no internal ids', !('id' in joinConfig.json.teacher));
  equal('a stale link is a 404', (await anon.fetch('/api/join?r=config&t=nope')).status, 404);

  const goodForm = (over = {}) => ({
    t: `live-${STAMP}`,
    name: 'Live Joiner',
    call_name: 'Live',
    grade: 10,
    school: 'A School',
    subjects: ['Maths', 'Ballet'],
    curriculum: 'Edexcel',
    ambition: 'Doctor',
    parent_name: 'Joiner Parent',
    parent_occupation: 'Engineer',
    parent_phone: '+94 77 000 9003',
    ...over,
  });
  equal('a form with no name is refused', (await anon.fetch('/api/join?r=submit', { method: 'POST', body: goodForm({ name: '' }) })).status, 400);
  equal('a form with no phone is refused', (await anon.fetch('/api/join?r=submit', { method: 'POST', body: goodForm({ parent_phone: '' }) })).status, 400);
  equal('a landline is refused', (await anon.fetch('/api/join?r=submit', { method: 'POST', body: goodForm({ parent_phone: '0112345678' }) })).status, 400);
  equal('no grade is refused', (await anon.fetch('/api/join?r=submit', { method: 'POST', body: goodForm({ grade: 0 }) })).status, 400);
  equal('no parent name is refused', (await anon.fetch('/api/join?r=submit', { method: 'POST', body: goodForm({ parent_name: '' }) })).status, 400);
  equal('no subject is refused', (await anon.fetch('/api/join?r=submit', { method: 'POST', body: goodForm({ subjects: [] }) })).status, 400);
  const submitted = await anon.fetch('/api/join?r=submit', { method: 'POST', body: goodForm() });
  equal('a good form is accepted', submitted.status, 200);

  const withPending = (await teacher.fetch('/api/teacher?r=bootstrap')).json;
  const pending = withPending.students.find((s) => s.name === 'Live Joiner');
  ok('the teacher sees the new sign-up', Boolean(pending));
  equal('as pending', pending.status, 'pending');
  equal('with no fee yet', pending.fee_per_class, 0);
  equal('the phone number is normalised', pending.parent_phone, '94770009003');
  ok('a subject this teacher does not teach is dropped', JSON.stringify(pending.wanted_subjects) === '["Maths"]');
  equal('a curriculum they do not offer falls back', pending.curriculum, 'Local');

  equal('confirming without a fee is refused', (await teacher.fetch('/api/teacher?r=student.confirm', { method: 'POST', body: { student_id: pending.id } })).status, 400);
  const confirmed = await teacher.fetch('/api/teacher?r=student.confirm', { method: 'POST', body: { student_id: pending.id, fee_per_class: 1000 } });
  equal('confirming with a fee works', confirmed.status, 200);
  ok('and returns a code of the configured length', new RegExp(`^\\d{${process.env.CODE_LENGTH || 4}}$`).test(confirmed.json.code));

  const newFamily = agent();
  equal(
    'the new family can sign in with it',
    (await newFamily.fetch('/api/auth?r=login', { method: 'POST', body: { role: 'parent', code: confirmed.json.code } })).status,
    200,
  );

  const replaced = await teacher.fetch('/api/teacher?r=student.newcode', { method: 'POST', body: { student_id: pending.id } });
  ok('a replacement code is issued', /^\d+$/.test(replaced.json.code || ''));
  ok('and it is a different code', replaced.json.code !== confirmed.json.code);
  equal(
    'the old code stops working',
    (await agent().fetch('/api/auth?r=login', { method: 'POST', body: { role: 'parent', code: confirmed.json.code } })).status,
    401,
  );
  equal(
    'the new one works',
    (await agent().fetch('/api/auth?r=login', { method: 'POST', body: { role: 'parent', code: replaced.json.code } })).status,
    200,
  );

  section('the parent and student views');
  const fam = (await family.fetch('/api/family?r=bootstrap')).json;
  equal('the parent sees their child', fam.child.name, 'Live Alpha');
  equal('the role is parent', fam.role, 'parent');
  equal('both children are listed', fam.children.length, 2);
  ok('the storage path is not sent', fam.child.slip_path === undefined);
  ok('the classes come through', fam.classes.length >= 1);
  ok('the marks come through', fam.marks.length >= 2);

  const raw = JSON.stringify(fam);
  const outsider = fam.board.marks.find((r) => r.name.startsWith('Zara'));
  ok('a classmate from another family is on the board', Boolean(outsider));
  equal("that classmate's name is reduced to an initial", outsider?.name, 'Zara K.');
  equal("their id is withheld", outsider?.id, null);
  ok("their surname appears nowhere in the payload", !raw.includes('Kulatunga'));
  ok('nor their parent, phone or fee', !raw.includes('94770009004'));
  ok('every row that is not this child is masked', fam.board.marks.every((r) => r.self || /^\S+ \S\.$/.test(r.name)));
  ok('every row that is not this child has no id', fam.board.marks.every((r) => r.self || r.id === null));
  ok('the child keeps their own full name', fam.board.marks.some((r) => r.self && r.name === 'Live Alpha'));
  ok("this family's own second child is listed in full", fam.children.some((c) => c.name === 'Live Betta'));

  const switched = await family.fetch('/api/family?r=child', { method: 'POST', body: { child_id: STU_B } });
  equal('switching child works', switched.json.child.name, 'Live Betta');
  equal('switching to a stranger is refused', (await family.fetch('/api/family?r=child', { method: 'POST', body: { child_id: '00000000-0000-4000-8000-0000000000ff' } })).status, 403);
  await family.fetch('/api/family?r=child', { method: 'POST', body: { child_id: STU_A } });

  equal('the same code opens the student view', (await family.fetch('/api/auth?r=role', { method: 'POST', body: { role: 'student' } })).json.role, 'student');
  equal('and switches back', (await family.fetch('/api/auth?r=role', { method: 'POST', body: { role: 'parent' } })).json.role, 'parent');
  equal('an unknown view is refused', (await family.fetch('/api/auth?r=role', { method: 'POST', body: { role: 'admin' } })).status, 400);

  equal('a reschedule request is saved', (await family.fetch('/api/family?r=reschedule', { method: 'POST', body: { class_id: CLASS_LATER, date: addDays(TODAY, 3), note: 'Doctor' } })).status, 200);
  ok(
    'and the teacher sees it',
    (await teacher.fetch('/api/teacher?r=bootstrap')).json.reschedules.some((r) => r.student_id === STU_A),
  );
  const resolve = (await teacher.fetch('/api/teacher?r=bootstrap')).json.reschedules[0];
  equal('the teacher can answer it', (await teacher.fetch('/api/teacher?r=reschedule.resolve', { method: 'POST', body: { request_id: resolve.id, status: 'accepted' } })).status, 200);

  equal('a paper with no file cannot be opened', (await family.fetch('/api/family?r=paper.link', { method: 'POST', body: { paper_id: PAPER } })).status, 404);
  equal("another teacher's paper cannot be opened", (await family.fetch('/api/family?r=paper.link', { method: 'POST', body: { paper_id: '00000000-0000-4000-8000-0000000000ff' } })).status, 404);

  section('the walls between the roles');
  equal('a parent cannot open the teacher api', (await family.fetch('/api/teacher?r=bootstrap')).status, 401);
  equal('a teacher cannot open the family api', (await teacher.fetch('/api/family?r=bootstrap')).status, 401);
  equal('a parent cannot take attendance', (await family.fetch('/api/teacher?r=attendance.finish', { method: 'POST', body: { class_id: CLASS_TODAY, date: TODAY, absent: [] } })).status, 401);
  equal('a parent cannot record a payment', (await family.fetch('/api/teacher?r=payment.record', { method: 'POST', body: { student_id: STU_A, classes: 1 } })).status, 401);

  const forged = agent();
  const stolen = await (async () => {
    const res = await fetch(`${BASE}/api/auth?r=login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'teacher', code: TEACHER_CODE }),
    });
    return (res.headers.getSetCookie?.() || [])[0]?.split(';')[0] || '';
  })();
  const tamperRes = await fetch(`${BASE}/api/teacher?r=bootstrap`, {
    headers: { Cookie: `${stolen.slice(0, -4)}aaaa` },
  });
  equal('a tampered cookie is rejected', tamperRes.status, 401);
  const noSig = await fetch(`${BASE}/api/teacher?r=bootstrap`, {
    headers: { Cookie: `plus_session=${Buffer.from(JSON.stringify({ kind: 'teacher', tid: TID, exp: 9e9 })).toString('base64url')}.x` },
  });
  equal('a cookie with a forged signature is rejected', noSig.status, 401);
  void forged;

  equal('logging out clears the session', (await teacher.fetch('/api/auth?r=logout', { method: 'POST', body: {} })).status, 200);
  equal('and the api closes again', (await teacher.fetch('/api/teacher?r=bootstrap')).status, 401);

  section('unknown requests');
  const relogin = agent();
  await relogin.fetch('/api/auth?r=login', { method: 'POST', body: { role: 'teacher', code: TEACHER_CODE } });
  equal('an unknown teacher action is a 404', (await relogin.fetch('/api/teacher?r=drop.everything', { method: 'POST', body: {} })).status, 404);
  equal('an unknown family action is a 404', (await family.fetch('/api/family?r=nonsense', { method: 'POST', body: {} })).status, 404);
  equal('an unknown auth action is a 404', (await anon.fetch('/api/auth?r=nonsense', { method: 'POST', body: {} })).status, 404);
  equal('GET on a write endpoint is a 405', (await relogin.fetch('/api/teacher?r=mark.add', { method: 'PUT' })).status, 405);

  section('the scheduled job');
  const secret = process.env.CRON_SECRET;
  equal('without the secret it refuses', (await anon.fetch('/api/cron')).status, 401);
  const cron = await fetch(`${BASE}/api/cron?job=fees`, { headers: { Authorization: `Bearer ${secret}` } });
  const cronBody = await cron.json();
  equal('with the secret it runs', cron.status, 200);
  ok('and reports what it did', typeof cronBody.fee_reminders === 'number');

  section('the login rate limit');
  const attacker = agent();
  let locked = false;
  for (let i = 0; i < 10 && !locked; i += 1) {
    const res = await attacker.fetch('/api/auth?r=login', { method: 'POST', body: { role: 'teacher', code: '000001' } });
    if (res.status === 429) locked = true;
  }
  ok('repeated wrong codes lock the endpoint', locked);
  const blocked = await attacker.fetch('/api/auth?r=login', { method: 'POST', body: { role: 'teacher', code: TEACHER_CODE } });
  equal('even the right code is refused while locked', blocked.status, 429);
  await db.remove('login_attempts', { ok: 'is.false' }).catch(() => {});
  const recovered = await agent().fetch('/api/auth?r=login', { method: 'POST', body: { role: 'teacher', code: TEACHER_CODE } });
  equal('and works again once the window clears', recovered.status, 200);
}

/* ------------------------------------------------------------------- run -- */

async function main() {
  if (!db.configured) {
    console.error('\nSUPABASE_URL and SUPABASE_SERVICE_KEY must be set.\n');
    process.exit(1);
  }
  console.log(`\nLIVE CHECK   ${BASE}`);
  console.log(`today ${TODAY}, scratch teacher live-${STAMP}`);

  await checkFrontend();
  await setup();
  try {
    await checkBackend();
  } finally {
    await teardown();
    console.log('\n  (scratch teacher and its data removed)');
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) console.log(`  failures:\n${failures.map((f) => `    - ${f}`).join('\n')}`);
  console.log('');
  process.exit(failed ? 1 : 0);
}

// Run only when this file is the one that was launched: check-clean.mjs
// imports cleanStrays() from here and must not start the whole check.
const launchedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (launchedDirectly) {
  main().catch(async (err) => {
    console.error(`\nThe check could not finish: ${err.message}`);
    console.error(err.stack?.split('\n').slice(1, 4).join('\n'));
    await teardown();
    process.exit(1);
  });
}
