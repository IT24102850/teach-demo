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
        own_place_name: 'My home',
        own_place_area: 'Nugegoda',
        plus_price: 500,
        plus_share: 0.5,
        plus_since: '2026-01-05',
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
        kind: 'group',
        venue_type: 'area',
        venue_name: null,
        area: 'Nugegoda',
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
    /* Kasun's family pays for Plus; Amaya's does not. The gate is the
       difference between them in every family test below. */
    subscriptions: [
      {
        id: 'bbbbbbbb-0000-4000-8000-00000000000b',
        teacher_id: TID,
        student_id: KASUN,
        status: 'active',
        price: 500,
        share: 0.5,
        started_on: '2026-01-05',
        ended_on: null,
      },
    ],
    teacher_plus_months: [
      { teacher_id: TID, month: '2026-02', students: 1, teacher_income: 250, gross: 500 },
      { teacher_id: TID, month: '2026-03', students: 1, teacher_income: 250, gross: 500 },
    ],
    teacher_tuition_months: [
      { teacher_id: TID, month: '2026-02', charged: 20000 },
      { teacher_id: TID, month: '2026-03', charged: 22000 },
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
      // Point 10: the real start and end times go in with the session.
      const existing = DB.sessions.find(
        (x) => x.class_id === body.p_class && x.session_date === body.p_date,
      );
      const row = existing || {
        id: uuid(),
        class_id: body.p_class,
        teacher_id: body.p_teacher,
        session_date: body.p_date,
      };
      row.status = 'done';
      row.started_at = row.started_at || body.p_started || null;
      row.ended_at = body.p_ended || new Date().toISOString();
      row.absent = body.p_absent || [];
      if (!existing) DB.sessions.push(row);
      return json(200, row.id);
    }
    if (fn === 'start_class') {
      const existing = DB.sessions.find(
        (x) => x.class_id === body.p_class && x.session_date === body.p_date,
      );
      // Pressing Start twice must not restart the clock.
      if (existing) {
        existing.started_at = existing.started_at || new Date().toISOString();
        return json(200, existing.started_at);
      }
      const started = new Date().toISOString();
      DB.sessions.push({
        id: uuid(),
        class_id: body.p_class,
        teacher_id: body.p_teacher,
        session_date: body.p_date,
        status: 'planned',
        started_at: started,
        ended_at: null,
      });
      return json(200, started);
    }
    if (fn === 'record_payment') {
      const student = DB.v_students.find((s) => s.id === body.p_student);
      const due = student?.amount_due ?? 0;
      const fee = student?.fee_per_class ?? 0;
      const asked = body.p_amount ?? (body.p_classes ? body.p_classes * fee : due);
      // Point 11: the database clamps to what is owed, so a part payment is
      // kept as typed and an over-payment can never create a credit.
      const amount = Math.min(Math.max(asked, 0), due);
      if (amount <= 0) return json(400, { message: 'nothing is owed' });
      const receiptNo =
        DB.payments.reduce((max, x) => Math.max(max, x.receipt_no || 0), 0) + 1;
      const row = {
        id: uuid(),
        teacher_id: body.p_teacher,
        student_id: body.p_student,
        amount,
        method: body.p_method,
        paid_date: body.p_paid_date || '2026-03-18',
        receipt_no: receiptNo,
        reversed_at: null,
      };
      DB.payments.push(row);
      if (student) student.amount_due = due - amount;
      return json(200, {
        payment_id: row.id,
        amount,
        receipt_no: receiptNo,
        balance: due - amount,
        full: amount >= due,
      });
    }
    if (fn === 'start_subscription') {
      if (!DB.students.some((x) => x.id === body.p_student && x.teacher_id === body.p_teacher)) {
        return json(400, { message: 'student not found for this teacher' });
      }
      if (DB.subscriptions.some((x) => x.student_id === body.p_student && x.status === 'active')) {
        return json(400, { message: 'that student is already on Plus' });
      }
      const row = {
        id: uuid(),
        teacher_id: body.p_teacher,
        student_id: body.p_student,
        status: 'active',
        price: body.p_price ?? 500,
        share: 0.5,
        started_on: '2026-03-18',
        ended_on: null,
        note: body.p_note ?? null,
      };
      DB.subscriptions.push(row);
      return json(200, {
        subscription_id: row.id,
        price: row.price,
        share: row.share,
        students: DB.subscriptions.filter(
          (x) => x.teacher_id === body.p_teacher && x.status === 'active',
        ).length,
      });
    }
    if (fn === 'end_subscription') {
      const row = DB.subscriptions.find(
        (x) => x.student_id === body.p_student && x.teacher_id === body.p_teacher && x.status === 'active',
      );
      if (!row) return json(400, { message: 'that student is not on Plus' });
      row.status = 'ended';
      row.ended_on = '2026-03-18';
      return json(200, {
        subscription_id: row.id,
        students: DB.subscriptions.filter(
          (x) => x.teacher_id === body.p_teacher && x.status === 'active',
        ).length,
      });
    }
    if (fn === 'reverse_payment') {
      const row = DB.payments.find((x) => x.id === body.p_payment);
      if (!row) return json(400, { message: 'payment not found for this teacher' });
      if (row.reversed_at) return json(400, { message: 'that payment was already undone' });
      row.reversed_at = new Date().toISOString();
      const student = DB.v_students.find((s) => s.id === row.student_id);
      if (student) student.amount_due = Number(student.amount_due) + Number(row.amount);
      return json(200, {
        payment_id: row.id,
        amount: row.amount,
        student_id: row.student_id,
        receipt_no: row.receipt_no,
      });
    }
    return json(400, { message: `unknown function ${fn}` });
  }

  /* table access */
  const table = parsed.pathname.replace('/rest/v1/', '');
  DB[table] = DB[table] || [];

  if (method === 'GET') {
    // student_plus is a view: one row per student, saying whether a
    // subscription is active right now.
    if (table === 'student_plus') {
      const derived = DB.students.map((st) => ({
        student_id: st.id,
        teacher_id: st.teacher_id,
        on_plus: DB.subscriptions.some((x) => x.student_id === st.id && x.status === 'active'),
        started_on:
          DB.subscriptions.find((x) => x.student_id === st.id && x.status === 'active')
            ?.started_on ?? null,
      }));
      return json(200, derived.filter((row) => matches(row, params)));
    }
    let rows = DB[table].filter((row) => matches(row, params));
    if (params.limit) rows = rows.slice(0, Number(params.limit));
    // PostgREST resolves embedded resources, e.g. class_students(classes(...)).
    if (table === 'class_students' && (params.select || '').includes('classes(')) {
      rows = rows.map((row) => ({
        ...row,
        classes: DB.classes.find((c) => c.id === row.class_id) || null,
      }));
    }
    if (table === 'sessions' && (params.select || '').includes('attendance(')) {
      rows = rows.map((row) => ({
        ...row,
        attendance: DB.attendance.filter((a) => a.session_id === row.id),
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

/* ===================== Plus subscriptions and the Income tab ============= */

test('a subscription is recorded by hand, and answers with the new count', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=subscription.start',
    cookie,
    body: { student_id: AMAYA },
  });

  assert.equal(res.statusCode, 200, res.bodyText);
  assert.equal(res.json.name, 'Amaya Jayasinghe');
  assert.equal(res.json.students, 2, 'Kasun was already on Plus');
  assert.equal(res.json.price, 500, 'the teacher\'s price, unless one was given');
  assert.ok(DB.subscriptions.some((x) => x.student_id === AMAYA && x.status === 'active'));
  // The celebration pop-up is driven by this event.
  assert.ok(DB.events.some((e) => e.type === 'join' && /joined Plus/.test(e.text)));
});

test('the same student cannot be subscribed twice', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=subscription.start',
    cookie,
    body: { student_id: KASUN },
  });
  assert.equal(res.statusCode, 500);
  assert.match(res.json.error, /already on Plus/);
});

test('a subscription can be given its own price', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=subscription.start',
    cookie,
    body: { student_id: AMAYA, price: 750 },
  });
  assert.equal(res.json.price, 750);
});

test('ending a subscription keeps the row, marked ended', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=subscription.end',
    cookie,
    body: { student_id: KASUN },
  });
  assert.equal(res.statusCode, 200, res.bodyText);
  assert.equal(res.json.students, 0);
  assert.equal(DB.subscriptions.length, 1, 'nothing was deleted');
  assert.equal(DB.subscriptions[0].status, 'ended');
  assert.ok(DB.subscriptions[0].ended_on, 'and the month it was paid for still counts');
});

test('a student who is not on Plus cannot be ended', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=subscription.end',
    cookie,
    body: { student_id: AMAYA },
  });
  assert.equal(res.statusCode, 500);
  assert.match(res.json.error, /not on Plus/);
});

test("another teacher's student cannot be subscribed", async () => {
  const cookie = await signInTeacher();
  DB.students[1].teacher_id = 'someone-else';
  DB.v_students[1].teacher_id = 'someone-else';
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=subscription.start',
    cookie,
    body: { student_id: AMAYA },
  });
  assert.equal(res.statusCode, 404);
});

test('the teacher bootstrap says who is on Plus, and carries both month series', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, { url: '/api/teacher?r=bootstrap', cookie });

  assert.equal(res.statusCode, 200, res.bodyText);
  const kasun = res.json.students.find((x) => x.id === KASUN);
  const amaya = res.json.students.find((x) => x.id === AMAYA);
  assert.equal(kasun.on_plus, true);
  assert.equal(amaya.on_plus, false);
  assert.equal(res.json.plus_months.length, 2, 'the Plus line of the graph');
  assert.equal(res.json.tuition_months.length, 2, 'and the tuition line');
});

/* ------------------------------------------- the invite (handoff draft 2) */

test('the invite screen gives the link and the wording in three languages', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    url: `/api/teacher?r=plus_invite&class_id=${CLASS}`,
    cookie,
  });

  assert.equal(res.statusCode, 200, res.bodyText);
  assert.match(res.json.link, /\/join\?t=nimal$/, 'the same join link the QR code shows');
  assert.equal(res.json.title, 'Grade 11 Maths small group');
  assert.deepEqual(
    res.json.languages.map((l) => l.code),
    ['en', 'ta', 'si'],
  );
  for (const l of res.json.languages) {
    assert.ok(l.text.includes(res.json.link), `${l.code} carries the link`);
    assert.doesNotMatch(l.text, /LKR|Rs/, 'no amounts in the promo, as the handoff asks');
  }
  assert.match(res.json.languages[0].text, /now uses Plus/);
});

test('inviting a class messages only the students who are not on Plus', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=message.plus_invite',
    cookie,
    body: { class_id: CLASS, lang: 'en' },
  });

  assert.equal(res.statusCode, 200, res.bodyText);
  // The fixture class holds Kasun (on Plus) and Amaya (not).
  assert.equal(res.json.invited, 1, 'Kasun is already subscribed and is left alone');
  assert.equal(res.json.messages[0].name, 'Amaya Jayasinghe');
  assert.match(res.json.text, /now uses Plus/);
});

test('inviting a class where everyone is already on Plus is refused', async () => {
  const cookie = await signInTeacher();
  await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=subscription.start',
    cookie,
    body: { student_id: AMAYA },
  });
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=message.plus_invite',
    cookie,
    body: { class_id: CLASS },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json.error, /already on Plus/);
});

/* --------------------------- "there are no free parents in the app" ------ */

test('a subscribed family sees everything, as before', async () => {
  const cookie = await signInFamily();
  const res = await call(familyApi, { url: '/api/family?r=bootstrap', cookie });
  assert.equal(res.statusCode, 200, res.bodyText);
  assert.ok(!res.json.locked, 'not locked');
  assert.ok(res.json.child, 'and the child is there');
});

test('a family that is not subscribed gets the subscribe screen and nothing else', async () => {
  const cookie = await signInFamily();
  // The parent stops paying.
  DB.subscriptions[0].status = 'ended';
  DB.subscriptions[0].ended_on = '2026-03-01';

  const res = await call(familyApi, { url: '/api/family?r=bootstrap', cookie });
  assert.equal(res.statusCode, 200, res.bodyText);
  assert.equal(res.json.locked, true);
  assert.equal(res.json.child.name, 'Kasun Perera', 'it still says whose it is');
  assert.ok(res.json.price > 0, 'and what Plus costs');

  // None of the things a subscriber would see.
  for (const key of ['classes', 'marks', 'events', 'payments', 'board', 'sessions']) {
    assert.equal(res.json[key], undefined, `${key} is not sent to a locked family`);
  }
});

test('a family that is not subscribed cannot write either', async () => {
  const cookie = await signInFamily();
  DB.subscriptions[0].status = 'ended';
  DB.subscriptions[0].ended_on = '2026-03-01';

  for (const [action, body] of [
    ['slip', { image: `data:image/png;base64,${Buffer.from('fake png bytes').toString('base64')}` }],
    ['reschedule', { note: 'Can we move it?' }],
  ]) {
    const res = await call(familyApi, {
      method: 'POST',
      url: `/api/family?r=${action}`,
      cookie,
      body,
    });
    assert.equal(res.statusCode, 402, `${action} is refused`);
    assert.match(res.json.error, /Plus subscription/);
  }
});

test('subscribing again opens the app back up', async () => {
  const cookie = await signInFamily();
  DB.subscriptions[0].status = 'ended';
  DB.subscriptions[0].ended_on = '2026-03-01';
  assert.equal((await call(familyApi, { url: '/api/family?r=bootstrap', cookie })).json.locked, true);

  const teacherCookie = await signInTeacher();
  await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=subscription.start',
    cookie: teacherCookie,
    body: { student_id: KASUN },
  });

  const res = await call(familyApi, { url: '/api/family?r=bootstrap', cookie });
  assert.ok(!res.json.locked, 'the family is back in');
  assert.ok(res.json.child);
});

/* ============== point 9 phase 2: a class dragged to another slot ========= */

/*
 * The fixture class runs Monday and Wednesday at 16:00 for 1.5 hours.
 *
 * These dates are worked out from today rather than written down, because a
 * class may not be dragged into the past - a fixed date would start failing
 * the morning after it was written.
 */
const shiftDay = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const RIGHT_NOW = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Colombo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

/** The next Wednesday from today, and the Thursday after it. */
const WED = (() => {
  let date = RIGHT_NOW;
  while (new Date(`${date}T00:00:00Z`).getUTCDay() !== 3) date = shiftDay(date, 1);
  return date;
})();
const THU = shiftDay(WED, 1);

const move = (cookie, body) =>
  call(teacherApi, { method: 'POST', url: '/api/teacher?r=class.move', cookie, body });

test('dragging one session makes a one-off and cancels that day', async () => {
  const cookie = await signInTeacher();
  const res = await move(cookie, {
    class_id: CLASS,
    from_date: WED,
    to_date: THU,
    start_time: '17:00',
    scope: 'day',
  });

  assert.equal(res.statusCode, 200, res.bodyText);
  assert.equal(res.json.scope, 'day');

  const copy = DB.classes.find((c) => c.id === res.json.class_id);
  assert.ok(copy, 'a class was created for the new day');
  assert.equal(copy.once_date, THU, 'as a one-off on the day it was dropped');
  assert.equal(copy.start_time, '17:00');
  assert.deepEqual(copy.days, [], 'it does not repeat');
  assert.equal(Number(copy.duration_hours), 1.5, 'moving does not change the length');
  assert.equal(copy.venue_type, 'area', 'and it keeps where it is held');
  assert.equal(copy.area, 'Nugegoda');
  assert.equal(
    DB.class_students.filter((l) => l.class_id === copy.id).length,
    2,
    'with the same students',
  );

  const skip = DB.class_exceptions.find((x) => x.class_id === CLASS && x.skip_date === WED);
  assert.ok(skip, 'the repeating class is cancelled on the day it left');
  assert.equal(DB.classes.find((c) => c.id === CLASS).active, true, 'the class itself stays');
});

test('dragging the whole class swaps that weekday and keeps the others', async () => {
  const cookie = await signInTeacher();
  const res = await move(cookie, {
    class_id: CLASS,
    from_date: WED,
    to_date: THU,
    start_time: '17:00',
    scope: 'all',
  });

  assert.equal(res.statusCode, 200, res.bodyText);
  const cls = DB.classes.find((c) => c.id === CLASS);
  assert.deepEqual(cls.days, [0, 3], 'Wednesday became Thursday, Monday stayed');
  assert.equal(cls.start_time, '17:00');
  assert.equal(DB.classes.length, 1, 'nothing was copied');
  assert.equal((DB.class_exceptions || []).length, 0, 'and no day was cancelled');
});

test('every student in the moved class gets one WhatsApp message', async () => {
  const cookie = await signInTeacher();
  const res = await move(cookie, {
    class_id: CLASS,
    from_date: WED,
    to_date: THU,
    start_time: '17:00',
    scope: 'day',
  });

  assert.equal(res.json.told, 2, 'both students in the class');
  assert.equal(res.json.messages.length, 2);
  for (const m of res.json.messages) {
    assert.match(m.text, /has moved from/);
    assert.ok(m.text.includes(`Wednesday ${WED}`), `names the day it left: ${m.text}`);
    assert.ok(m.text.includes(`Thursday ${THU} · 5:00 PM`), `and where it goes: ${m.text}`);
    assert.ok(m.link?.startsWith('https://wa.me/'), 'with a link to send it by hand');
  }
  assert.equal(DB.events.filter((e) => e.type === 'class').length, 2, 'one event each');
  assert.match(DB.events[0].text, /moved to/);
});

test('the teacher can move a class without telling anyone', async () => {
  const cookie = await signInTeacher();
  const res = await move(cookie, {
    class_id: CLASS,
    from_date: WED,
    to_date: THU,
    start_time: '17:00',
    scope: 'day',
    notify: false,
  });

  assert.equal(res.statusCode, 200, res.bodyText);
  assert.equal(res.json.told, 0);
  assert.deepEqual(res.json.messages, []);
  assert.equal(DB.events.length, 0, 'nothing was sent and nothing was logged');
  assert.ok(DB.classes.find((c) => c.id === res.json.class_id), 'but the class did move');
});

test('a move onto another class is refused, and names it', async () => {
  const cookie = await signInTeacher();
  DB.classes.push({
    id: 'aaaaaaaa-0000-4000-8000-00000000000a',
    teacher_id: TID,
    subject: 'Science',
    curriculum: 'Local',
    grade: 11,
    title: 'Grade 11 Science',
    kind: 'individual',
    venue_type: 'area',
    area: 'Nugegoda',
    place: 'Nugegoda',
    days: [3], // Thursday
    start_time: '17:30:00',
    duration_hours: 1,
    start_date: '2026-01-05',
    once_date: null,
    active: true,
    class_students: [{ student_id: KASUN }],
    class_exceptions: [],
  });

  const res = await move(cookie, {
    class_id: CLASS,
    from_date: WED,
    to_date: THU,
    start_time: '17:00',
    scope: 'day',
  });
  assert.equal(res.statusCode, 409);
  assert.match(res.json.error, /Grade 11 Science/);
  assert.equal(res.json.clash.start_time, '17:30');
  assert.equal((DB.class_exceptions || []).length, 0, 'and nothing was changed');
  assert.equal(DB.events.length, 0, 'and nobody was told');

  const anyway = await move(cookie, {
    class_id: CLASS,
    from_date: WED,
    to_date: THU,
    start_time: '17:00',
    scope: 'day',
    allow_clash: true,
  });
  assert.equal(anyway.statusCode, 200, '"Save anyway" lets a deliberate overlap through');
});

test('moving a session later the same day is not a clash with itself', async () => {
  const cookie = await signInTeacher();
  // The Wednesday session is cancelled as part of the move, so the class it
  // came from must not be reported as standing in its own way.
  const res = await move(cookie, {
    class_id: CLASS,
    from_date: WED,
    to_date: WED,
    start_time: '17:00',
    scope: 'day',
  });
  assert.equal(res.statusCode, 200, res.bodyText);
});

test('a class cannot be dragged into the past', async () => {
  const cookie = await signInTeacher();
  const res = await move(cookie, {
    class_id: CLASS,
    from_date: WED,
    to_date: '2020-01-06',
    start_time: '17:00',
    scope: 'day',
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json.error, /past/);
});

test('a move with no dates, or a bad time, is refused', async () => {
  const cookie = await signInTeacher();
  for (const body of [
    { class_id: CLASS, to_date: THU, start_time: '17:00' },
    { class_id: CLASS, from_date: WED, start_time: '17:00' },
    { class_id: CLASS, from_date: WED, to_date: 'tomorrow', start_time: '17:00' },
    { class_id: CLASS, from_date: WED, to_date: THU, start_time: 'half five' },
  ]) {
    const res = await move(cookie, body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
});

test("another teacher's class cannot be moved", async () => {
  const cookie = await signInTeacher();
  const res = await move(cookie, {
    class_id: '00000000-0000-4000-8000-0000000000ff',
    from_date: WED,
    to_date: THU,
    start_time: '17:00',
  });
  assert.equal(res.statusCode, 404);
});

test('a parent cannot move a class', async () => {
  const cookie = await signInFamily();
  const res = await move(cookie, {
    class_id: CLASS,
    from_date: WED,
    to_date: THU,
    start_time: '17:00',
  });
  assert.equal(res.statusCode, 401);
});

/* ===================================== point 10: start, end and absence == */

test('Start class records the real start time and nothing else', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=attendance.start',
    cookie,
    body: { class_id: CLASS, date: '2026-03-18' },
  });
  assert.equal(res.statusCode, 200, res.bodyText);
  assert.ok(res.json.started_at, 'the clock is running');
  const session = DB.sessions.find((x) => x.class_id === CLASS);
  assert.equal(session.status, 'planned', 'starting is not finishing');
  assert.equal(session.ended_at, null);
  assert.equal(DB.charges.length, 0, 'nobody is charged until the class ends');
});

test('pressing Start twice does not restart the clock', async () => {
  const cookie = await signInTeacher();
  const first = await call(teacherApi, { method: 'POST', url: '/api/teacher?r=attendance.start', cookie, body: { class_id: CLASS, date: '2026-03-18' } });
  const again = await call(teacherApi, { method: 'POST', url: '/api/teacher?r=attendance.start', cookie, body: { class_id: CLASS, date: '2026-03-18' } });
  assert.equal(again.json.started_at, first.json.started_at);
  assert.equal(DB.sessions.length, 1, 'still one session');
});

test('End class saves the real times and tells each absent parent once', async () => {
  const cookie = await signInTeacher();
  await call(teacherApi, { method: 'POST', url: '/api/teacher?r=attendance.start', cookie, body: { class_id: CLASS, date: '2026-03-18' } });

  const started = '2026-03-18T10:32:00.000Z';
  const ended = '2026-03-18T13:01:00.000Z';
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=attendance.finish',
    cookie,
    body: { class_id: CLASS, date: '2026-03-18', absent: [KASUN], started_at: started, ended_at: ended },
  });

  assert.equal(res.statusCode, 200, res.bodyText);
  assert.equal(res.json.absent, 1);
  assert.equal(res.json.present, 1);
  assert.equal(res.json.ended_at, ended, 'the end time is stored');
  assert.equal(res.json.messages.length, 1, 'one message, to the one absent parent');
  assert.match(res.json.messages[0].text, /was absent from today/);
  assert.equal(res.json.messages[0].name, 'Kasun Perera');
  assert.equal(DB.events.filter((e) => e.type === 'absent').length, 1);
});

test('a parent already told with "Send now" is not told again at the end', async () => {
  const cookie = await signInTeacher();

  const now = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=attendance.absent_now',
    cookie,
    body: { class_id: CLASS, date: '2026-03-18', student_id: KASUN },
  });
  assert.equal(now.statusCode, 200, now.bodyText);
  assert.equal(DB.events.filter((e) => e.type === 'absent').length, 1);

  await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=attendance.finish',
    cookie,
    body: { class_id: CLASS, date: '2026-03-18', absent: [KASUN], already_notified: [KASUN] },
  });
  assert.equal(
    DB.events.filter((e) => e.type === 'absent').length,
    1,
    'point 10: exactly one message per absent student',
  );
});

test('"Send now" refuses a student who is not in that class', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=attendance.absent_now',
    cookie,
    body: { class_id: CLASS, date: '2026-03-18', student_id: OTHER_CHILD },
  });
  assert.equal(res.statusCode, 404);
});

test('Resend can send a message the teacher edited', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=attendance.resend',
    cookie,
    body: { class_id: CLASS, date: '2026-03-18', student_id: KASUN, text: 'Please call me about today.' },
  });
  assert.equal(res.statusCode, 200, res.bodyText);
  assert.equal(res.json.text, 'Please call me about today.');
  assert.equal(DB.events.at(-1).text, 'Marked absent for Maths', 'the feed keeps its short label');
});

test('the start and end times can be corrected after the class', async () => {
  const cookie = await signInTeacher();
  await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=attendance.finish',
    cookie,
    body: { class_id: CLASS, date: '2026-03-18', absent: [], started_at: '2026-03-18T10:32:00.000Z', ended_at: '2026-03-18T13:01:00.000Z' },
  });

  const fixed = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=attendance.fix_times',
    cookie,
    body: { class_id: CLASS, date: '2026-03-18', started_at: '2026-03-18T10:30:00.000Z', ended_at: '2026-03-18T12:30:00.000Z' },
  });
  assert.equal(fixed.statusCode, 200, fixed.bodyText);
  assert.equal(fixed.json.taught_minutes, 120);

  const backwards = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=attendance.fix_times',
    cookie,
    body: { class_id: CLASS, date: '2026-03-18', started_at: '2026-03-18T13:00:00.000Z', ended_at: '2026-03-18T10:00:00.000Z' },
  });
  assert.equal(backwards.statusCode, 400);
  assert.match(backwards.json.error, /cannot end before/);
});

test('correcting the times of a class that was never marked is refused', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=attendance.fix_times',
    cookie,
    body: { class_id: CLASS, date: '2026-03-20', started_at: '2026-03-20T10:30:00.000Z', ended_at: '2026-03-20T12:30:00.000Z' },
  });
  assert.equal(res.statusCode, 404);
});

/* ======================================= point 3: numbers on every path == */

test('adding a student by hand is held to the +94 rule', async () => {
  const cookie = await signInTeacher();
  const bad = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=student.create',
    cookie,
    body: { name: 'New Pupil', parent_phone: '0112345678', fee_per_class: 1000 },
  });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json.error, /Sri Lankan mobile/);

  const good = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=student.create',
    cookie,
    body: { name: 'New Pupil', parent_phone: '077 123 4567', fee_per_class: 1000 },
  });
  assert.equal(good.statusCode, 200, good.bodyText);
  const made = DB.students.find((x) => x.name === 'New Pupil');
  assert.equal(made.parent_phone, '94771234567');
  assert.equal(made.call_name, 'New', 'the short name is suggested');
});

test('editing a number is held to the same rule', async () => {
  const cookie = await signInTeacher();
  const bad = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=student.update',
    cookie,
    body: { student_id: KASUN, parent_phone: '12345' },
  });
  assert.equal(bad.statusCode, 400);

  const good = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=student.update',
    cookie,
    body: { student_id: KASUN, parent_phone: '0771112222' },
  });
  assert.equal(good.statusCode, 200, good.bodyText);
  assert.equal(DB.students.find((x) => x.id === KASUN).parent_phone, '94771112222');
});

/* ============================== point 12: the teacher's own place setting = */

test('the teaching place is saved once and reused', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=settings.update',
    cookie,
    body: { own_place_name: 'My studio', own_place_area: 'Dehiwala' },
  });
  assert.equal(res.statusCode, 200, res.bodyText);
  assert.equal(res.json.teacher.own_place_name, 'My studio');

  const made = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=class.create',
    cookie,
    body: { kind: 'group', venue_type: 'own_place', subject: 'Maths', days: [4], start_time: '18:00', duration_hours: 1, student_ids: [KASUN, AMAYA] },
  });
  assert.equal(made.statusCode, 200, made.bodyText);
  const cls = DB.classes.find((c) => c.id === made.json.class_id);
  assert.equal(cls.place, 'My studio · Dehiwala');
});

test('recording a payment writes a paid event with the amount and a receipt', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=payment.record',
    cookie,
    body: { student_id: KASUN, classes: 2, method: 'Cash' },
  });
  assert.equal(res.statusCode, 200, res.bodyText);
  assert.equal(res.json.amount, 3000, '2 classes at 1,500');
  assert.equal(res.json.receipt, '#0001', 'point 11: the parent gets a receipt number');
  assert.equal(res.json.balance, 3000, 'half of the 6,000 is still owed');
  assert.equal(res.json.full, false);
  const paid = DB.events.find((e) => e.type === 'paid');
  assert.ok(paid);
  assert.match(paid.text, /LKR 3,000/);
  assert.equal(DB.payments[0].method, 'Cash');
});

/* ------------------------------------------- point 11: part payment, undo */

test('a part payment leaves the rest owing', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=payment.record',
    cookie,
    body: { student_id: KASUN, amount: 2000, method: 'Online' },
  });
  assert.equal(res.statusCode, 200, res.bodyText);
  assert.equal(res.json.amount, 2000);
  assert.equal(res.json.balance, 4000, '2,000 off 6,000 leaves 4,000');
  assert.equal(res.json.full, false);
  assert.equal(DB.payments[0].method, 'Online', 'Online is a method now');
});

test('a payment larger than the bill is clamped, never a credit', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=payment.record',
    cookie,
    body: { student_id: KASUN, amount: 60000, method: 'Cash' },
  });
  assert.equal(res.json.amount, 6000);
  assert.equal(res.json.balance, 0);
  assert.equal(res.json.full, true);
});

test('an amount of zero or less is refused before it reaches the database', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=payment.record',
    cookie,
    body: { student_id: KASUN, amount: 0 },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json.error, /amount/i);
});

test('turning the receipt tick off records the payment and sends nothing', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=payment.record',
    cookie,
    body: { student_id: KASUN, amount: 1500, send_receipt: false },
  });
  assert.equal(res.statusCode, 200, res.bodyText);
  assert.equal(DB.events.filter((e) => e.type === 'paid').length, 0, 'no message went out');
  assert.equal(DB.payments.length, 1, 'but the money is recorded');
});

test('Undo reverses a payment instead of deleting it', async () => {
  const cookie = await signInTeacher();
  const paid = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=payment.record',
    cookie,
    body: { student_id: KASUN, amount: 2000 },
  });
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=payment.reverse',
    cookie,
    body: { payment_id: paid.json.payment_id },
  });
  assert.equal(res.statusCode, 200, res.bodyText);
  assert.equal(res.json.amount, 2000);
  assert.equal(DB.payments.length, 1, 'the row is still there');
  assert.ok(DB.payments[0].reversed_at, 'it is marked reversed, not removed');
  assert.equal(res.json.balance, 6000, 'the balance is exactly what it was');
});

test('the same payment cannot be undone twice', async () => {
  const cookie = await signInTeacher();
  const paid = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=payment.record',
    cookie,
    body: { student_id: KASUN, amount: 1000 },
  });
  await call(teacherApi, { method: 'POST', url: '/api/teacher?r=payment.reverse', cookie, body: { payment_id: paid.json.payment_id } });
  const again = await call(teacherApi, { method: 'POST', url: '/api/teacher?r=payment.reverse', cookie, body: { payment_id: paid.json.payment_id } });
  assert.equal(again.statusCode, 500);
  assert.match(again.json.error, /already/);
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
  assert.equal(res.json.receipt, '#0001');
  assert.equal(res.json.full, true);
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

  // 18:00 rather than 16:00: the fixture class already runs 16:00-17:30 on
  // those days, and point 13 now refuses an overlap.
  const made = await call(teacherApi, { method: 'POST', url: '/api/teacher?r=class.create', cookie, body: { subject: 'Maths', days: [0, 2], start_time: '18:00', duration_hours: 1.5, student_ids: [KASUN, AMAYA], grade: 11 } });
  assert.equal(made.statusCode, 200, made.bodyText);
  assert.equal(made.json.title, 'Grade 11 Maths small group', 'two students makes a small group');
  assert.equal(DB.class_students.filter((l) => l.class_id === made.json.class_id).length, 2);
});

/* ------------------------------- point 12: individual or group, and where */

test('an individual class cannot be saved with two students', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=class.create',
    cookie,
    body: { kind: 'individual', subject: 'Maths', days: [1], start_time: '18:00', duration_hours: 1, student_ids: [KASUN, AMAYA] },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json.error, /exactly one student/);
});

test('a group class cannot be saved with one student', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=class.create',
    cookie,
    body: { kind: 'group', venue_type: 'institute', venue_name: 'Bright Minds', area: 'Nugegoda', subject: 'Maths', days: [1], start_time: '18:00', duration_hours: 1, student_ids: [KASUN] },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json.error, /two or more students/);
});

test('a group class at an institute needs the institute name', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=class.create',
    cookie,
    body: { kind: 'group', venue_type: 'institute', area: 'Nugegoda', subject: 'Maths', days: [1], start_time: '18:00', duration_hours: 1, student_ids: [KASUN, AMAYA] },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json.error, /institute name/);
});

test('the kind and the venue are stored, not guessed', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=class.create',
    cookie,
    body: { kind: 'group', venue_type: 'institute', venue_name: 'Bright Minds Institute', area: 'Nugegoda', subject: 'Maths', days: [1], start_time: '18:00', duration_hours: 2, student_ids: [KASUN, AMAYA], grade: 11 },
  });
  assert.equal(res.statusCode, 200, res.bodyText);
  const made = DB.classes.find((c) => c.id === res.json.class_id);
  assert.equal(made.kind, 'group');
  assert.equal(made.venue_type, 'institute');
  assert.equal(made.venue_name, 'Bright Minds Institute');
  assert.equal(made.area, 'Nugegoda');
  assert.equal(made.place, 'Bright Minds Institute · Nugegoda', 'the readable venue line');
});

test('"my own place" takes the area from Settings without typing it', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=class.create',
    cookie,
    body: { kind: 'group', venue_type: 'own_place', subject: 'Maths', days: [1], start_time: '18:00', duration_hours: 1, student_ids: [KASUN, AMAYA] },
  });
  assert.equal(res.statusCode, 200, res.bodyText);
  const made = DB.classes.find((c) => c.id === res.json.class_id);
  assert.equal(made.venue_type, 'own_place');
  assert.equal(made.area, 'Nugegoda', 'from own_place_area');
  assert.equal(made.place, 'My home · Nugegoda');
});

/* --------------------------------------------- point 13: the clash check */

test('a class that overlaps another is refused, and names the one in the way', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=class.create',
    cookie,
    // the fixture class is Mon and Wed, 16:00 for 1.5 hours
    body: { kind: 'group', venue_type: 'own_place', subject: 'Science', days: [0], start_time: '16:30', duration_hours: 1, student_ids: [KASUN, AMAYA] },
  });
  assert.equal(res.statusCode, 409);
  assert.match(res.json.error, /Grade 11 Maths small group/);
  assert.equal(res.json.clash.start_time, '16:00');
});

test('a class that only touches another is allowed', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=class.create',
    cookie,
    // 17:30 is exactly when the fixture class ends: touching is not overlapping
    body: { kind: 'group', venue_type: 'own_place', subject: 'Science', days: [0], start_time: '17:30', duration_hours: 1, student_ids: [KASUN, AMAYA] },
  });
  assert.equal(res.statusCode, 200, res.bodyText);
});

test('"Save anyway" lets a deliberate overlap through', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=class.create',
    cookie,
    body: { kind: 'group', venue_type: 'own_place', subject: 'Science', days: [0], start_time: '16:30', duration_hours: 1, student_ids: [KASUN, AMAYA], allow_clash: true },
  });
  assert.equal(res.statusCode, 200, res.bodyText);
});

test('editing a class does not clash with itself', async () => {
  const cookie = await signInTeacher();
  const res = await call(teacherApi, {
    method: 'POST',
    url: '/api/teacher?r=class.update',
    cookie,
    body: { class_id: CLASS, start_time: '16:00', duration_hours: 2 },
  });
  assert.equal(res.statusCode, 200, res.bodyText);
  assert.equal(Number(DB.classes[0].duration_hours), 2);
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

/** Everything the four steps of point 8 ask for, as one valid submission. */
const goodSignup = (over = {}) => ({
  t: 'nimal',
  name: 'New Child',
  call_name: 'New',
  grade: 10,
  school: 'A School',
  curriculum: 'Cambridge',
  subjects: ['Maths'],
  ambition: 'Doctor',
  parent_name: 'A Parent',
  parent_occupation: 'Engineer',
  parent_phone: '0770000018',
  ...over,
});

test('a sign-up needs every answer the four steps ask for', async () => {
  reset();
  const cases = [
    [{ name: '' }, /student name/i],
    [{ parent_phone: '' }, /Sri Lankan mobile/i],
    [{ parent_phone: '12345' }, /Sri Lankan mobile/i],
    [{ grade: 0 }, /grade/i],
    [{ grade: 14 }, /grade/i],
    [{ parent_name: '' }, /parent/i],
    [{ subjects: [] }, /subject/i],
  ];
  for (const [over, expected] of cases) {
    const res = await call(joinApi, { method: 'POST', url: '/api/join?r=submit', body: goodSignup(over) });
    assert.equal(res.statusCode, 400, `${JSON.stringify(over)} should be refused`);
    assert.match(res.json.error, expected);
  }
});

test('point 3: the join form stores 947XXXXXXXX whatever shape arrives', async () => {
  for (const typed of ['0770000018', '+94 77 000 0018', '94770000018', '77 000 0018']) {
    reset();
    const res = await call(joinApi, {
      method: 'POST',
      url: '/api/join?r=submit',
      body: goodSignup({ parent_phone: typed, name: `Child ${typed}` }),
    });
    assert.equal(res.statusCode, 200, `${typed}: ${res.bodyText}`);
    const created = DB.students.find((x) => x.name === `Child ${typed}`);
    assert.equal(created.parent_phone, '94770000018', `${typed} should normalise`);
  }
});

test('point 8: the extra answers are kept, and the short name defaults', async () => {
  reset();
  const res = await call(joinApi, {
    method: 'POST',
    url: '/api/join?r=submit',
    body: goodSignup({ call_name: '', ambition: 'Pilot', parent_occupation: 'Nurse' }),
  });
  assert.equal(res.statusCode, 200, res.bodyText);
  const created = DB.students.find((x) => x.name === 'New Child');
  assert.equal(created.call_name, 'New', 'the first name is suggested when none was given');
  assert.equal(created.ambition, 'Pilot');
  assert.equal(created.parent_occupation, 'Nurse');
  assert.equal(created.grade, 10);
});

test('a sign-up creates a pending student with no fee and no code', async () => {
  reset();
  const res = await call(joinApi, {
    method: 'POST',
    url: '/api/join?r=submit',
    body: goodSignup({ subjects: ['Maths', 'Ballet'], parent_phone: '+94 77 000 0018' }),
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
  await call(joinApi, {
    method: 'POST',
    url: '/api/join?r=submit',
    body: goodSignup({ name: 'Another Child', curriculum: 'Edexcel' }),
  });
  assert.equal(DB.students.find((s) => s.name === 'Another Child').curriculum, 'Local');
});

test('a subject the teacher does not teach is dropped, and an empty list refused', async () => {
  reset();
  const res = await call(joinApi, {
    method: 'POST',
    url: '/api/join?r=submit',
    body: goodSignup({ name: 'Third Child', subjects: ['Ballet'] }),
  });
  assert.equal(res.statusCode, 400, 'nothing valid was left to study');
});

test('sign-ups from one address are capped', async () => {
  reset();
  for (let i = 0; i < 5; i += 1) {
    const res = await call(joinApi, {
      method: 'POST',
      url: '/api/join?r=submit',
      body: goodSignup({ name: `Child ${i}`, parent_phone: `9477000010${i}` }),
    });
    assert.equal(res.statusCode, 200, res.bodyText);
  }
  const res = await call(joinApi, {
    method: 'POST',
    url: '/api/join?r=submit',
    body: goodSignup({ name: 'One Too Many', parent_phone: '94770001099' }),
  });
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
