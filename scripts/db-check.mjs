/**
 * Check the database rules against the real PostgreSQL, through PostgREST.
 *
 *   npm run check:db
 *
 * db-verify.mjs does this over a direct Postgres connection inside a
 * transaction it rolls back; that needs DATABASE_URL and a network with a
 * route to the database. This one needs only the keys the app itself uses, so
 * it runs anywhere the app runs.
 *
 * It works on its own scratch teacher and deletes it at the end, so the real
 * data is never touched. Everything else hangs off that teacher row by
 * `on delete cascade`, which is also the last thing this checks.
 */

import * as db from '../api/_lib/db.js';
import { codeLookup, hashCode } from '../api/_lib/session.js';
import { addDays, today } from '../api/_lib/rules.js';

const TODAY = today();
const STAMP = Date.now();
const TZ = process.env.APP_TIMEZONE || 'Asia/Colombo';

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

async function raises(label, pattern, fn) {
  try {
    await fn();
    ok(label, false, '-> nothing was raised');
  } catch (err) {
    const message = err?.message || String(err);
    ok(label, pattern.test(message), pattern.test(message) ? '' : `-> raised: ${message}`);
  }
}

const section = (name) => console.log(`\n  ${name}\n  ${'-'.repeat(name.length)}`);

/* ------------------------------------------------------------- the stage -- */

let TID;
let A; // fee 1500
let B; // fee 1200
let CLASS;

async function build() {
  const code = `chk-${STAMP}`;
  const hashed = hashCode(code);
  const [teacher] = await db.insert('teachers', {
    name: `Check ${STAMP}`,
    title: 'Sir',
    join_key: `check-${STAMP}`,
    code_lookup: codeLookup(code),
    code_hash: hashed.hash,
    code_salt: hashed.salt,
  });
  TID = teacher.id;

  const students = await db.insert('students', [
    { teacher_id: TID, name: 'Alpha Aruna', grade: 11, fee_per_class: 1500, parent_phone: '94770000901', status: 'active' },
    { teacher_id: TID, name: 'Beta Bandara', grade: 11, fee_per_class: 1200, parent_phone: '94770000902', status: 'active' },
  ]);
  A = students.find((s) => s.name === 'Alpha Aruna').id;
  B = students.find((s) => s.name === 'Beta Bandara').id;

  const [cls] = await db.insert('classes', {
    teacher_id: TID,
    subject: 'Maths',
    grade: 11,
    title: 'Grade 11 Maths small group',
    place: 'Nugegoda',
    days: [0, 2],
    start_time: '16:00',
    duration_hours: 1.5,
    start_date: addDays(TODAY, -60),
  });
  CLASS = cls.id;
  await db.insert(
    'class_students',
    [
      { class_id: CLASS, student_id: A },
      { class_id: CLASS, student_id: B },
    ],
    { returning: 'minimal' },
  );
}

const dues = (id) => db.selectOne('student_dues', { student_id: `eq.${id}` });
const view = (id) => db.selectOne('v_students', { id: `eq.${id}` });
const clearMoney = async (id) => {
  await db.remove('charges', { student_id: `eq.${id}` });
  await db.remove('payments', { student_id: `eq.${id}` });
};

/* ---------------------------------------------------------------- checks -- */

async function checkStructure() {
  section('structure');
  for (const table of [
    'teachers', 'students', 'classes', 'class_students', 'class_exceptions', 'sessions',
    'attendance', 'charges', 'payments', 'marks', 'events', 'papers', 'paper_sales',
    'family_accounts', 'family_children', 'reschedule_requests', 'login_attempts',
  ]) {
    try {
      await db.select(table, { select: 'count', limit: 1 });
      ok(`table ${table}`, true);
    } catch (err) {
      ok(`table ${table}`, false, err.message);
    }
  }
  for (const v of [
    'student_dues', 'student_history', 'student_attendance_totals',
    'student_marks_summary', 'v_students', 'teacher_months',
  ]) {
    try {
      await db.select(v, { select: '*', limit: 1 });
      ok(`view ${v}`, true);
    } catch (err) {
      ok(`view ${v}`, false, err.message);
    }
  }
  await raises('finish_class exists and guards the teacher', /class not found/, () =>
    db.rpc('finish_class', { p_teacher: A, p_class: CLASS, p_date: TODAY, p_absent: [] }),
  );
  await raises('record_payment exists and guards the teacher', /student not found/, () =>
    db.rpc('record_payment', { p_teacher: A, p_student: A, p_classes: 1, p_amount: null, p_method: 'Cash' }),
  );
}

async function checkDues() {
  section('amount owed = charges - payments, oldest charge paid first');
  await clearMoney(A);
  await db.insert(
    'charges',
    [
      { teacher_id: TID, student_id: A, amount: 1500, charge_date: addDays(TODAY, -28) },
      { teacher_id: TID, student_id: A, amount: 1500, charge_date: addDays(TODAY, -21) },
      { teacher_id: TID, student_id: A, amount: 1500, charge_date: addDays(TODAY, -14) },
      { teacher_id: TID, student_id: A, amount: 1500, charge_date: addDays(TODAY, -7) },
    ],
    { returning: 'minimal' },
  );
  let d = await dues(A);
  equal('4 classes at 1,500 charge 6,000', d.charged_total, 6000);
  equal('all 4 are pending', d.pending_classes, 4);
  equal('6,000 is owed', d.amount_due, 6000);
  equal('the oldest unpaid charge is the first', d.oldest_unpaid, addDays(TODAY, -28));

  await db.insert(
    'payments',
    { teacher_id: TID, student_id: A, amount: 3000, method: 'Bank transfer', paid_date: addDays(TODAY, -20) },
    { returning: 'minimal' },
  );
  d = await dues(A);
  equal('paying 3,000 leaves 3,000', d.amount_due, 3000);
  equal('two classes remain pending', d.pending_classes, 2);
  equal('the oldest unpaid is now the third charge', d.oldest_unpaid, addDays(TODAY, -14));

  const v = await view(A);
  equal('v_students agrees on the amount', v.amount_due, 3000);
  equal('days late is counted from that charge', v.days_late, 14);
  ok(`days late uses the ${TZ} day`, Number(v.days_late) === 14);
}

async function checkNoCharges() {
  section('a student with no money history still appears');
  await clearMoney(B);
  const v = await view(B);
  ok('the student is listed', Boolean(v));
  equal('nothing owed', v.amount_due, 0);
  equal('no pending classes', v.pending_classes, 0);
  equal('not late', v.days_late, 0);
  equal('no attendance history', v.hist, '');
  equal('no marks', v.mark_count, 0);
  equal('oldest_unpaid is empty', v.oldest_unpaid, null);
}

async function checkFinishClass() {
  section('finish_class: attendance, and a charge only for those present');
  await clearMoney(A);
  await clearMoney(B);
  await db.remove('sessions', { class_id: `eq.${CLASS}` });

  const date = addDays(TODAY, -1);
  const sessionId = await db.rpc('finish_class', {
    p_teacher: TID,
    p_class: CLASS,
    p_date: date,
    p_absent: [A],
  });
  ok('it returns the session id', typeof sessionId === 'string' && sessionId.length > 10);

  const session = await db.selectOne('sessions', { id: `eq.${sessionId}` });
  equal('the session is done', session.status, 'done');
  ok('and time-stamped', Boolean(session.done_at));

  const attendance = await db.select('attendance', { session_id: `eq.${sessionId}`, order: 'present.asc' });
  equal('one attendance row per enrolled student', attendance.length, 2);
  equal('the absent student is marked absent', attendance[0].student_id, A);
  equal('present = false for them', attendance[0].present, false);
  equal('the other was present', attendance[1].present, true);

  const charges = await db.select('charges', { session_id: `eq.${sessionId}` });
  equal('only one charge was raised', charges.length, 1);
  equal('for the student who turned up', charges[0].student_id, B);
  equal("at that student's own fee", charges[0].amount, 1200);

  equal('the absent student owes nothing for it', (await dues(A))?.amount_due ?? 0, 0);

  section('finish_class can be re-run without doubling the money');
  await db.rpc('finish_class', { p_teacher: TID, p_class: CLASS, p_date: date, p_absent: [] });
  const again = await db.select('sessions', { class_id: `eq.${CLASS}`, session_date: `eq.${date}` });
  equal('still one session for that date', again.length, 1);
  const after = await db.select('charges', { session_id: `eq.${again[0].id}` });
  equal('two charges, not four', after.length, 2);
  equal('totalling 1,500 + 1,200', after.reduce((a, c) => a + Number(c.amount), 0), 2700);

  await raises("it refuses another teacher's class", /class not found/, () =>
    db.rpc('finish_class', { p_teacher: A, p_class: CLASS, p_date: addDays(TODAY, -3), p_absent: [] }),
  );
}

async function checkPayment() {
  section('record_payment');
  await clearMoney(A);
  await db.insert(
    'charges',
    [
      { teacher_id: TID, student_id: A, amount: 1500, charge_date: addDays(TODAY, -28) },
      { teacher_id: TID, student_id: A, amount: 1500, charge_date: addDays(TODAY, -21) },
      { teacher_id: TID, student_id: A, amount: 800, charge_date: addDays(TODAY, -14) },
    ],
    { returning: 'minimal' },
  );

  const two = await db.rpc('record_payment', {
    p_teacher: TID, p_student: A, p_classes: 2, p_amount: null, p_method: 'Cash',
  });
  equal('2 classes pays the two oldest charges', two, 3000);

  const rest = await db.rpc('record_payment', {
    p_teacher: TID, p_student: A, p_classes: 99, p_amount: null, p_method: 'Cash',
  });
  equal('asking for more classes than exist pays what is left', rest, 800);
  equal('nothing is owed now', (await dues(A)).amount_due, 0);

  await raises('paying again is refused', /nothing is owed/, () =>
    db.rpc('record_payment', { p_teacher: TID, p_student: A, p_classes: 1, p_amount: null, p_method: 'Cash' }),
  );

  await clearMoney(A);
  await db.insert(
    'charges',
    { teacher_id: TID, student_id: A, amount: 1000, charge_date: addDays(TODAY, -5) },
    { returning: 'minimal' },
  );
  const over = await db.rpc('record_payment', {
    p_teacher: TID, p_student: A, p_classes: null, p_amount: 999999, p_method: 'Cash',
  });
  equal('an over-payment is clipped to the balance', over, 1000);

  await raises("it refuses another teacher's student", /student not found/, () =>
    db.rpc('record_payment', { p_teacher: A, p_student: A, p_classes: 1, p_amount: null, p_method: 'Cash' }),
  );

  section('clearing the balance clears the slip and the reminder note');
  await db.update(
    'students',
    { slip_path: 'slips/x.jpg', slip_sent_at: new Date().toISOString(), last_reminded_at: new Date().toISOString() },
    { id: `eq.${A}` },
  );
  await clearMoney(A);
  await db.insert(
    'charges',
    { teacher_id: TID, student_id: A, amount: 1500, charge_date: addDays(TODAY, -3) },
    { returning: 'minimal' },
  );
  await db.rpc('record_payment', { p_teacher: TID, p_student: A, p_classes: null, p_amount: null, p_method: 'Slip' });
  const student = await db.selectOne('students', { id: `eq.${A}`, select: 'slip_path,slip_sent_at,last_reminded_at' });
  equal('the slip path is cleared', student.slip_path, null);
  equal('and its timestamp', student.slip_sent_at, null);
  equal('and the reminder note', student.last_reminded_at, null);
}

async function checkHistory() {
  section('the attendance window is the last 8 marked classes, oldest first');
  await db.remove('sessions', { class_id: `eq.${CLASS}` });

  const rows = [];
  for (let i = 1; i <= 10; i += 1) rows.push({ class_id: CLASS, teacher_id: TID, session_date: addDays(TODAY, -40 + i), status: 'done' });
  const created = await db.insert('sessions', rows);
  created.sort((x, y) => x.session_date.localeCompare(y.session_date));

  // Present every time except the 2nd and the 9th.
  await db.insert(
    'attendance',
    created.map((s, i) => ({ session_id: s.id, student_id: A, present: !(i === 1 || i === 8) })),
    { returning: 'minimal' },
  );

  const history = await db.selectOne('student_history', { student_id: `eq.${A}` });
  equal('exactly eight results', history.hist.length, 8);
  equal('oldest first, the 2nd absence has aged out', history.hist, 'PPPPPPAP');

  const totals = await db.selectOne('student_attendance_totals', { student_id: `eq.${A}` });
  equal('lifetime counts all ten', totals.total_classes, 10);
  equal('eight attended', totals.present_classes, 8);
  equal('v_students carries the same window', (await view(A)).hist, history.hist);

  section('a class that was never marked is not in the history');
  await db.insert(
    'sessions',
    { class_id: CLASS, teacher_id: TID, session_date: addDays(TODAY, 2), status: 'planned', notified_at: new Date().toISOString() },
    { returning: 'minimal' },
  );
  equal('the planned class adds nothing', (await db.selectOne('student_history', { student_id: `eq.${A}` })).hist.length, 8);
}

async function checkMarks() {
  section('marks are a percentage of each test’s own maximum');
  await db.remove('marks', { student_id: `eq.${A}` });
  await db.insert(
    'marks',
    [
      { teacher_id: TID, student_id: A, title: 'Term test 1', score: 54, max_score: 100, taken_on: addDays(TODAY, -50) },
      { teacher_id: TID, student_id: A, title: 'Term test 2', score: 34, max_score: 50, taken_on: addDays(TODAY, -30) },
      { teacher_id: TID, student_id: A, title: 'Model paper', score: 72, max_score: 100, taken_on: addDays(TODAY, -10) },
    ],
    { returning: 'minimal' },
  );
  const m = await db.selectOne('student_marks_summary', { student_id: `eq.${A}` });
  equal('three marks', m.mark_count, 3);
  equal('the first is 54 %', m.first_pct, 54);
  equal('the latest is 72 %', m.latest_pct, 72);
  equal('the best is 72 %', m.best_pct, 72);
  equal('34/50 counts as 68 %, so the average is 65 %', m.avg_pct, 65);

  await raises('a score above the maximum is refused', /max_score|violates|check/i, () =>
    db.insert('marks', { teacher_id: TID, student_id: A, title: 'Bad', score: 10, max_score: 0 }),
  );
}

async function checkMonths() {
  section('the monthly totals come from the ledger');
  // teacher_months sums every student, so clear both before measuring.
  await clearMoney(A);
  await clearMoney(B);
  const thisMonth = `${TODAY.slice(0, 7)}-01`;
  await db.insert(
    'charges',
    { teacher_id: TID, student_id: A, amount: 5000, charge_date: thisMonth },
    { returning: 'minimal' },
  );
  await db.insert(
    'payments',
    { teacher_id: TID, student_id: A, amount: 2000, method: 'Cash', paid_date: thisMonth },
    { returning: 'minimal' },
  );
  const months = await db.select('teacher_months', { teacher_id: `eq.${TID}`, order: 'month.asc' });
  const current = months.find((m) => m.month === TODAY.slice(0, 7));
  ok('this month is reported', Boolean(current));
  equal('charged 5,000', current.charged, 5000);
  equal('collected 2,000', current.collected, 2000);
}

async function checkConstraints() {
  section('the constraints that protect the data');
  const [session] = await db.insert('sessions', {
    class_id: CLASS, teacher_id: TID, session_date: addDays(TODAY, -9), status: 'done',
  });
  await db.insert(
    'charges',
    { teacher_id: TID, student_id: A, session_id: session.id, amount: 1500, charge_date: addDays(TODAY, -9) },
    { returning: 'minimal' },
  );
  await raises('one class cannot be charged to a student twice', /duplicate|unique/i, () =>
    db.insert('charges', {
      teacher_id: TID, student_id: A, session_id: session.id, amount: 1500, charge_date: addDays(TODAY, -9),
    }),
  );

  // Guards against a class that would never appear on any calendar. Note the
  // empty-array case: array_length('{}', 1) is NULL, so the check needs a
  // coalesce or it silently passes.
  await raises('a class with no days and no date is refused', /classes_repeat_ck|violates/i, () =>
    db.insert('classes', {
      teacher_id: TID, subject: 'Maths', grade: 11, title: 'Nowhere', days: [], start_time: '16:00',
    }),
  );
  await raises('a class with null days and no date is refused', /classes_repeat_ck|violates|null/i, () =>
    db.insert('classes', {
      teacher_id: TID, subject: 'Maths', grade: 11, title: 'Nowhere', days: null, start_time: '16:00',
    }),
  );
  const single = await db.insert('classes', {
    teacher_id: TID, subject: 'Maths', grade: 11, title: 'One off', days: [],
    start_time: '16:00', once_date: addDays(TODAY, 5),
  });
  ok('but a one-off class with no weekdays is allowed', single.length === 1);

  await raises('an unknown event type is refused', /events_type_check|violates/i, () =>
    db.insert('events', { teacher_id: TID, student_id: A, type: 'nonsense', text: 'x' }),
  );

  await raises('an unknown payment method is refused', /payments_method_check|violates/i, () =>
    db.insert('payments', { teacher_id: TID, student_id: A, amount: 100, method: 'Crypto' }),
  );

  await raises('a reminder window outside 7/14/30 is refused', /remind_after_days|violates/i, () =>
    db.update('teachers', { remind_after_days: 3 }, { id: `eq.${TID}` }),
  );

  await raises('two teachers cannot share a join key', /duplicate|unique/i, () =>
    db.insert('teachers', { name: 'Clash', join_key: `check-${STAMP}` }),
  );

  await raises('two accounts cannot share a code', /duplicate|unique/i, async () => {
    const h = hashCode('998877');
    await db.insert('family_accounts', {
      teacher_id: TID, code_lookup: codeLookup('998877'), code_hash: h.hash, code_salt: h.salt,
    });
    const h2 = hashCode('998877');
    await db.insert('family_accounts', {
      teacher_id: TID, code_lookup: codeLookup('998877'), code_hash: h2.hash, code_salt: h2.salt,
    });
  });
}

async function checkCascade() {
  section('deleting a teacher takes their data with them');
  await db.remove('teachers', { id: `eq.${TID}` });
  for (const table of ['students', 'classes', 'charges', 'payments', 'marks', 'events', 'papers', 'family_accounts']) {
    const rows = await db.select(table, { select: 'id', teacher_id: `eq.${TID}`, limit: 1 });
    equal(`${table} cascaded`, rows.length, 0);
  }
  const sessions = await db.select('sessions', { select: 'id', class_id: `eq.${CLASS}`, limit: 1 });
  equal('sessions cascaded', sessions.length, 0);
  TID = null;
}

/* ------------------------------------------------------------------- run -- */

async function main() {
  if (!db.configured) {
    console.error('\nSUPABASE_URL and SUPABASE_SERVICE_KEY must be set.\n');
    process.exit(1);
  }
  console.log(`\nDATABASE CHECK   ${process.env.SUPABASE_URL}`);
  console.log(`today ${TODAY} (${TZ}), scratch teacher check-${STAMP}`);

  await build();
  try {
    await checkStructure();
    await checkDues();
    await checkNoCharges();
    await checkFinishClass();
    await checkPayment();
    await checkHistory();
    await checkMarks();
    await checkMonths();
    await checkConstraints();
    await checkCascade();
  } finally {
    if (TID) {
      await db.remove('teachers', { id: `eq.${TID}` }).catch(() => {});
      console.log('\n  (scratch teacher removed)');
    }
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) console.log(`  failures:\n${failures.map((f) => `    - ${f}`).join('\n')}`);
  console.log('');
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(`\nThe check could not finish: ${err.message}`);
  if (err.detail) console.error(JSON.stringify(err.detail));
  if (TID) await db.remove('teachers', { id: `eq.${TID}` }).catch(() => {});
  process.exit(1);
});
