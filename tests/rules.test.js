/**
 * The test checklist of section 11, as runnable tests:  npm test
 *
 * These cover the rules that decide money and attendance - the parts where a
 * quiet mistake would be expensive. They need no database and no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import * as SR from '../api/_lib/rules.js';
import { render } from '../api/_lib/templates.js';
import { hashCode, verifyCode, codeLookup, randomCode } from '../api/_lib/session.js';
import * as CR from '../app/rules.js';

/* --------------------------------------------------------------- helpers -- */

const cls = (over = {}) => ({
  id: 'c1',
  subject: 'Maths',
  curriculum: 'Local',
  title: 'Grade 11 Maths',
  place: 'Nugegoda',
  days: [0, 2], // Monday, Wednesday
  start_time: '16:00',
  duration_hours: 1.5,
  start_date: '2026-01-05', // a Monday
  once_date: null,
  active: true,
  student_ids: ['s1', 's2'],
  skips: [],
  ...over,
});

const data = (over = {}) => ({
  classes: [cls()],
  sessions: [],
  students: [
    { id: 's1', name: 'Kasun Perera', fee_per_class: 1500, hist: 'PPAPPAPA', avg_pct: 65, mark_count: 3 },
    { id: 's2', name: 'Amaya Jayasinghe', fee_per_class: 1200, hist: 'PPPPPPPA', avg_pct: 91, mark_count: 2 },
  ],
  ...over,
});

/* ========================================================= the calendar == */

test('a weekly class appears only on its own weekdays', () => {
  const skips = new Set();
  assert.equal(SR.meetsOn(cls(), '2026-01-05', skips), true, 'Monday');
  assert.equal(SR.meetsOn(cls(), '2026-01-07', skips), true, 'Wednesday');
  assert.equal(SR.meetsOn(cls(), '2026-01-06', skips), false, 'Tuesday');
  assert.equal(SR.meetsOn(cls(), '2026-01-11', skips), false, 'Sunday');
});

test('a weekly class does not appear before its start date', () => {
  assert.equal(SR.meetsOn(cls(), '2025-12-29', new Set()), false);
});

test('a one-time class appears once and only once', () => {
  const single = cls({ days: [], once_date: '2026-02-17' });
  assert.equal(SR.meetsOn(single, '2026-02-17', new Set()), true);
  assert.equal(SR.meetsOn(single, '2026-02-16', new Set()), false);
  assert.equal(SR.meetsOn(single, '2026-02-24', new Set()), false);
});

test('a cancelled day disappears but the other days stay', () => {
  const skips = new Set(['c1|2026-01-07']);
  assert.equal(SR.meetsOn(cls(), '2026-01-07', skips), false);
  assert.equal(SR.meetsOn(cls(), '2026-01-05', skips), true);
  assert.equal(SR.meetsOn(cls(), '2026-01-12', skips), true);
});

test('the week starts on Monday', () => {
  assert.equal(SR.weekday('2026-01-05'), 0, 'Monday is 0');
  assert.equal(SR.weekday('2026-01-11'), 6, 'Sunday is 6');
  assert.equal(SR.startOfWeek('2026-01-08'), '2026-01-05');
  assert.equal(CR.startOfWeek('2026-01-11'), '2026-01-05', 'Sunday belongs to the week before');
});

test('the month view grid also starts on Monday', () => {
  const first = CR.startOfMonth('2026-03-18');
  assert.equal(first, '2026-03-01');
  const gridStart = CR.addDays(first, -CR.weekday(first));
  assert.equal(CR.weekday(gridStart), 0);
  assert.ok(gridStart <= first);
});

test('two classes at the same time are laid out side by side', () => {
  const a = { id: 'a', start_time: '16:00', duration_hours: 1.5, subject: 'Maths' };
  const b = { id: 'b', start_time: '16:30', duration_hours: 1, subject: 'Science' };
  const c = { id: 'c', start_time: '18:00', duration_hours: 1, subject: 'English' };
  const blocks = CR.layoutDay([
    { cls: a, key: 'a' },
    { cls: b, key: 'b' },
    { cls: c, key: 'c' },
  ]);
  const overlapping = blocks.filter((x) => x.session.key !== 'c');
  assert.equal(overlapping[0].columns, 2, 'the overlapping pair splits the width');
  assert.notEqual(overlapping[0].column, overlapping[1].column);
  const alone = blocks.find((x) => x.session.key === 'c');
  assert.equal(alone.columns, 1, 'a class on its own keeps the full width');
});

test('sessions on a date come back in time order', () => {
  const morning = cls({ id: 'm', start_time: '08:00' });
  const evening = cls({ id: 'e', start_time: '18:00' });
  const found = CR.sessionsOn(data({ classes: [evening, morning] }), '2026-01-05');
  assert.deepEqual(
    found.map((s) => s.cls.id),
    ['m', 'e'],
  );
});

test('end time and duration agree', () => {
  assert.equal(SR.endTime('16:00', 1.5), '17:30');
  assert.equal(SR.endTime('17:30', 1), '18:30');
  assert.equal(CR.timeRange(cls()), '16:00–17:30');
});

/* ================================================== attendance and fees == */

test('four classes at LKR 1,500 show LKR 6,000, and paying two leaves 3,000', () => {
  const fee = 1500;
  assert.equal(CR.money(4 * fee), 'LKR 6,000');
  assert.equal(CR.money(4 * fee - 2 * fee), 'LKR 3,000');
});

test('income ignores the students who were marked absent (rule 7.5.1)', () => {
  const d = data();
  const session = {
    cls: cls(),
    done: true,
    absent: ['s1'], // Kasun away, so only Amaya's 1,200 is earned
  };
  assert.equal(CR.sessionIncome(d, session), 1200);

  const nobodyAway = { cls: cls(), done: true, absent: [] };
  assert.equal(CR.sessionIncome(d, nobodyAway), 2700);

  const notTaughtYet = { cls: cls(), done: false, absent: [] };
  assert.equal(CR.sessionIncome(d, notTaughtYet), 2700, 'a planned class is valued at everyone');
});

test('the server and the browser calculate the same session income', () => {
  const feeOf = (id) => ({ s1: 1500, s2: 1200 })[id];
  assert.equal(SR.sessionIncome(['s1', 's2'], feeOf, ['s1']), 1200);
  assert.equal(
    SR.sessionIncome(['s1', 's2'], feeOf, ['s1']),
    CR.sessionIncome(data(), { cls: cls(), done: true, absent: ['s1'] }),
  );
});

test('the dashboard adds up only the classes that were taught', () => {
  const d = data({
    sessions: [
      { class_id: 'c1', date: '2026-01-05', status: 'done', absent: ['s1'] },
      { class_id: 'c1', date: '2026-01-07', status: 'done', absent: [] },
    ],
  });
  const sum = CR.incomeSummary(d, 'week', '2026-01-07', '2026-01-08');
  assert.equal(sum.classesDone, 2);
  assert.equal(sum.earned, 1200 + 2700);
  assert.equal(sum.hours, 3, 'two classes of 1.5 hours');
  assert.equal(sum.attendancePct, 75, '3 of 4 seats filled');
  assert.equal(sum.byClass.length, 1);
  assert.equal(sum.byClass[0].income, 3900);
});

test('a planned class counts as "still to teach", never as earned', () => {
  const d = data({ sessions: [] });
  const sum = CR.incomeSummary(d, 'week', '2026-01-07', '2026-01-05');
  assert.equal(sum.earned, 0);
  assert.equal(sum.planned, 2700 * 2, 'Monday and Wednesday');
  assert.equal(sum.classesDone, 0);
  assert.equal(sum.classesTotal, 2);
});

test('the day, week and month ranges cover the right dates', () => {
  assert.deepEqual(SR.rangeDates('day', '2026-03-18'), ['2026-03-18']);
  assert.equal(SR.rangeDates('week', '2026-03-18').length, 7);
  assert.equal(SR.rangeDates('week', '2026-03-18')[0], '2026-03-16', 'starts on Monday');
  assert.equal(SR.rangeDates('month', '2026-02-10').length, 28, 'February 2026');
  assert.equal(CR.rangeDates('month', '2026-02-10').length, 28);
});

/* =============================================== attendance measures ==== */

test('attendance % is present results over the recent history', () => {
  assert.equal(SR.attendancePct('PPAPPAPA'), 63); // 5 of 8
  assert.equal(SR.attendancePct('PPPPPPPP'), 100);
  assert.equal(SR.attendancePct(''), 100, 'a new student starts at 100');
  assert.equal(CR.attendancePct('PPAPPAPA'), SR.attendancePct('PPAPPAPA'));
});

test('the streak counts back from the latest class', () => {
  assert.equal(SR.streak('PPAPPP'), 3);
  assert.equal(SR.streak('PPAPPA'), 0);
  assert.equal(SR.streak('PPPP'), 4);
  assert.equal(CR.streak('PPAPPP'), 3);
});

test('"at risk" is two or more absences in the last four classes', () => {
  assert.equal(SR.atRisk('PPPPAPAP'), true, 'A_A_ in the last four');
  assert.equal(SR.atRisk('PPPPPPAP'), false, 'only one');
  assert.equal(SR.atRisk('AAPPPPPP'), false, 'the absences are older than four');
  assert.equal(CR.atRisk('PPPPAPAP'), true);
});

/* ======================================================== marks ========= */

test('74 % is teal, 75 % is green, 49 % is pink (rule 7.4.2)', () => {
  assert.equal(CR.markColour(74), 'var(--teal)');
  assert.equal(CR.markColour(75), 'var(--green)');
  assert.equal(CR.markColour(50), 'var(--teal)');
  assert.equal(CR.markColour(49), 'var(--pink)');
});

test('a mark is a percentage of its own maximum', () => {
  assert.equal(CR.markPct({ score: 34, max_score: 50 }), 68);
  assert.equal(SR.markPct({ score: 68, max_score: 100 }), 68);
});

test('progress is the latest percentage minus the first', () => {
  const marks = [
    { score: 54, max_score: 100 },
    { score: 68, max_score: 100 },
    { score: 68, max_score: 100 },
  ];
  assert.equal(CR.progress(marks), 14);
  assert.equal(CR.progress([{ score: 50, max_score: 100 }]), 0, 'one mark is no trend yet');
});

test('a leaderboard tie goes to the higher streak, then alphabetically', () => {
  const rows = [
    { id: 'a', name: 'Zoya Fonseka', avg_pct: 80, mark_count: 2, hist: 'PPPP' },
    { id: 'b', name: 'Amal Perera', avg_pct: 80, mark_count: 2, hist: 'PPPA' },
    { id: 'c', name: 'Bimal Perera', avg_pct: 80, mark_count: 2, hist: 'PPPP' },
  ];
  const board = SR.rankPeers(rows, 'a', 'marks');
  assert.equal(board[0].value, 80);
  assert.deepEqual(
    board.map((r) => r.rank),
    [1, 2, 3],
  );
  // Zoya and Bimal both have a streak of 4, Amal has 0, so Amal is last.
  assert.equal(board[2].name, 'Amal P.');
  // Between the two with a streak of 4, Bimal comes before Zoya by name.
  assert.equal(board[0].name, 'Bimal P.');
  assert.equal(board[1].name, 'Zoya Fonseka', 'the child themselves keeps their full name');
});

test('a parent never sees another child’s full surname', () => {
  assert.equal(SR.maskName('Kasun Perera', false), 'Kasun P.');
  assert.equal(SR.maskName('Kasun Perera', true), 'Kasun Perera');
  assert.equal(SR.maskName('Kasun', false), 'Kasun', 'a single name cannot leak more');

  const rows = [
    { id: 'me', name: 'Kasun Perera', avg_pct: 70, mark_count: 1, hist: 'PP' },
    { id: 'them', name: 'Amaya Jayasinghe', avg_pct: 90, mark_count: 1, hist: 'PP' },
  ];
  const board = SR.rankPeers(rows, 'me', 'marks');
  const others = board.filter((r) => !r.self);
  assert.ok(
    others.every((r) => !r.name.includes('Jayasinghe')),
    'no surname of another child is in the payload',
  );
  assert.ok(
    others.every((r) => r.id === null),
    'another child’s id is not sent either',
  );
});

test('only students with marks appear on the marks board', () => {
  const rows = [
    { id: 'a', name: 'With Marks', avg_pct: 60, mark_count: 1, hist: 'PP' },
    { id: 'b', name: 'No Marks', avg_pct: null, mark_count: 0, hist: 'PP' },
  ];
  assert.equal(SR.rankPeers(rows, 'a', 'marks').length, 1);
  assert.equal(SR.rankPeers(rows, 'a', 'attendance').length, 2, 'the attendance board shows everyone');
});

/* ======================================================== class types === */

test('the class type and title follow the number of students (rule 6.2)', () => {
  assert.equal(SR.classType(1), 'Individual');
  assert.equal(SR.classType(2), 'Small group');
  assert.equal(SR.classType(5), 'Small group');
  assert.equal(SR.classType(6), 'Group');
  assert.equal(SR.classTitle(11, 'Maths', 1), 'Grade 11 Maths');
  assert.equal(SR.classTitle(11, 'Maths', 2), 'Grade 11 Maths small group');
  assert.equal(SR.classTitle(10, 'Maths', 10), 'Grade 10 Maths group');
  assert.equal(CR.classTitle(10, 'Maths', 10), SR.classTitle(10, 'Maths', 10));
});

/* ======================================================== money format == */

test('paper profit is revenue minus cost', () => {
  const papers = [
    { price: 2000, sold: 3, cost: 2000 },
    { price: 500, sold: 5, cost: 700 },
    { price: 1800, sold: 2, cost: 1800 },
  ];
  const revenue = papers.reduce((a, p) => a + p.price * p.sold, 0);
  const cost = papers.reduce((a, p) => a + p.cost, 0);
  assert.equal(revenue, 12100);
  assert.equal(cost, 4500);
  assert.equal(CR.money(revenue - cost), 'LKR 7,600');
});

test('amounts are written in LKR with thousands separators', () => {
  assert.equal(CR.money(6000), 'LKR 6,000');
  assert.equal(CR.money(0), 'LKR 0');
  assert.equal(CR.money(43900), 'LKR 43,900');
  assert.equal(CR.moneyShort(17500), '17.5K');
});

/* ======================================================== session state = */

test('a session is Done, Not marked, Parent reminded or Not sent yet', () => {
  const today = '2026-03-18';
  assert.equal(CR.sessionStatus({ date: today, done: true }, today).label, 'Done');
  assert.equal(CR.sessionStatus({ date: '2026-03-17', done: false }, today).label, 'Not marked');
  assert.equal(CR.sessionStatus({ date: '2026-03-19', done: false, notified: true }, today).label, 'Parent reminded');
  assert.equal(CR.sessionStatus({ date: '2026-03-19', done: false, notified: false }, today).label, 'Not sent yet');
});

test('a saved result is attached to the generated session', () => {
  const d = data({
    sessions: [{ class_id: 'c1', date: '2026-01-05', status: 'done', absent: ['s1'] }],
  });
  const [session] = CR.sessionsOn(d, '2026-01-05');
  assert.equal(session.done, true);
  assert.deepEqual(session.absent, ['s1']);
  const [later] = CR.sessionsOn(d, '2026-01-07');
  assert.equal(later.done, false);
});

/* ======================================================== messages ====== */

test('every message names the teacher and keeps amounts in LKR', () => {
  const fee = render('fee', { teacher: 'Nimal Sir', student: 'Kasun', classes: 4, amount: 6000 }, 'en');
  assert.match(fee, /Nimal Sir/);
  assert.match(fee, /LKR 6,000/);
  assert.match(fee, /4 classes/);

  const tamil = render('fee', { teacher: 'Nimal Sir', student: 'Kasun', classes: 4, amount: 6000 }, 'ta');
  assert.match(tamil, /LKR 6,000/);
  assert.notEqual(tamil, fee, 'Tamil is a real translation, not the English text');
});

test('an unknown language falls back to English rather than failing', () => {
  const text = render('paid', { student: 'Kasun', amount: 1500 }, 'fr');
  assert.match(text, /LKR 1,500/);
});

/* ======================================================== login codes === */

test('a code is stored hashed and salted, and still verifies', () => {
  const { hash, salt } = hashCode('1234');
  assert.notEqual(hash, '1234');
  assert.ok(hash.length >= 64);
  assert.equal(verifyCode('1234', hash, salt), true);
  assert.equal(verifyCode('1235', hash, salt), false);
  assert.equal(verifyCode('1234', hash, 'wrong-salt'), false);
});

test('two accounts with the same code get different hashes', () => {
  const a = hashCode('1234');
  const b = hashCode('1234');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash, 'the salt makes the stored value unique');
});

test('the lookup digest is stable for one code and different for another', () => {
  assert.equal(codeLookup('1234'), codeLookup('1234'));
  assert.notEqual(codeLookup('1234'), codeLookup('4321'));
  assert.equal(
    codeLookup('1234').includes('1234'),
    false,
    'the code is not recoverable from the digest',
  );
});

test('generated codes are the configured length and digits only', () => {
  for (let i = 0; i < 50; i += 1) {
    const code = randomCode(6);
    assert.match(code, /^\d{6}$/);
  }
});

/* ======================================================== dates ========= */

test('date arithmetic survives a month end and a leap day', () => {
  assert.equal(SR.addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(SR.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(SR.addDays('2024-02-28', 1), '2024-02-29', '2024 was a leap year');
  assert.equal(CR.addMonths('2026-01-31', 1), '2026-03-03', 'month steps normalise, like the Date API');
  assert.equal(CR.daysInMonth('2026-02-10'), 28);
  assert.equal(CR.daysInMonth('2024-02-10'), 29);
});

test('both sides format and parse dates identically', () => {
  for (const date of ['2026-01-05', '2026-12-31', '2024-02-29']) {
    assert.equal(SR.weekday(date), CR.weekday(date));
    assert.equal(SR.addDays(date, 10), CR.addDays(date, 10));
  }
});
