/**
 * The teacher's app, driven end to end.
 *
 * This boots the real main.js against a small DOM and a stubbed /api, signs
 * in on the lock screen, then walks the journeys the improvement plan asks
 * for: the Google-style calendar (point 9), starting and ending a class with
 * the absent message (point 10), and recording a part payment with a receipt
 * and Undo (point 11).
 *
 * Unlike the render tests, nothing here calls a screen function directly.
 * Every step is a tap, so the action table, the state changes and the redraw
 * are all exercised the way they are on a phone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installFetch } from './dom.js';

/* Timers must not hold the test runner open after the last assertion. */
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn, ms) => {
  const handle = realSetInterval(fn, ms);
  handle?.unref?.();
  return handle;
};

const dom = installDom();
dom.seed('scr', 'nav', 'over', 'sheet', 'toast');
globalThis.location = { href: 'https://plus.test/', pathname: '/', protocol: 'http:' };

/* ------------------------------------------------------------ fixtures -- */

const TODAY = '2026-03-18'; // a Wednesday
const TID = 't1';
const KASUN = 's1';
const AMAYA = 's2';
const CLASS = 'c1';

const TEACHER = {
  id: TID,
  name: 'Nimal',
  title: 'Sir',
  subjects: ['Maths', 'Science', 'English'],
  curricula: ['Local', 'Cambridge'],
  lang: 'en',
  theme: 'night',
  auto_reminders: true,
  remind_after_days: 14,
  join_key: 'nimal',
  own_place_name: 'My home',
  own_place_area: 'Nugegoda',
};

const student = (over) => ({
  id: KASUN,
  name: 'Kasun Perera',
  call_name: 'Kasun',
  grade: 11,
  school: 'Royal College',
  area: 'Nugegoda',
  curriculum: 'Local',
  subject: 'Maths',
  wanted_subjects: ['Maths'],
  fee_per_class: 1500,
  parent_name: 'Nadeesha Perera',
  parent_phone: '94771234567',
  status: 'active',
  slip_sent_at: null,
  last_reminded_at: null,
  amount_due: 6000,
  pending_classes: 4,
  oldest_unpaid: '2026-02-14',
  paid_total: 0,
  days_late: 32,
  hist: 'PPAPPAPA',
  total_classes: 8,
  present_classes: 6,
  mark_count: 0,
  avg_pct: null,
  best_pct: null,
  first_pct: null,
  latest_pct: null,
  ...over,
});

let db;
function resetDb() {
  db = {
    sessions: [],
    payments: [],
    students: [
      student({ id: KASUN }),
      student({
        id: AMAYA,
        name: 'Amaya Jayasinghe',
        call_name: 'Amaya',
        fee_per_class: 1200,
        amount_due: 0,
        pending_classes: 0,
        days_late: 0,
        hist: 'PPPPPPPP',
      }),
    ],
  };
}
resetDb();

const bootstrap = () => ({
  today: TODAY,
  window: { from: '2025-09-01', to: '2026-06-01' },
  teacher: TEACHER,
  students: db.students,
  classes: [
    {
      id: CLASS,
      subject: 'Maths',
      curriculum: 'Local',
      grade: 11,
      title: 'Grade 11 Maths',
      kind: 'group',
      venue_type: 'institute',
      venue_name: 'Bright Minds Institute',
      area: 'Nugegoda',
      place: 'Bright Minds Institute · Nugegoda',
      days: [0, 2], // Monday and Wednesday
      start_time: '16:00:00',
      duration_hours: 2.5,
      start_date: '2026-01-05',
      once_date: null,
      active: true,
      student_ids: [KASUN, AMAYA],
      skips: [],
    },
  ],
  sessions: db.sessions,
  payments: db.payments,
  events: [],
  months: [{ month: '2026-03', collected: 0, charged: 6000 }],
  reschedules: [],
  marks: [],
  papers: [],
  whatsapp_server: false,
});

let lastFinish = null;

installFetch({
  'GET /api/auth?r=config': { configured: true, code_length: 4, demo_hint: false },
  'GET /api/auth?r=me': {},
  'POST /api/auth?r=login': (body) =>
    body.code === '1234'
      ? { role: 'teacher', teacher: TEACHER }
      : { __status: 401, body: { error: 'That code did not work' } },
  'GET /api/teacher?r=bootstrap': () => bootstrap(),

  'POST /api/teacher?r=attendance.start': (body) => {
    const started = '2026-03-18T10:32:00.000Z';
    db.sessions.push({
      id: 'z1',
      class_id: body.class_id,
      date: body.date,
      status: 'planned',
      started_at: started,
      ended_at: null,
      absent: [],
      present: [],
    });
    return { started_at: started, class_id: body.class_id, date: body.date };
  },

  'POST /api/teacher?r=attendance.finish': (body) => {
    lastFinish = body;
    const session = db.sessions.find((x) => x.class_id === body.class_id) || {};
    session.status = 'done';
    session.ended_at = '2026-03-18T13:01:00.000Z';
    session.absent = body.absent;
    return {
      saved: true,
      session_id: 'z1',
      started_at: session.started_at,
      ended_at: session.ended_at,
      taught_minutes: 149,
      absent: body.absent.length,
      present: 2 - body.absent.length,
      messages: body.absent.map((id) => ({
        student_id: id,
        name: db.students.find((s) => s.id === id)?.name,
        text: "Hi, this is Nimal Sir. Kasun Perera was absent from today's Grade 11 Maths (4:00 PM). Please let me know if there is a problem. Thank you.",
        status: 'sent',
        link: null,
      })),
    };
  },

  'POST /api/teacher?r=payment.record': (body) => {
    const target = db.students.find((s) => s.id === body.student_id);
    const due = Number(target.amount_due);
    const amount = Math.min(Number(body.amount), due);
    target.amount_due = due - amount;
    const row = {
      id: 'pay1',
      student_id: body.student_id,
      amount,
      method: body.method,
      paid_date: body.paid_date,
      receipt_no: 12,
      reversed_at: null,
    };
    db.payments.push(row);
    return {
      payment_id: row.id,
      amount,
      balance: due - amount,
      full: amount >= due,
      receipt: '#0012',
      receipt_no: 12,
      status: body.send_receipt === false ? 'none' : 'sent',
      link: null,
    };
  },

  'POST /api/teacher?r=payment.reverse': (body) => {
    const row = db.payments.find((p) => p.id === body.payment_id);
    row.reversed_at = '2026-03-18T13:10:00.000Z';
    const target = db.students.find((s) => s.id === row.student_id);
    target.amount_due = Number(target.amount_due) + Number(row.amount);
    return { reversed: true, amount: row.amount, balance: target.amount_due };
  },
});

await import('../app/main.js');
const screen = () => dom.get('scr').innerHTML;
const sheet = () => dom.get('sheet').innerHTML;
const toast = () => dom.get('toast').textContent;
await new Promise((r) => setTimeout(r, 20));

/* =================================================== point 5 · signing in */

test('the app opens on the role picker', () => {
  const html = screen();
  assert.match(html, /Who are you\?/);
  assert.match(html, /data-a="login\.role" data-i="teacher"/);
});

test('point 5: choosing a role gives the full-screen lock keypad', async () => {
  await dom.click('login.role', 'teacher');
  const html = screen();
  assert.match(html, /class="lock"/);
  assert.match(html, /class="lock-role">Teacher</);
  assert.match(html, /Enter your code/);
  assert.match(html, /class="pad"/);
  assert.match(html, /PQRS/, 'the letters are under the digits');
  assert.match(html, /Forgot code\?/);
  assert.match(html, /data-a="login\.unrole"/, 'Cancel');
  assert.doesNotMatch(html, /class="card/, 'nothing else is on the screen');
  assert.equal(dom.get('nav').innerHTML, '', 'no tab bar while signing in');
});

test('point 5: the dots fill as digits are pressed', async () => {
  await dom.click('login.key', '1');
  assert.match(screen(), /<i class="f"><\/i><i class=""><\/i><i class=""><\/i><i class=""><\/i>/);
  await dom.click('login.key', '2');
  assert.equal((screen().match(/class="f"/g) || []).length, 2);
});

test('point 5: a wrong code shakes the dots and clears them', async () => {
  await dom.click('login.key', '9');
  await dom.click('login.key', '9'); // 1299 is wrong, and the fourth digit checks
  const html = screen();
  assert.match(html, /class="pin shake"/);
  assert.equal((html.match(/class="f"/g) || []).length, 0, 'the dots are cleared');
  assert.equal(toast(), 'That code did not work');
});

test('point 5: the right code signs in, with no Enter button', async () => {
  for (const key of ['1', '2', '3', '4']) await dom.click('login.key', key);
  await new Promise((r) => setTimeout(r, 10));
  const html = screen();
  assert.doesNotMatch(html, /class="lock"/, 'the lock screen is gone');
  assert.match(html, /Hi, Nimal/);
  assert.match(dom.get('nav').innerHTML, /data-a="nav\.tab" data-i="today"/);
});

/* ================================================= point 9 · the calendar */

test("Today shows the day's classes and the money still to collect", () => {
  const html = screen();
  assert.match(html, /Grade 11 Maths/);
  assert.match(html, /LKR 6,000/);
});

test('point 9: the calendar has Day, Week, Month and a "+" button', async () => {
  await dom.click('nav.tab', 'classes');
  const html = screen();
  assert.match(html, /data-a="cal\.mode" data-i="day"/);
  assert.match(html, /data-a="cal\.mode" data-i="week"/);
  assert.match(html, /data-a="cal\.mode" data-i="month"/);
  assert.match(html, /data-a="cal\.jump"/, 'the title opens a picker');
  assert.match(dom.get('over').innerHTML, /class="fab"/, 'the "+" floats over the frame');
});

test('point 9: an empty hour on the day grid is tappable', () => {
  const html = screen();
  assert.match(html, /data-a="class\.quick" data-i="2026-03-18\|09:00"/);
  assert.match(html, /class="blk"/, 'and the class itself is drawn on top');
});

test('point 9: the month view lists the chosen day underneath, as Google does', async () => {
  await dom.click('cal.mode', 'month');
  const html = screen();
  assert.match(html, /class="mon"/, 'the grid');
  assert.match(html, /Wednesday 18 Mar/, 'the agenda heading for the chosen day');
  assert.match(html, /class="agenda-c/, 'the class as an agenda row');
  assert.match(html, /4:00 PM/, 'with the time beside it');
  assert.match(html, /Bright Minds Institute · Nugegoda/, 'point 12: the venue as entered');
});

test('point 9: tapping another day moves the agenda to it', async () => {
  await dom.click('cal.pick', '2026-03-16'); // the Monday
  const html = screen();
  assert.match(html, /Monday 16 Mar/);
  assert.match(html, /class="agenda-c/, 'the Monday class');

  await dom.click('cal.pick', '2026-03-17'); // a Tuesday, with nothing on
  assert.match(screen(), /Nothing on this day/);
});

test('point 9: quick-create opens the class sheet set to that slot', async () => {
  await dom.click('class.quick', '2026-03-20|14:00');
  const html = sheet();
  assert.match(html, /New class/);
  assert.match(html, /2:00 PM – 3:30 PM/, 'the tapped time is already filled in');
  assert.match(html, /data-a="class\.kind" data-i="individual"/);
  assert.match(html, /data-a="class\.kind" data-i="group"/);
  await dom.click('sheet.close');
});

/* ======================================== point 12 and 13 · the new class */

test('point 12: an individual class asks for an area, a group asks where', async () => {
  await dom.click('class.add');
  assert.match(sheet(), /Location \/ area/, 'individual, by default');
  assert.match(sheet(), /Filled from the student/);
  assert.doesNotMatch(sheet(), /Where is the class\?/);

  await dom.click('class.kind', 'group');
  const html = sheet();
  assert.match(html, /Where is the class\?/);
  assert.match(html, /data-a="class\.venue" data-i="institute"/);
  assert.match(html, /data-a="class\.venue" data-i="own_place"/);
  assert.match(html, /Institute name/, 'institute is the first offer');
});

test('point 12: "my own place" needs no typing', async () => {
  await dom.click('class.venue', 'own_place');
  const html = sheet();
  assert.match(html, /🏠 My home · Nugegoda/);
  assert.match(html, /Saved once under Settings/);
  assert.doesNotMatch(html, /id="c-venue"/, 'no institute name to type');
});

test('point 13: the time sheet has start chips, length chips and the result', async () => {
  await dom.click('time.open');
  const html = sheet();
  assert.match(html, /Choose time/);
  assert.match(html, /data-a="time\.start" data-i="16:00"/);
  assert.match(html, /data-a="time\.dur" data-i="2.5"/);
  assert.match(html, /Class runs/);
  assert.match(html, /Custom/);
});

test('point 13: picking 4:00 PM and 2.5 h shows 4:00 PM – 6:30 PM', async () => {
  await dom.click('time.start', '16:00');
  await dom.click('time.dur', '2.5');
  const html = sheet();
  assert.match(html, /4:00 PM – 6:30 PM/);
  assert.match(html, /2 h 30 m/);
});

test('point 13: an overlap is named, with Save anyway offered', async () => {
  await dom.click('time.done');
  // Monday and Wednesday, so it lands on the existing 4:00-6:30 class.
  await dom.click('class.day', '0');
  await dom.click('time.open');
  const html = sheet();
  assert.match(html, /⚠ Clash: overlaps Grade 11 Maths/);
  assert.match(html, /on Monday/);
  assert.match(html, /Save anyway\?/);
});

test('point 13: moving off the clash clears the warning', async () => {
  await dom.click('time.start', '19:00');
  const html = sheet();
  assert.doesNotMatch(html, /⚠ Clash/);
  assert.match(html, /7:00 PM – 9:30 PM/);
  await dom.click('time.done');
  await dom.click('sheet.close');
});

/* ================================== point 10 · start, end, absent message */

test('point 10: a class that has not begun offers only Start class', async () => {
  await dom.click('attend.open', `${CLASS}|${TODAY}`);
  const html = screen();
  assert.match(html, /Not started/);
  assert.match(html, /00:00:00/);
  assert.match(html, /▶ Start class/);
  assert.doesNotMatch(html, /End class/);
});

test('point 10: Start class runs the clock and shows the roll', async () => {
  await dom.click('attend.start');
  const html = screen();
  assert.match(html, /In progress/);
  assert.match(html, /data-since="2026-03-18T10:32:00.000Z"/);
  assert.match(html, /Tap a student who is absent/);
  assert.equal((html.match(/>Present</g) || []).length, 2, 'everyone starts present');
  assert.match(html, /■ End class/);
  assert.equal(toast(), 'Class started');
});

test('point 10: tapping a student marks them absent and warns about the message', async () => {
  await dom.click('attend.toggle', KASUN);
  const html = screen();
  assert.match(html, />Absent</);
  assert.match(html, /1 absent/);
  assert.match(html, /message will be sent to Kasun&#39;s parent when you end the class/);
  assert.match(html, /Send now/);

  // And tapping again puts them back.
  await dom.click('attend.toggle', KASUN);
  assert.doesNotMatch(screen(), />Absent</);
  await dom.click('attend.toggle', KASUN);
});

test('point 10: End class saves the real times and shows what was sent', async () => {
  await dom.click('attend.finish');

  assert.deepEqual(lastFinish.absent, [KASUN]);
  assert.equal(lastFinish.started_at, '2026-03-18T10:32:00.000Z', 'the real start, not the scheduled one');
  assert.ok(lastFinish.ended_at, 'and a real end');
  assert.deepEqual(lastFinish.already_notified, [], 'nobody was told early');

  const html = screen();
  assert.match(html, /Class ended/);
  assert.match(html, /2 h 29 m/, 'the length actually taught');
  assert.match(html, /was absent from today/, 'the exact text the parent got');
  assert.match(html, /Resend/);
  assert.match(html, /Edit text/);
  assert.match(html, /Start \/ end time wrong\?/);
  assert.match(toast(), /Class saved/);
});

/* ============================================ point 11 · fees and receipts */

test('point 11: the Paid button opens the record payment sheet', async () => {
  await dom.click('attend.close');
  await dom.click('nav.tab', 'fees');
  assert.match(screen(), /Who needs to pay/);

  await dom.click('fees.pay', KASUN);
  const html = sheet();
  assert.match(html, /Record payment/);
  assert.match(html, /Kasun Perera owes 4 classes × LKR 1,500/);
  assert.match(html, /Full LKR 6,000/);
  assert.match(html, /Part payment/);
  assert.match(html, /data-a="fees\.method" data-i="Cash"/);
  assert.match(html, /data-a="fees\.method" data-i="Online"/);
  assert.match(html, /Send a receipt to the parent/);
  assert.match(html, /Confirm payment · LKR 6,000/);
});

test('point 11: choosing Part payment asks for the amount', async () => {
  await dom.click('fees.mode', 'part');
  const html = sheet();
  assert.match(html, /id="p-amount"/);
  assert.match(html, /aria-disabled="true"/, 'nothing typed yet, so nothing to confirm');
});

test('point 11: a part payment of 2,000 on 6,000 leaves 4,000 and a receipt', async () => {
  dom.type('p-amount', '2000');
  dom.type('p-date', TODAY);
  await dom.click('fees.method', 'Cash');
  assert.match(sheet(), /Confirm payment · LKR 2,000/, 'the button names the exact amount');

  await dom.click('fees.savepay', KASUN);
  const html = sheet();
  assert.match(html, /Payment recorded/);
  assert.match(html, /Still to pay: LKR 4,000/);
  assert.match(html, /#0012/);
  assert.match(html, /LKR 2,000/);
  assert.match(html, /Receipt sent to the parent/);
  assert.match(html, /Undo \(10s\)/);
  assert.equal(db.students[0].amount_due, 4000);
});

test('point 11: Undo puts the balance back exactly', async () => {
  await dom.click('fees.undo', 'pay1');
  assert.equal(db.students[0].amount_due, 6000, 'the exact previous balance');
  assert.equal(db.payments[0].reversed_at !== null, true, 'the row is reversed, not deleted');
  assert.equal(toast(), 'Payment undone');
  assert.equal(sheet(), '', 'the sheet is closed');
});

test('point 11: the payment history keeps the reversed receipt on the record', async () => {
  await dom.click('student.open', KASUN);
  const html = screen();
  assert.match(html, /Payments/);
  assert.match(html, /#0012/);
  assert.match(html, /reversed/);
});

/* ================================================= points 2 and 7 · taps  */

test('points 2 and 7: a second tap while a save is running is dropped', async () => {
  let inFlight = 0;
  let peak = 0;
  const previous = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 30));
    try {
      return await previous(...args);
    } finally {
      inFlight -= 1;
    }
  };

  await dom.click('back');
  await dom.click('fees.pay', AMAYA);
  // AMAYA owes nothing, so use Kasun, who does.
  await dom.click('sheet.close');
  await dom.click('nav.tab', 'fees');
  await dom.click('fees.pay', KASUN);
  dom.type('p-amount', '1000');
  await dom.click('fees.mode', 'part');
  dom.type('p-amount', '1000');

  // Two taps in the same tick, as a double tap on a slow phone would be.
  const first = dom.click('fees.savepay', KASUN);
  const second = dom.click('fees.savepay', KASUN);
  await Promise.all([first, second]);
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(peak, 1, 'never two payments in flight at once');
  assert.equal(
    db.payments.filter((p) => !p.reversed_at).length,
    1,
    'point 2: double tapping never creates two payments',
  );
  globalThis.fetch = previous;
});
