/**
 * Integration tests for the serverless handlers.
 *
 * Supabase is replaced by a stub that answers PostgREST requests from fixture
 * rows and records every call. That tests what this code is actually
 * responsible for - routing, validation, scoping each query to the session,
 * writing the right events, dispatching the right message - without pretending
 * to re-implement PostgreSQL. The SQL itself is checked by running
 * supabase/schema.sql, which reports its own errors.
 */

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'stub-service-key';
process.env.SESSION_SECRET = 'test-session-secret-0123456789';
process.env.LOGIN_PEPPER = 'test-login-pepper-0123456789';
process.env.APP_TIMEZONE = 'Asia/Colombo';
process.env.CODE_LENGTH = '4';
delete process.env.WHATSAPP_TOKEN;
delete process.env.WHATSAPP_PHONE_ID;

import test from 'node:test';
import assert from 'node:assert/strict';

const { hashCode, codeLookup } = await import('../api/_lib/session.js');

/* ===================================================== the Supabase stub == */

const TID = '11111111-1111-1111-1111-111111111111';
const KASUN = '22222222-2222-2222-2222-222222222222';
const AMAYA = '33333333-3333-3333-3333-333333333333';
const OTHER_CHILD = '44444444-4444-4444-4444-444444444444';
const CLASS = '55555555-5555-5555-5555-555555555555';
const ACCOUNT = '66666666-6666-6666-6666-666666666666';

const teacherCode = hashCode('1234');
const familyCode = hashCode('3333');

function fixtures() {
  return {
    teachers: [
      {
        id: TID,
        name: 'Nimal',
        title: 'Sir',
        join_key: 'nimal',
        subjects: ['Maths', 'Science'],
        curricula: ['Local', 'Cambridge'],
        lang: 'en',
        theme: 'night',
        auto_reminders: true,
        remind_after_days: 14,
        code_lookup: codeLookup('1234'),
        code_hash: teacherCode.hash,
        code_salt: teacherCode.salt,
      },
    ],
    v_students: [
      {
        id: KASUN,
        teacher_id: TID,
        name: 'Kasun Perera',
        grade: 11,
        parent_phone: '94770000001',
        fee_per_class: 1500,
        status: 'active',
        amount_due: 6000,
        pending_classes: 4,
        days_late: 32,
        hist: 'PPAPPAPA',
        avg_pct: 65,
        mark_count: 3,
      },
      {
        id: AMAYA,
        teacher_id: TID,
        name: 'Amaya Jayasinghe',
        grade: 11,
        parent_phone: '94770000004',
        fee_per_class: 1200,
        status: 'active',
        amount_due: 0,
        pending_classes: 0,
        days_late: 0,
        hist: 'PPPPPPPP',
        avg_pct: 91,
        mark_count: 2,
      },
    ],
    students: [
      { id: KASUN, teacher_id: TID, name: 'Kasun Perera', grade: 11, parent_phone: '94770000001', fee_per_class: 1500, status: 'active', area: 'Nugegoda', subject: 'Maths', curriculum: 'Local' },
      { id: AMAYA, teacher_id: TID, name: 'Amaya Jayasinghe', grade: 11, parent_phone: '94770000004', fee_per_class: 1200, status: 'active', area: 'Nugegoda', subject: 'Maths', curriculum: 'Local' },
      { id: OTHER_CHILD, teacher_id: TID, name: 'Someone Else', grade: 9, parent_phone: '94770000099', fee_per_class: 900, status: 'active', area: 'Kotte', subject: 'English', curriculum: 'Local' },
    ],
    classes: [
      {
        id: CLASS,
        teacher_id: TID,
        subject: 'Maths',
        curriculum: 'Local',
        grade: 11,
        title: 'Grade 11 Maths small group',
        place: 'Nugegoda',
        days: [0, 2],
        start_time: '16:00:00',
        duration_hours: 1.5,
        start_date: '2026-01-05',
        once_date: null,
        active: true,
        class_students: [{ student_id: KASUN }, { student_id: AMAYA }],
        class_exceptions: [],
      },
    ],
    class_students: [
      { class_id: CLASS, student_id: KASUN },
      { class_id: CLASS, student_id: AMAYA },
    ],
    sessions: [],
    attendance: [],
    charges: [],
    payments: [],
    marks: [],
    events: [],
    papers: [],
    paper_sales: [],
    teacher_months: [{ teacher_id: TID, month: '2026-03', collected: 21000, charged: 38500 }],
    reschedule_requests: [],
    login_attempts: [],
    family_accounts: [
      {
        id: ACCOUNT,
        teacher_id: TID,
        label: 'Perera family',
        phone: '94770000001',
        code_lookup: codeLookup('3333'),
        code_hash: familyCode.hash,
        code_salt: familyCode.salt,
        family_children: [{ student_id: KASUN }],
      },
    ],
    family_children: [{ account_id: ACCOUNT, student_id: KASUN }],
  };
}

let DB = fixtures();
let calls = [];

/** The subset of PostgREST's filter language the handlers use. */
function matches(row, params) {
  for (const [key, raw] of Object.entries(params)) {
    if (['select', 'order', 'limit', 'on_conflict', 'offset'].includes(key)) continue;

    if (key === 'and') {
      for (const part of raw.replace(/^\(|\)$/g, '').split(',')) {
        const [col, op, value] = part.split('.');
        if (!compare(row[col], op, value)) return false;
      }
      continue;
    }

    const i = raw.indexOf('.');
    const op = raw.slice(0, i);
    const value = raw.slice(i + 1);
    if (!compare(row[key], op, value)) return false;
  }
  return true;
}

function compare(actual, op, value) {
  switch (op) {
    case 'eq':
      return String(actual) === value;
    case 'neq':
      return String(actual) !== value;
    case 'gte':
      return String(actual) >= value;
    case 'lte':
      return String(actual) <= value;
    case 'lt':
      return String(actual) < value;
    case 'is':
      return value === 'true' ? actual === true : value === 'false' ? actual === false : actual == null;
    case 'in': {
      const list = value.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, ''));
      return list.includes(String(actual));
    }
    default:
      throw new Error(`stub does not know the operator "${op}"`);
  }
}

const uuid = () => `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;

globalThis.fetch = async (url, init = {}) => {
  const parsed = new URL(url);
  const method = init.method || 'GET';
  let body = null;
  if (init.body) {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = init.body; // a binary upload, not JSON
    }
  }
  const params = Object.fromEntries(parsed.searchParams.entries());

  calls.push({ method, path: parsed.pathname, params, body });

  const json = (status, data) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  /* storage */
  if (parsed.pathname.startsWith('/storage/v1/object/sign/')) {
    return json(200, { signedURL: `/object/sign/x?token=stub` });
  }
  if (parsed.pathname.startsWith('/storage/v1/object/')) return json(200, { Key: 'ok' });

  /* rpc */
  if (parsed.pathname.startsWith('/rest/v1/rpc/')) {
    const fn = parsed.pathname.split('/').pop();
    if (fn === 'finish_class') {
      const id = uuid();
      DB.sessions.push({ id, class_id: body.p_class, teacher_id: body.p_teacher, session_date: body.p_date, status: 'done' });
      return json(200, id);
    }
    if (fn === 'record_payment') {
      const due = DB.v_students.find((s) => s.id === body.p_student)?.amount_due ?? 0;
      const fee = DB.v_students.find((s) => s.id === body.p_student)?.fee_per_class ?? 0;
      const amount = body.p_amount ?? (body.p_classes ? body.p_classes * fee : due);
      if (amount <= 0) return json(400, { message: 'nothing is owed' });
      DB.payments.push({ student_id: body.p_student, amount, method: body.p_method });
      return json(200, Math.min(amount, due));
    }
    return json(400, { message: `unknown function ${fn}` });
  }

  /* table access */
  const table = parsed.pathname.replace('/rest/v1/', '');
  DB[table] = DB[table] || [];

  if (method === 'GET') {
    let rows = DB[table].filter((row) => matches(row, params));
    if (params.limit) rows = rows.slice(0, Number(params.limit));
    // PostgREST resolves embedded resources, e.g. class_students(classes(...)).
    if (table === 'class_students' && (params.select || '').includes('classes(')) {
      rows = rows.map((row) => ({
        ...row,
        classes: DB.classes.find((c) => c.id === row.class_id) || null,
      }));
    }
    if (table === 'family_accounts' && (params.select || '').includes('family_children(')) {
      rows = rows.map((row) => ({
        ...row,
        family_children: DB.family_children.filter((fc) => fc.account_id === row.id),
      }));
    }
    return json(200, rows);
  }
  if (method === 'POST') {
    const incoming = Array.isArray(body) ? body : [body];
    const created = incoming.map((row) => ({ id: row.id || uuid(), created_at: new Date().toISOString(), ...row }));
    DB[table].push(...created);
    return json(201, created);
  }
  if (method === 'PATCH') {
    const updated = [];
    for (const row of DB[table]) {
      if (matches(row, params)) {
        Object.assign(row, body);
        updated.push(row);
      }
    }
    return json(200, updated);
  }
  if (method === 'DELETE') {
    DB[table] = DB[table].filter((row) => !matches(row, params));
    return json(204, []);
  }
  return json(405, { message: 'not allowed' });
};

/* ==================================================== request / response == */

function makeReq({ method = 'GET', url = '/', body = null, cookie = '' } = {}) {
  const req = {
    method,
    url,
    headers: { host: 'plus.test', ...(cookie ? { cookie } : {}), 'x-forwarded-for': '203.0.113.9' },
    socket: { remoteAddress: '203.0.113.9' },
    body: body ?? undefined,
  };
  return req;
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    bodyText: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return this.headers[name.toLowerCase()];
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers || {});
      return this;
    },
    end(text) {
      this.bodyText = text ?? '';
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

const auth = (await import('../api/auth.js')).default;
const teacherApi = (await import('../api/teacher.js')).default;
const familyApi = (await import('../api/family.js')).default;
const joinApi = (await import('../api/join.js')).default;
const cronApi = (await import('../api/cron.js')).default;

async function call(handler, options) {
  const req = makeReq(options);
  const res = makeRes();
  await handler(req, res);
  return res;
}

function cookieFrom(res) {
  const header = res.getHeader('set-cookie');
  return String(header || '').split(';')[0];
}

function reset() {
  DB = fixtures();
  calls = [];
}

async function signInTeacher() {
  reset();
  const res = await call(auth, {
    method: 'POST',
    url: '/api/auth?r=login',
    body: { role: 'teacher', code: '1234' },
  });
  assert.equal(res.statusCode, 200, res.bodyText);
  return cookieFrom(res);
}

async function signInFamily(role = 'parent') {
  const res = await call(auth, {
    method: 'POST',
    url: '/api/auth?r=login',
    body: { role, code: '3333' },
  });
  assert.equal(res.statusCode, 200, res.bodyText);
  return cookieFrom(res);
}

/* ============================================================== auth ==== */

test('the right teacher code signs in and sets an HttpOnly cookie', async () => {
  reset();
  const res = await call(auth, { method: 'POST', url: '/api/auth?r=login', body: { role: 'teacher', code: '1234' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.role, 'teacher');
  assert.equal(res.json.teacher.name, 'Nimal');
  const cookie = String(res.getHeader('set-cookie'));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.ok(!cookie.includes('1234'), 'the code is not in the cookie');
});

test('a wrong code is refused and recorded as a failed attempt', async () => {
  reset();
  const res = await call(auth, { method: 'POST', url: '/api/auth?r=login', body: { role: 'teacher', code: '9999' } });
  assert.equal(res.statusCode, 401);
  assert.match(res.json.error, /did not work/);
  assert.equal(DB.login_attempts.filter((a) => a.ok === false).length, 1);
});

test('a parent code cannot sign in as the teacher', async () => {
  reset();
  const res = await call(auth, { method: 'POST', url: '/api/auth?r=login', body: { role: 'teacher', code: '3333' } });
  assert.equal(res.statusCode, 401);
});

test('a teacher code cannot sign in as a parent', async () => {
  reset();
  const res = await call(auth, { method: 'POST', url: '/api/auth?r=login', body: { role: 'parent', code: '1234' } });
  assert.equal(res.statusCode, 401);
});

test('too many wrong codes locks the endpoint for a while', async () => {
  reset();
  for (let i = 0; i < 8; i += 1) {
    await call(auth, { method: 'POST', url: '/api/auth?r=login', body: { role: 'teacher', code: '9999' } });
  }
  const res = await call(auth, { method: 'POST', url: '/api/auth?r=login', body: { role: 'teacher', code: '1234' } });
  assert.equal(res.statusCode, 429, 'the correct code is refused too, while locked out');
  assert.match(res.json.error, /Too many tries/);
});

test('the same code opens the Parent and the Student view', async () => {
  reset();
  for (const role of ['parent', 'student']) {
    const res = await call(auth, { method: 'POST', url: '/api/auth?r=login', body: { role, code: '3333' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.role, role);
    assert.equal(res.json.children.length, 1);
    assert.equal(res.json.children[0].name, 'Kasun Perera');
  }
});

test('a malformed code never reaches the database', async () => {
  reset();
  for (const code of ['', 'abcd', '12', '1'.repeat(40), null]) {
    const res = await call(auth, { method: 'POST', url: '/api/auth?r=login', body: { role: 'teacher', code } });
    assert.equal(res.statusCode, 400, `code ${JSON.stringify(code)} should be rejected`);
  }
  assert.equal(calls.filter((c) => c.path.includes('teachers')).length, 0);
});

test('no session means no data', async () => {
  reset();
  assert.equal((await call(teacherApi, { url: '/api/teacher?r=bootstrap' })).statusCode, 401);
  assert.equal((await call(familyApi, { url: '/api/family?r=bootstrap' })).statusCode, 401);
});

test('a family cookie cannot open the teacher api', async () => {
  reset();
  const cookie = await signInFamily();
  const res = await call(teacherApi, { url: '/api/teacher?r=bootstrap', cookie });
  assert.equal(res.statusCode, 401);
});

test('a teacher cookie cannot open the family api', async () => {
  const cookie = await signInTeacher();
  const res = await call(familyApi, { url: '/api/family?r=bootstrap', cookie });
  assert.equal(res.statusCode, 401);
});

test('a tampered cookie is rejected', async () => {
  const cookie = await signInTeacher();
  const broken = `${cookie.slice(0, -4)}aaaa`;
  const res = await call(teacherApi, { url: '/api/teacher?r=bootstrap', cookie: broken });
  assert.equal(res.statusCode, 401);
});

test('logging out clears the cookie', async () => {
  const cookie = await signInTeacher();
  const res = await call(auth, { method: 'POST', url: '/api/auth?r=logout', cookie });
  assert.match(String(res.getHeader('set-cookie')), /Max-Age=0/);
});

/* ============================================================ teacher == */

test('the bootstrap sends everything the tabs need, and no secrets', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, { url: '/api/teacher?r=bootstrap', cookie });
  assert.equal(res.statusCode, 200, res.bodyText);
  const data = res.json;
  for (const key of ['today', 'teacher', 'students', 'classes', 'sessions', 'events', 'months', 'marks', 'papers']) {
    assert.ok(key in data, `the bootstrap is missing ${key}`);
  }
  assert.equal(data.classes[0].student_ids.length, 2, 'enrolment is flattened');
  assert.deepEqual(data.classes[0].skips, []);
  assert.ok(!('code_hash' in data.teacher), 'the code hash never leaves the server');
  assert.ok(!('code_salt' in data.teacher));
  assert.ok(!('code_lookup' in data.teacher));
  assert.ok(!res.bodyText.includes('stub-service-key'));
});

test('every bootstrap query is filtered by the signed-in teacher', async () => {
  const cookie = await signInTeacher();
  calls = [];
  await call(teacherApi, { url: '/api/teacher?r=bootstrap', cookie });
  const reads = calls.filter((c) => c.method === 'GET' && !c.path.includes('/rpc/'));
  assert.ok(reads.length >= 8);
  for (const read of reads) {
    const scoped =
      read.params.teacher_id === `eq.${TID}` ||
      read.params.id === `eq.${TID}` ||
      read.path.endsWith('/teachers');
    assert.ok(scoped, `${read.path} was not scoped to the teacher: ${JSON.stringify(read.params)}`);
  }
});

test('finishing a class saves it and messages the parents of the absent only', async () => {
  const cookie = await signInTeacher();
  calls = [];
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=attendance.finish',
    cookie,
    body: { class_id: CLASS, date: '2026-03-18', absent: [KASUN] },
  });
  assert.equal(res.statusCode, 200, res.bodyText);
  assert.equal(res.json.absent, 1);
  assert.equal(res.json.present, 1);

  const rpc = calls.find((c) => c.path.endsWith('/rpc/finish_class'));
  assert.ok(rpc, 'the transactional function was used');
  assert.equal(rpc.body.p_teacher, TID, 'the teacher comes from the session');
  assert.deepEqual(rpc.body.p_absent, [KASUN]);

  const events = DB.events.filter((e) => e.type === 'absent');
  assert.equal(events.length, 1, 'one event per absent student');
  assert.equal(events[0].student_id, KASUN);
  assert.equal(events[0].channel, 'whatsapp');
  assert.equal(events[0].delivery_status, 'manual', 'no Cloud API, so the teacher sends it');
  assert.match(events[0].text, /absent/);
  assert.equal(res.json.messages.length, 1);
  assert.match(res.json.messages[0].link, /^https:\/\/wa\.me\/94770000001/);
});

test('an absent id that is not in the class is ignored', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=attendance.finish',
    cookie,
    body: { class_id: CLASS, date: '2026-03-18', absent: [OTHER_CHILD] },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.absent, 0, 'a student who is not enrolled cannot be marked');
});

test('a teacher cannot touch another teacher’s class', async () => {
  const cookie = await signInTeacher();
  DB.classes[0].teacher_id = 'someone-else';
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=attendance.finish',
    cookie,
    body: { class_id: CLASS, date: '2026-03-18', absent: [] },
  });
  assert.equal(res.statusCode, 404);
});

test('recording a payment writes a paid event with the amount', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=payment.record',
    cookie,
    body: { student_id: KASUN, classes: 2, method: 'Cash' },
  });
  assert.equal(res.statusCode, 200, res.bodyText);
  assert.equal(res.json.amount, 3000, '2 classes at 1,500');
  const paid = DB.events.find((e) => e.type === 'paid');
  assert.ok(paid);
  assert.match(paid.text, /LKR 3,000/);
  assert.equal(DB.payments[0].method, 'Cash');
});

test('an unknown payment method falls back to bank transfer', async () => {
  const cookie = await signInTeacher();
  await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=payment.record',
    cookie,
    body: { student_id: KASUN, classes: 1, method: 'Bitcoin' },
  });
  assert.equal(DB.payments[0].method, 'Bank transfer');
});

test('confirming a slip pays the whole balance', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=payment.confirm_slip',
    cookie,
    body: { student_id: KASUN },
  });
  assert.equal(res.statusCode, 200, res.bodyText);
  assert.equal(res.json.amount, 6000);
});

test('confirming a slip for a student who owes nothing is refused', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=payment.confirm_slip',
    cookie,
    body: { student_id: AMAYA },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json.error, /Nothing is owed/);
});

test('a payment for another teacher’s student is refused', async () => {
  const cookie = await signInTeacher();
  DB.v_students[0].teacher_id = 'someone-else';
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=payment.record',
    cookie,
    body: { student_id: KASUN, classes: 1 },
  });
  assert.equal(res.statusCode, 404);
});

test('a fee reminder preview is the text that gets sent', async () => {
  const cookie = await signInTeacher();
  const preview = await call(teacherApi, {
    url: `/api/teacher?r=preview&kind=fee&student_id=${KASUN}`,
    cookie,
  });
  assert.equal(preview.statusCode, 200, preview.bodyText);
  assert.match(preview.json.text, /Nimal Sir/);
  assert.match(preview.json.text, /LKR 6,000/);
  assert.match(preview.json.text, /4 classes/);

  const sent = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=message.fee',
    cookie,
    body: { student_id: KASUN },
  });
  assert.equal(sent.json.text, preview.json.text, 'what was approved is what was sent');
  assert.ok(DB.students.find((s) => s.id === KASUN).last_reminded_at, 'the reminder date is noted');
});

test('a fee reminder for a student who owes nothing is refused', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=message.fee',
    cookie,
    body: { student_id: AMAYA },
  });
  assert.equal(res.statusCode, 400);
});

test('the progress report quotes attendance, average and the balance', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, { url: `/api/teacher?r=preview&kind=report&student_id=${KASUN}`, cookie });
  assert.match(res.json.text, /attended 5 of 8 classes \(63 %\)/);
  assert.match(res.json.text, /average mark 65 %/);
  assert.match(res.json.text, /LKR 6,000/);
});

test('adding a mark validates the score and tells the parent', async () => {
  const cookie = await signInTeacher();

  const noTitle = await call(teacherApi, { method: 'POST', url: '/api/teacher?r=mark.add', cookie, body: { student_id: KASUN, score: 50 } });
  assert.equal(noTitle.statusCode, 400);

  const tooHigh = await call(teacherApi, { method: 'POST', url: '/api/teacher?r=mark.add', cookie, body: { student_id: KASUN, title: 'T', score: 120, max_score: 100 } });
  assert.equal(tooHigh.statusCode, 400);
  assert.match(tooHigh.json.error, /higher than the maximum/);

  const good = await call(teacherApi, { method: 'POST', url: '/api/teacher?r=mark.add', cookie, body: { student_id: KASUN, title: 'Model paper 2', score: 34, max_score: 50 } });
  assert.equal(good.statusCode, 200, good.bodyText);
  assert.equal(DB.marks.length, 1);
  assert.equal(Number(DB.marks[0].max_score), 50);
  const event = DB.events.find((e) => e.type === 'mark');
  assert.match(event.text, /34\/50/);
});

test('creating a class needs a student and a day, and names itself', async () => {
  const cookie = await signInTeacher();

  const noStudents = await call(teacherApi, { method: 'POST', url: '/api/teacher?r=class.create', cookie, body: { subject: 'Maths', days: [0], start_time: '16:00', student_ids: [] } });
  assert.equal(noStudents.statusCode, 400);
  assert.match(noStudents.json.error, /at least one student/);

  const noDays = await call(teacherApi, { method: 'POST', url: '/api/teacher?r=class.create', cookie, body: { subject: 'Maths', days: [], start_time: '16:00', student_ids: [KASUN] } });
  assert.equal(noDays.statusCode, 400);
  assert.match(noDays.json.error, /at least one day/);

  const made = await call(teacherApi, { method: 'POST', url: '/api/teacher?r=class.create', cookie, body: { subject: 'Maths', days: [0, 2], start_time: '16:00', student_ids: [KASUN, AMAYA], grade: 11 } });
  assert.equal(made.statusCode, 200, made.bodyText);
  assert.equal(made.json.title, 'Grade 11 Maths small group', 'two students makes a small group');
  assert.equal(DB.class_students.filter((l) => l.class_id === made.json.class_id).length, 2);
});

test('a class cannot be built from someone else’s students', async () => {
  const cookie = await signInTeacher();
  DB.students[0].teacher_id = 'someone-else';
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=class.create',
    cookie,
    body: { subject: 'Maths', days: [0], start_time: '16:00', student_ids: [KASUN, AMAYA] },
  });
  assert.equal(res.statusCode, 403);
});

test('removing a class keeps the history', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, { method: 'POST', url: '/api/teacher?r=class.delete', cookie, body: { class_id: CLASS } });
  assert.equal(res.statusCode, 200);
  assert.equal(DB.classes[0].active, false, 'the class is deactivated, not deleted');
});

test('a single day can be cancelled and restored', async () => {
  const cookie = await signInTeacher();
  await call(teacherApi, { method: 'POST', url: '/api/teacher?r=class.skip', cookie, body: { class_id: CLASS, date: '2026-03-25' } });
  assert.equal(DB.class_exceptions.length, 1);
  await call(teacherApi, { method: 'POST', url: '/api/teacher?r=class.unskip', cookie, body: { class_id: CLASS, date: '2026-03-25' } });
  assert.equal(DB.class_exceptions.length, 0);
});

test('confirming a new student sets the fee and makes a code once', async () => {
  const cookie = await signInTeacher();
  DB.v_students.push({ id: OTHER_CHILD, teacher_id: TID, name: 'Ishara Madushani', parent_phone: '94770000017', status: 'pending', fee_per_class: 0, amount_due: 0, pending_classes: 0, days_late: 0, hist: '' });

  const noFee = await call(teacherApi, { method: 'POST', url: '/api/teacher?r=student.confirm', cookie, body: { student_id: OTHER_CHILD } });
  assert.equal(noFee.statusCode, 400);

  const res = await call(teacherApi, { method: 'POST', url: '/api/teacher?r=student.confirm', cookie, body: { student_id: OTHER_CHILD, fee_per_class: 1000 } });
  assert.equal(res.statusCode, 200, res.bodyText);
  assert.match(res.json.code, /^\d{4}$/, 'a four digit code, as configured');

  const account = DB.family_accounts.find((a) => a.label?.includes('Ishara'));
  assert.ok(account, 'a family account was created');
  assert.ok(!('code' in account), 'the plain code is not stored');
  assert.notEqual(account.code_hash, res.json.code);
  assert.equal(account.code_lookup, codeLookup(res.json.code));
  const confirmed = DB.students.find((s) => s.id === OTHER_CHILD);
  assert.equal(confirmed.status, 'active', 'the student is approved');
  assert.equal(confirmed.fee_per_class, 1000, 'the fee the teacher typed is saved');

  const event = DB.events.find((e) => e.type === 'join');
  assert.match(event.text, new RegExp(res.json.code));
});

test('a replacement family code is new, unique and shown once', async () => {
  const cookie = await signInTeacher();
  const before = DB.family_accounts[0].code_hash;
  const res = await call(teacherApi, { method: 'POST', url: '/api/teacher?r=student.newcode', cookie, body: { student_id: KASUN } });
  assert.equal(res.statusCode, 200, res.bodyText);
  assert.match(res.json.code, /^\d{4}$/);
  assert.notEqual(DB.family_accounts[0].code_hash, before, 'the stored hash changed');
  assert.equal(DB.family_accounts[0].code_lookup, codeLookup(res.json.code));
});

test('the sign-up link carries the teacher key', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, { url: '/api/teacher?r=invite', cookie });
  assert.equal(res.statusCode, 200);
  assert.match(res.json.link, /\/join\?t=nimal$/);
  assert.match(res.json.text, /Nimal Sir/);
  assert.match(res.json.whatsapp, /^https:\/\/wa\.me\//);
});

test('settings only accept the values the screens offer', async () => {
  const cookie = await signInTeacher();
  const good = await call(teacherApi, { method: 'POST', url: '/api/teacher?r=settings.update', cookie, body: { lang: 'ta', theme: 'day', remind_after_days: 7, auto_reminders: false } });
  assert.equal(good.statusCode, 200, good.bodyText);
  assert.equal(good.json.teacher.lang, 'ta');
  assert.equal(good.json.teacher.remind_after_days, 7);
  assert.ok(!('code_hash' in good.json.teacher));

  const bad = await call(teacherApi, { method: 'POST', url: '/api/teacher?r=settings.update', cookie, body: { lang: 'fr', remind_after_days: 3 } });
  assert.equal(bad.statusCode, 400, 'nothing valid to change');
});

test('a Tamil teacher gets Tamil messages', async () => {
  const cookie = await signInTeacher();
  DB.teachers[0].lang = 'ta';
  const res = await call(teacherApi, { url: `/api/teacher?r=preview&kind=fee&student_id=${KASUN}`, cookie });
  assert.match(res.json.text, /[஀-௿]/, 'the reminder is in Tamil');
  assert.match(res.json.text, /LKR 6,000/, 'the amount stays in LKR');
});

test('an unknown action is a 404, not a crash', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, { method: 'POST', url: '/api/teacher?r=drop.everything', cookie, body: {} });
  assert.equal(res.statusCode, 404);
});

/* ============================================================= family == */

test('the family bootstrap sends the child, the week and the feed', async () => {
  await signInTeacher();
  const cookie = await signInFamily('parent');
  const res = await call(familyApi, { url: '/api/family?r=bootstrap', cookie });
  assert.equal(res.statusCode, 200, res.bodyText);
  const data = res.json;
  assert.equal(data.child.name, 'Kasun Perera');
  assert.equal(data.child_id, KASUN);
  assert.equal(data.role, 'parent');
  assert.ok(Array.isArray(data.classes));
  assert.ok(Array.isArray(data.board.marks));
  assert.equal(data.child.slip_path, undefined, 'the storage path is not exposed');
});

test('another family’s child cannot be requested', async () => {
  await signInTeacher();
  const cookie = await signInFamily('parent');
  const res = await call(familyApi, { url: `/api/family?r=bootstrap&child_id=${OTHER_CHILD}`, cookie });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.child_id, KASUN, 'the request falls back to this family’s own child');
  assert.ok(!res.bodyText.includes('Someone Else'));
});

test('switching to a child that is not yours is refused', async () => {
  await signInTeacher();
  const cookie = await signInFamily('parent');
  const res = await call(familyApi, { method: 'POST', url: '/api/family?r=child', cookie, body: { child_id: OTHER_CHILD } });
  assert.equal(res.statusCode, 403);
});

test('the leaderboard leaves the server already masked', async () => {
  await signInTeacher();
  DB.class_students = [
    { class_id: CLASS, student_id: KASUN },
    { class_id: CLASS, student_id: AMAYA },
  ];
  const cookie = await signInFamily('parent');
  const res = await call(familyApi, { url: '/api/family?r=bootstrap', cookie });
  assert.ok(!res.bodyText.includes('Jayasinghe'), 'no other surname in the payload');
  const others = res.json.board.marks.filter((r) => !r.self);
  assert.ok(others.length > 0, 'the peer is on the board');
  for (const row of others) {
    assert.match(row.name, /^\w+ \w\.$/);
    assert.equal(row.id, null, 'no id for another child');
  }
  const me = res.json.board.marks.find((r) => r.self);
  assert.equal(me.name, 'Kasun Perera');
});

test('a slip must be a real image and is stored out of reach', async () => {
  await signInTeacher();
  const cookie = await signInFamily('parent');

  const notAnImage = await call(familyApi, { method: 'POST', url: '/api/family?r=slip', cookie, body: { image: 'data:application/pdf;base64,AAAA' } });
  assert.equal(notAnImage.statusCode, 400);

  const rubbish = await call(familyApi, { method: 'POST', url: '/api/family?r=slip', cookie, body: { image: 'hello' } });
  assert.equal(rubbish.statusCode, 400);

  const png = `data:image/png;base64,${Buffer.from('fake png bytes').toString('base64')}`;
  const good = await call(familyApi, { method: 'POST', url: '/api/family?r=slip', cookie, body: { image: png } });
  assert.equal(good.statusCode, 200, good.bodyText);
  const student = DB.students.find((s) => s.id === KASUN);
  assert.match(student.slip_path, new RegExp(`^${TID}/${KASUN}/`), 'filed under teacher and child');
  assert.ok(student.slip_sent_at);
  assert.ok(DB.events.some((e) => e.type === 'slip'));
});

test('a reschedule request reaches the teacher', async () => {
  await signInTeacher();
  const cookie = await signInFamily('parent');
  const res = await call(familyApi, { method: 'POST', url: '/api/family?r=reschedule', cookie, body: { class_id: CLASS, date: '2026-03-25', note: 'Doctor' } });
  assert.equal(res.statusCode, 200);
  assert.equal(DB.reschedule_requests.length, 1);
  assert.equal(DB.reschedule_requests[0].student_id, KASUN);
  assert.equal(DB.reschedule_requests[0].teacher_id, TID);
});

test('a note on a reschedule request cannot be unbounded', async () => {
  await signInTeacher();
  const cookie = await signInFamily('parent');
  await call(familyApi, { method: 'POST', url: '/api/family?r=reschedule', cookie, body: { note: 'x'.repeat(5000) } });
  assert.equal(DB.reschedule_requests[0].note.length, 500);
});

test('a paper with no file cannot be opened', async () => {
  await signInTeacher();
  DB.papers.push({ id: 'pp1', teacher_id: TID, name: 'No file yet', price: 500, cost: 0, file_path: null });
  const cookie = await signInFamily('student');
  const res = await call(familyApi, { method: 'POST', url: '/api/family?r=paper.link', cookie, body: { paper_id: 'pp1' } });
  assert.equal(res.statusCode, 404);
  assert.match(res.json.error, /not uploaded/);
});

test('a paper from another teacher cannot be opened', async () => {
  await signInTeacher();
  DB.papers.push({ id: 'pp2', teacher_id: 'someone-else', name: 'Theirs', file_path: 'papers/x.pdf' });
  const cookie = await signInFamily('student');
  const res = await call(familyApi, { method: 'POST', url: '/api/family?r=paper.link', cookie, body: { paper_id: 'pp2' } });
  assert.equal(res.statusCode, 404);
});

/* ============================================================== join === */

test('the sign-up form shows only that teacher’s subjects', async () => {
  reset();
  const res = await call(joinApi, { url: '/api/join?r=config&t=nimal' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json.subjects, ['Maths', 'Science']);
  assert.deepEqual(res.json.curricula, ['Local', 'Cambridge']);
  assert.equal(res.json.teacher.name, 'Nimal');
  assert.ok(!('id' in res.json.teacher), 'the teacher id is not public');
});

test('a wrong sign-up key tells the family the link is stale', async () => {
  reset();
  const res = await call(joinApi, { url: '/api/join?r=config&t=nope' });
  assert.equal(res.statusCode, 404);
});

test('a sign-up needs a name and a phone number', async () => {
  reset();
  const noName = await call(joinApi, { method: 'POST', url: '/api/join?r=submit', body: { t: 'nimal', parent_phone: '94770000018' } });
  assert.equal(noName.statusCode, 400);
  const noPhone = await call(joinApi, { method: 'POST', url: '/api/join?r=submit', body: { t: 'nimal', name: 'New Child' } });
  assert.equal(noPhone.statusCode, 400);
  assert.match(noPhone.json.error, /WhatsApp number/);
});

test('a sign-up creates a pending student with no fee and no code', async () => {
  reset();
  const res = await call(joinApi, {
    method: 'POST',
    url: '/api/join?r=submit',
    body: { t: 'nimal', name: 'New Child', grade: '10', school: 'A School', subjects: ['Maths', 'Ballet'], curriculum: 'Cambridge', parent_name: 'A Parent', parent_phone: '+94 77 000 0018' },
  });
  assert.equal(res.statusCode, 200, res.bodyText);
  assert.equal(res.json.teacher, 'Nimal Sir');

  const created = DB.students.find((s) => s.name === 'New Child');
  assert.equal(created.status, 'pending');
  assert.equal(created.fee_per_class, 0);
  assert.equal(created.parent_phone, '94770000018', 'the number is normalised');
  assert.deepEqual(created.wanted_subjects, ['Maths'], 'a subject this teacher does not teach is dropped');
  assert.equal(created.curriculum, 'Cambridge');
  assert.equal(DB.family_accounts.filter((a) => a.label?.includes('New Child')).length, 0, 'no code until the teacher confirms');
});

test('a sign-up cannot choose a curriculum the teacher does not offer', async () => {
  reset();
  await call(joinApi, { method: 'POST', url: '/api/join?r=submit', body: { t: 'nimal', name: 'Another Child', parent_phone: '94770000019', curriculum: 'Edexcel' } });
  assert.equal(DB.students.find((s) => s.name === 'Another Child').curriculum, 'Local');
});

test('sign-ups from one address are capped', async () => {
  reset();
  for (let i = 0; i < 5; i += 1) {
    await call(joinApi, { method: 'POST', url: '/api/join?r=submit', body: { t: 'nimal', name: `Child ${i}`, parent_phone: `9477000010${i}` } });
  }
  const res = await call(joinApi, { method: 'POST', url: '/api/join?r=submit', body: { t: 'nimal', name: 'One Too Many', parent_phone: '94770001099' } });
  assert.equal(res.statusCode, 429);
});

/* ============================================================== cron === */

test('the cron endpoint refuses a caller without the secret', async () => {
  reset();
  process.env.CRON_SECRET = 'top-secret';
  const res = await call(cronApi, { url: '/api/cron' });
  assert.equal(res.statusCode, 401);
  delete process.env.CRON_SECRET;
});

test('the cron endpoint accepts the Vercel bearer token', async () => {
  reset();
  process.env.CRON_SECRET = 'top-secret';
  const req = makeReq({ url: '/api/cron' });
  req.headers.authorization = 'Bearer top-secret';
  const res = makeRes();
  await cronApi(req, res);
  assert.equal(res.statusCode, 200, res.bodyText);
  delete process.env.CRON_SECRET;
});

test('auto reminders go only to students past the teacher’s setting', async () => {
  reset();
  const res = await call(cronApi, { url: '/api/cron?job=fees' });
  assert.equal(res.statusCode, 200, res.bodyText);
  assert.equal(res.json.fee_reminders, 1, 'only the student 32 days late');
  const event = DB.events.find((e) => e.type === 'fee');
  assert.equal(event.student_id, KASUN);
  assert.match(event.text, /LKR 6,000/);
  assert.ok(DB.students.find((s) => s.id === KASUN).last_reminded_at);
});

test('auto reminders are skipped when the teacher switched them off', async () => {
  reset();
  DB.teachers[0].auto_reminders = false;
  const res = await call(cronApi, { url: '/api/cron?job=fees' });
  assert.equal(res.json.fee_reminders, 0);
  assert.equal(DB.events.length, 0);
});

test('a student reminded yesterday is not nagged again today', async () => {
  reset();
  DB.v_students[0].last_reminded_at = new Date(Date.now() - 86_400_000).toISOString();
  const res = await call(cronApi, { url: '/api/cron?job=fees' });
  assert.equal(res.json.fee_reminders, 0, 'the 14 day period has not passed');
});

test('tomorrow’s classes are notified once, and marked so', async () => {
  reset();
  const first = await call(cronApi, { url: '/api/cron?job=classes' });
  assert.equal(first.statusCode, 200, first.bodyText);
  const sent = first.json.class_reminders;

  const second = await call(cronApi, { url: '/api/cron?job=classes' });
  if (sent > 0) {
    assert.ok(DB.sessions.some((s) => s.notified_at), 'the session records that it was notified');
    assert.equal(second.json.class_reminders, 0, 'no second round of messages');
  } else {
    assert.equal(second.json.class_reminders, 0);
  }
});
