/**
 * The teacher onboarding wizard: its rules, and the endpoint that creates a
 * teacher from them.
 *
 * This is the one place in the app that mints accounts, so most of what is
 * checked here is that it stays shut: no key, wrong key, no key configured
 * at all. The rest is the wizard's own arithmetic - which step is finished,
 * what a class needs, what the week adds up to.
 */

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'stub-service-key';
process.env.SESSION_SECRET = 'test-session-secret-0123456789';
process.env.LOGIN_PEPPER = 'test-login-pepper-0123456789';
process.env.CODE_LENGTH = '4';
process.env.ONBOARD_KEY = 'let-me-in-0123456789';
delete process.env.WHATSAPP_TOKEN;
delete process.env.WHATSAPP_PHONE_ID;

import test from 'node:test';
import assert from 'node:assert/strict';

import * as W from '../app/onboard-steps.js';

/* ======================================================= the stub ======== */

let DB;
const reset = () => {
  DB = { teachers: [], classes: [], login_attempts: [], family_accounts: [] };
};
reset();

const uuid = () => `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;

globalThis.fetch = async (url, init = {}) => {
  const parsed = new URL(url);
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : null;
  const params = Object.fromEntries(parsed.searchParams.entries());
  const json = (status, data) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  if (parsed.pathname.startsWith('/rest/v1/rpc/')) return json(400, { message: 'no rpc here' });

  const table = parsed.pathname.replace('/rest/v1/', '');
  DB[table] = DB[table] || [];

  if (method === 'GET') {
    const rows = DB[table].filter((row) =>
      Object.entries(params).every(([key, raw]) => {
        if (['select', 'order', 'limit'].includes(key)) return true;
        const i = raw.indexOf('.');
        const op = raw.slice(0, i);
        const value = raw.slice(i + 1);
        if (op === 'eq') return String(row[key]) === value;
        if (op === 'gte') return String(row[key]) >= value;
        return true;
      }),
    );
    return json(200, params.limit ? rows.slice(0, Number(params.limit)) : rows);
  }
  if (method === 'POST') {
    const rows = (Array.isArray(body) ? body : [body]).map((row) => ({ id: uuid(), ...row }));
    DB[table].push(...rows);
    return json(201, rows);
  }
  return json(405, { message: 'not allowed' });
};

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    bodyText: '',
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    writeHead(s) {
      this.statusCode = s;
      return this;
    },
    end(t) {
      this.bodyText = t ?? '';
      return this;
    },
  };
  Object.defineProperty(res, 'json', {
    get() {
      try {
        return JSON.parse(this.bodyText || '{}');
      } catch {
        return {};
      }
    },
  });
  return res;
}

const onboardApi = (await import('../api/onboard.js')).default;

async function call({ method = 'GET', url = '/api/onboard', body = null } = {}) {
  const req = {
    method,
    url,
    headers: { host: 'plus.test', 'x-forwarded-for': '203.0.113.9' },
    socket: { remoteAddress: '203.0.113.9' },
    body: body ?? undefined,
  };
  const res = makeRes();
  await onboardApi(req, res);
  return res;
}

const KEY = 'let-me-in-0123456789';

const goodTeacher = (over = {}) => ({
  k: KEY,
  title: 'Mr',
  name: 'Nimal Perera',
  phone: '0771234567',
  email: 'nimal@example.com',
  area: 'Nugegoda',
  subjects: ['Maths', 'Science', 'Combined Maths'],
  medium: 'English',
  school: 'Royal College, Colombo 7',
  classes: [
    {
      grade: 'Grade 10',
      subject: 'Maths',
      place: 'institute',
      institute: 'Sigma Institute',
      days: [0, 2, 4],
      students: 42,
      fee_band: '2,000–3,000',
    },
    {
      grade: 'Grade 11',
      subject: 'Maths',
      place: 'home',
      institute: null,
      days: [5],
      students: 18,
      fee_band: '2,000–3,000',
    },
  ],
  how: { tracking: 'Book', messaging: 'Yes, a group', headache: 'Collecting fees', growing: 'Yes', refer: '3–5' },
  tags: ['Very keen', 'Can refer teachers'],
  notes: 'Big Grade 10 class at Sigma. Wants fee reminders first.',
  ...over,
});

/* ================================================= the door is shut ====== */

test('without the key the endpoint behaves as though it is not there', async () => {
  reset();
  for (const url of ['/api/onboard?r=config', '/api/onboard?r=config&k=']) {
    const res = await call({ url });
    assert.equal(res.statusCode, 404, url);
  }
  const post = await call({ method: 'POST', url: '/api/onboard?r=submit', body: goodTeacher({ k: '' }) });
  assert.equal(post.statusCode, 404);
  assert.equal(DB.teachers.length, 0, 'and no teacher was made');
});

test('a wrong key is refused, and says no more than a missing one', async () => {
  reset();
  const wrong = await call({ url: '/api/onboard?r=config&k=let-me-in-9999999999' });
  const missing = await call({ url: '/api/onboard?r=config' });
  assert.equal(wrong.statusCode, 404);
  assert.deepEqual(wrong.json, missing.json, 'a wrong key leaks nothing a missing one does not');

  const post = await call({
    method: 'POST',
    url: '/api/onboard?r=submit',
    body: goodTeacher({ k: 'let-me-in-9999999999' }),
  });
  assert.equal(post.statusCode, 404);
  assert.equal(DB.teachers.length, 0);
});

test('a key of the wrong length is refused without comparing further', async () => {
  reset();
  for (const k of ['x', 'let-me-in', `${KEY}extra`]) {
    assert.equal((await call({ url: `/api/onboard?r=config&k=${k}` })).statusCode, 404, k);
  }
});

test('the right key opens the form', async () => {
  reset();
  const res = await call({ url: `/api/onboard?r=config&k=${KEY}` });
  assert.equal(res.statusCode, 200, res.bodyText);
  assert.equal(res.json.ready, true);
  assert.equal(res.json.code_length, 4);
});

/* ==================================================== making a teacher === */

test('a teacher, their classes and their code are made in one go', async () => {
  reset();
  const res = await call({ method: 'POST', url: '/api/onboard?r=submit', body: goodTeacher() });
  assert.equal(res.statusCode, 200, res.bodyText);

  assert.equal(res.json.name, 'Nimal Perera');
  assert.match(res.json.code, /^\d{4}$/, 'a four-digit code, shown once');
  assert.equal(res.json.join_key, 'nimalperera');
  assert.equal(res.json.classes, 2);
  assert.equal(res.json.students, 60);

  const teacher = DB.teachers[0];
  assert.equal(teacher.phone, '94771234567', 'the number is stored the WhatsApp way');
  assert.deepEqual(teacher.subjects, ['Maths', 'Science', 'Combined Maths']);
  assert.equal(teacher.school, 'Royal College, Colombo 7');
  assert.equal(teacher.own_place_area, 'Nugegoda');
  assert.ok(teacher.onboarded_at);

  // The code is never stored in the clear.
  assert.ok(teacher.code_hash && teacher.code_salt && teacher.code_lookup);
  assert.ok(!JSON.stringify(teacher).includes(res.json.code), 'the code itself is not in the row');
});

test('the classes carry where and when, and are flagged as needing a time', async () => {
  reset();
  await call({ method: 'POST', url: '/api/onboard?r=submit', body: goodTeacher() });

  const [first, second] = DB.classes;
  assert.equal(first.title, 'Grade 10 Maths');
  assert.equal(first.grade, 10);
  assert.equal(first.venue_type, 'institute');
  assert.equal(first.venue_name, 'Sigma Institute');
  assert.equal(first.place, 'Sigma Institute · Nugegoda');
  assert.deepEqual(first.days, [0, 2, 4]);
  assert.equal(first.expected_students, 42);
  assert.equal(first.fee_band, '2,000–3,000');
  assert.equal(first.kind, 'group');

  // The wizard never asks what time a class starts.
  assert.equal(first.setup_pending, true, 'so it is flagged for the teacher to set');
  assert.equal(first.start_time, '16:00', 'with a placeholder until they do');

  assert.equal(second.venue_type, 'own_place', 'a home class');
  assert.equal(second.area, 'Nugegoda');
});

test('what the team said is kept, including the part the teacher never sees', async () => {
  reset();
  await call({ method: 'POST', url: '/api/onboard?r=submit', body: goodTeacher() });

  const kept = DB.teachers[0].onboarding;
  assert.equal(kept.how.headache, 'Collecting fees');
  assert.equal(kept.medium, 'English');
  assert.deepEqual(kept.team.tags, ['Very keen', 'Can refer teachers']);
  assert.match(kept.team.notes, /fee reminders first/);
});

test('the teaching medium picks the language the app opens in', async () => {
  for (const [medium, lang] of [['English', 'en'], ['Tamil', 'ta'], ['Sinhala', 'en']]) {
    reset();
    await call({
      method: 'POST',
      url: '/api/onboard?r=submit',
      body: goodTeacher({ medium, phone: '0771234567' }),
    });
    assert.equal(DB.teachers[0].lang, lang, medium);
  }
});

test('the welcome message carries the code', async () => {
  reset();
  const res = await call({ method: 'POST', url: '/api/onboard?r=submit', body: goodTeacher() });
  assert.match(res.json.whatsapp.text, new RegExp(res.json.code));
  // No WhatsApp API configured here, so it comes back as a link to send by hand.
  assert.equal(res.json.whatsapp.status, 'manual');
  assert.ok(res.json.whatsapp.link.startsWith('https://wa.me/94771234567'));
});

test('a second teacher with the same name gets a different sign-up link', async () => {
  reset();
  await call({ method: 'POST', url: '/api/onboard?r=submit', body: goodTeacher() });
  const second = await call({
    method: 'POST',
    url: '/api/onboard?r=submit',
    body: goodTeacher({ phone: '0777654321' }),
  });
  assert.equal(second.json.join_key, 'nimalperera2');
});

test('the same phone number cannot be set up twice', async () => {
  reset();
  await call({ method: 'POST', url: '/api/onboard?r=submit', body: goodTeacher() });
  const again = await call({ method: 'POST', url: '/api/onboard?r=submit', body: goodTeacher() });
  assert.equal(again.statusCode, 409);
  assert.match(again.json.error, /already on Plus/);
  assert.equal(DB.teachers.length, 1);
});

test('a half-filled form is refused, field by field', async () => {
  const cases = [
    [{ name: '' }, /full name/i],
    [{ phone: '0112345678' }, /Sri Lankan mobile/i],
    [{ phone: '' }, /Sri Lankan mobile/i],
    [{ area: '' }, /area or town/i],
    [{ subjects: [] }, /at least one subject/i],
    [{ classes: [{ grade: 'Grade 10', place: 'home', days: [1], students: 5 }] }, /grade and a subject/i],
    [{ classes: [{ grade: 'Grade 10', subject: 'Maths', place: 'moon', days: [1], students: 5 }] }, /where each class/i],
    [{ classes: [{ grade: 'Grade 10', subject: 'Maths', place: 'institute', days: [1], students: 5 }] }, /institute name/i],
    [{ classes: [{ grade: 'Grade 10', subject: 'Maths', place: 'home', days: [], students: 5 }] }, /days each class/i],
  ];
  for (const [over, expected] of cases) {
    reset();
    const res = await call({ method: 'POST', url: '/api/onboard?r=submit', body: goodTeacher(over) });
    assert.equal(res.statusCode, 400, JSON.stringify(over));
    assert.match(res.json.error, expected);
    assert.equal(DB.teachers.length, 0, 'and nothing was created');
  }
});

test('a teacher with no classes yet is still allowed', async () => {
  reset();
  const res = await call({
    method: 'POST',
    url: '/api/onboard?r=submit',
    body: goodTeacher({ classes: [] }),
  });
  assert.equal(res.statusCode, 200, res.bodyText);
  assert.equal(res.json.classes, 0);
  assert.equal(DB.classes.length, 0);
});

test('set-ups from one address are capped', async () => {
  reset();
  process.env.ONBOARD_MAX_PER_HOUR = '3';
  const fresh = (await import(`../api/onboard.js?cap=${Date.now()}`)).default;
  const run = async (phone) => {
    const req = {
      method: 'POST',
      url: '/api/onboard?r=submit',
      headers: { host: 'plus.test', 'x-forwarded-for': '203.0.113.9' },
      socket: { remoteAddress: '203.0.113.9' },
      body: goodTeacher({ phone, name: `Teacher ${phone}` }),
    };
    const res = makeRes();
    await fresh(req, res);
    return res;
  };
  for (const phone of ['0770000001', '0770000002', '0770000003']) {
    assert.equal((await run(phone)).statusCode, 200);
  }
  assert.equal((await run('0770000004')).statusCode, 429);
  delete process.env.ONBOARD_MAX_PER_HOUR;
});

/* ================================================= the wizard's rules === */

const answers = (over = {}) => ({
  ...W.emptyAnswers(),
  name: 'Nimal Perera',
  phone: '0771234567',
  area: 'Nugegoda',
  subjects: ['Maths'],
  at_school: false,
  classes: [
    { grade: 'Grade 10', subject: 'Maths', place: 'home', days: [0, 2], students: 42, fee_band: '2,000–3,000' },
  ],
  how: Object.fromEntries(W.HOW.map((q) => [q.key, q.options[0]])),
  ...over,
});

test('step 1 asks for a name, a number, an area, a subject and the school question', () => {
  const blank = W.emptyAnswers();
  assert.deepEqual(
    Object.keys(W.problems(blank, 1)).sort(),
    ['at_school', 'o-area', 'o-name', 'o-phone', 'subjects'],
  );
  assert.ok(W.stepOk(answers(), 1));
});

test('saying yes to teaching at a school then asks which one', () => {
  assert.ok(!W.stepOk(answers({ at_school: true, school: '' }), 1));
  assert.ok(W.stepOk(answers({ at_school: true, school: 'Royal College' }), 1));
  assert.ok(W.stepOk(answers({ at_school: false, school: '' }), 1), 'no means no follow-up');
});

test("the teacher's number is held to the same +94 rule as everyone else's", () => {
  assert.equal(W.problems(answers({ phone: '12345' }), 1)['o-phone'], 'tel_start7');
  assert.equal(W.problems(answers({ phone: '' }), 1)['o-phone'], 'tel_nine');
  assert.ok(W.stepOk(answers({ phone: '+94 77 123 4567' }), 1));
});

test('step 2 needs at least one class, step 3 needs every answer', () => {
  assert.ok(!W.stepOk(answers({ classes: [] }), 2));
  assert.ok(W.stepOk(answers(), 2));

  assert.equal(Object.keys(W.problems(answers({ how: {} }), 3)).length, W.HOW.length);
  assert.ok(W.stepOk(answers(), 3));
  assert.ok(W.stepOk(answers({ tags: [], notes: '' }), 4), 'the team panel is never required');
});

test('a class needs a subject, a place, days and a count', () => {
  const base = { grade: 'Grade 10', subject: 'Maths', place: 'home', days: [1], students: 5 };
  assert.equal(W.classError(base), null);
  assert.equal(W.classError({ ...base, subject: '' }), 'ob_pick_subject');
  assert.equal(W.classError({ ...base, place: 'moon' }), 'ob_pick_place');
  assert.equal(W.classError({ ...base, place: 'institute' }), 'ob_pick_institute');
  assert.equal(W.classError({ ...base, place: 'institute', institute: 'Sigma' }), null);
  assert.equal(W.classError({ ...base, days: [] }), 'pick_days');
  assert.equal(W.classError({ ...base, students: 0 }), 'ob_pick_count');
});

test('the week adds up across classes, counting each day and place once', () => {
  const week = W.weekSummary([
    { place: 'institute', institute: 'Sigma', days: [0, 2, 4], students: 42 },
    { place: 'home', days: [5], students: 18 },
    { place: 'online', days: [0], students: 15 },
  ]);
  assert.equal(week.classes, 3);
  assert.equal(week.days, 4, 'Mon, Wed, Fri and Sat - Monday counted once, not twice');
  assert.equal(week.students, 75);
  assert.equal(week.places, 3);
});

test('the subject catalogue covers the curriculum and can be searched', () => {
  assert.deepEqual(W.SUBJECTS.map((g) => g.band), ['primary', 'ol', 'al', 'other']);
  assert.ok(W.ALL_SUBJECTS.includes('Combined Maths'));
  assert.ok(W.ALL_SUBJECTS.includes('Scholarship exam'));
  assert.ok(W.ALL_SUBJECTS.includes('Spoken English'));
  assert.equal(new Set(W.ALL_SUBJECTS).size, W.ALL_SUBJECTS.length, 'no duplicates');

  const found = W.searchSubjects('chem');
  assert.deepEqual(found.flatMap((g) => g.items), ['Chemistry']);
  assert.equal(W.searchSubjects('').length, 4, 'an empty search shows everything');
  assert.equal(W.searchSubjects('zzz').length, 0);
});

test('the payload sent to the server is the answers, tidied', () => {
  const payload = W.toPayload(
    answers({ name: '  Nimal Perera  ', email: ' nimal@x.lk ', at_school: false, school: 'ignored' }),
  );
  assert.equal(payload.name, 'Nimal Perera');
  assert.equal(payload.email, 'nimal@x.lk');
  assert.equal(payload.school, null, 'a school is only sent when they said yes');
  assert.equal(payload.classes.length, 1);
  assert.equal(payload.classes[0].students, 42);
});

test('firstUnfinished points at the step that still needs work', () => {
  assert.equal(W.firstUnfinished(W.emptyAnswers()), 1);
  assert.equal(W.firstUnfinished(answers({ classes: [] })), 2);
  assert.equal(W.firstUnfinished(answers({ how: {} })), 3);
  assert.equal(W.firstUnfinished(answers()), null);
});
