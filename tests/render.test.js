/**
 * Render every screen against fixture data and check the HTML.
 *
 * The screens are functions that return HTML, so they can be rendered here
 * without a browser. This catches the mistakes a type checker would: a field
 * that does not exist, a helper that was renamed, a number that arrives as
 * `undefined` and lands on the page.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

/* A DOM just big enough for the modules that touch it at import time. */
const elements = new Map();
const fakeEl = () => ({ innerHTML: '', value: '', className: '', style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [], focus() {}, files: [] });
globalThis.document = {
  documentElement: { dataset: {} },
  body: { classList: { toggle() {} } },
  getElementById: (id) => elements.get(id) || (elements.set(id, fakeEl()), elements.get(id)),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  createElement: () => fakeEl(),
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.matchMedia = () => ({ matches: true, addEventListener() {} });
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: async () => {} } },
  configurable: true,
});

const { S } = await import('../app/state.js');
const teacher = await import('../app/screens/teacher.js');
const family = await import('../app/screens/family.js');
const login = await import('../app/screens/login.js');
const { setLang } = await import('../app/i18n.js');

/* ------------------------------------------------------------- fixtures -- */

const TODAY = '2026-03-18'; // a Wednesday
const MONDAY = '2026-03-16';
const FRIDAY = '2026-03-20'; // c2 meets on Wednesday and Friday

const student = (over) => ({
  id: 'x',
  name: 'Kasun Perera',
  grade: 11,
  school: 'Royal College',
  area: 'Nugegoda',
  curriculum: 'Local',
  subject: 'Maths',
  wanted_subjects: ['Maths'],
  fee_per_class: 1500,
  parent_name: 'Sunil Perera',
  parent_phone: '94770000001',
  status: 'active',
  slip_sent_at: null,
  last_reminded_at: null,
  amount_due: 6000,
  pending_classes: 4,
  oldest_unpaid: '2026-02-14',
  paid_total: 12000,
  days_late: 32,
  hist: 'PPAPPAPA',
  total_classes: 20,
  present_classes: 16,
  mark_count: 3,
  avg_pct: 65,
  best_pct: 72,
  first_pct: 54,
  latest_pct: 72,
  ...over,
});

const STUDENTS = [
  student({ id: 's1' }),
  student({
    id: 's2',
    name: 'Amaya Jayasinghe',
    fee_per_class: 1200,
    amount_due: 0,
    pending_classes: 0,
    days_late: 0,
    oldest_unpaid: null,
    hist: 'PPPPPPPA',
    avg_pct: 91,
    best_pct: 93,
    mark_count: 2,
  }),
  student({
    id: 's3',
    name: 'Ravi Fernando',
    area: 'Dehiwala',
    fee_per_class: 800,
    amount_due: 1600,
    pending_classes: 2,
    days_late: 9,
    slip_sent_at: '2026-03-17T10:00:00Z',
    hist: 'PPPAPPPP',
  }),
  student({
    id: 's4',
    name: 'Ishara Madushani',
    status: 'pending',
    fee_per_class: 0,
    amount_due: 0,
    pending_classes: 0,
    days_late: 0,
    oldest_unpaid: null,
    hist: '',
    mark_count: 0,
    avg_pct: null,
    best_pct: null,
  }),
];

const CLASSES = [
  {
    id: 'c1',
    subject: 'Maths',
    curriculum: 'Local',
    grade: 11,
    title: 'Grade 11 Maths small group',
    place: 'Bright Minds Institute · Nugegoda',
    kind: 'group',
    venue_type: 'institute',
    venue_name: 'Bright Minds Institute',
    area: 'Nugegoda',
    days: [0, 2],
    start_time: '16:00:00',
    duration_hours: 1.5,
    start_date: '2026-01-05',
    once_date: null,
    active: true,
    student_ids: ['s1', 's2'],
    skips: ['2026-03-11'],
  },
  {
    id: 'c2',
    subject: 'Science',
    curriculum: 'Cambridge',
    grade: 10,
    title: 'Grade 10 Science',
    place: 'Dehiwala',
    kind: 'individual',
    venue_type: 'area',
    venue_name: null,
    area: 'Dehiwala',
    days: [2, 4],
    start_time: '17:00:00',
    duration_hours: 1,
    start_date: '2026-01-05',
    once_date: null,
    active: true,
    student_ids: ['s3'],
    skips: [],
  },
  {
    id: 'c3',
    subject: 'English',
    curriculum: 'Edexcel',
    grade: 9,
    title: 'Grade 9 English',
    place: 'Kotte',
    kind: 'individual',
    venue_type: 'area',
    venue_name: null,
    area: 'Kotte',
    days: [],
    start_time: '10:00:00',
    duration_hours: 1,
    start_date: '2026-03-01',
    once_date: '2026-03-25',
    active: true,
    student_ids: ['s1'],
    skips: [],
  },
];

const TEACHER_DATA = {
  today: TODAY,
  window: { from: '2025-09-01', to: '2026-06-01' },
  teacher: {
    id: 't1',
    name: 'Nimal',
    title: 'Sir',
    subjects: ['Maths', 'Science', 'English'],
    curricula: ['Local', 'Cambridge', 'Edexcel'],
    lang: 'en',
    theme: 'night',
    auto_reminders: true,
    remind_after_days: 14,
    join_key: 'nimal',
    own_place_name: 'My home',
    own_place_area: 'Nugegoda',
  },
  students: STUDENTS,
  classes: CLASSES,
  sessions: [
    { id: 'z1', class_id: 'c1', date: MONDAY, status: 'done', notified_at: null, absent: ['s1'], present: ['s2'] },
    {
      id: 'z2',
      class_id: 'c2',
      date: TODAY,
      status: 'done',
      notified_at: null,
      // Point 10: the real clock times, 4:02 PM to 6:31 PM local.
      started_at: '2026-03-18T10:32:00.000Z',
      ended_at: '2026-03-18T13:01:00.000Z',
      absent: [],
      present: ['s3'],
    },
    { id: 'z3', class_id: 'c2', date: FRIDAY, status: 'planned', notified_at: '2026-03-18T06:00:00Z', absent: [], present: [] },
  ],
  events: [
    { id: 'e1', student_id: 's1', type: 'mark', text: 'Scored 72/100 in Model paper 1', channel: 'app', delivery_status: 'none', created_at: '2026-03-15T10:00:00Z' },
    { id: 'e2', student_id: 's1', type: 'fee', text: 'Fee reminder: 4 classes pending', channel: 'whatsapp', delivery_status: 'manual', created_at: '2026-03-14T10:00:00Z' },
  ],
  months: [
    { month: '2026-01', collected: 38000, charged: 42000 },
    { month: '2026-02', collected: 43900, charged: 51000 },
    { month: '2026-03', collected: 21000, charged: 38500 },
  ],
  reschedules: [{ id: 'r1', student_id: 's1', class_id: 'c1', session_date: FRIDAY, note: 'Doctor', status: 'open', created_at: '2026-03-17T10:00:00Z' }],
  marks: [
    { id: 'm1', student_id: 's1', title: 'Term test 1', score: 54, max_score: 100, taken_on: '2026-01-20' },
    { id: 'm2', student_id: 's1', title: 'Term test 2', score: 68, max_score: 100, taken_on: '2026-02-18' },
    { id: 'm3', student_id: 's1', title: 'Model paper 1', score: 72, max_score: 100, taken_on: '2026-03-10' },
  ],
  papers: [
    { id: 'p1', name: 'Edexcel Maths Paper 2', price: 2000, cost: 2000, sold: 3, revenue: 6000, file_path: null },
    { id: 'p2', name: 'Cambridge IGCSE Maths mock', price: 1800, cost: 1800, sold: 2, revenue: 3600, file_path: 'papers/x.pdf' },
  ],
  whatsapp_server: false,
};

const FAMILY_DATA = {
  today: TODAY,
  role: 'parent',
  teacher: { id: 't1', name: 'Nimal', title: 'Sir', lang: 'en', theme: 'night' },
  children: [
    { id: 's1', name: 'Kasun Perera', grade: 11, area: 'Nugegoda', subject: 'Maths' },
    { id: 's5', name: 'Nimali Perera', grade: 4, area: 'Nugegoda', subject: 'Maths' },
  ],
  child_id: 's1',
  child: { ...student({ id: 's1' }), slip_sent: false },
  classes: [CLASSES[0], CLASSES[2]],
  sessions: [
    { class_id: 'c1', date: MONDAY, status: 'done', notified: false, present: false },
    { class_id: 'c1', date: TODAY, status: 'planned', notified: true, present: null },
  ],
  marks: TEACHER_DATA.marks,
  events: TEACHER_DATA.events,
  payments: [{ id: 'y1', amount: 6000, method: 'Bank transfer', paid_date: '2026-02-28' }],
  board: {
    marks: [
      { rank: 1, id: null, self: false, name: 'Amaya J.', value: 91, streak: 7 },
      { rank: 2, id: 's1', self: true, name: 'Kasun Perera', value: 65, streak: 0 },
    ],
    attendance: [
      { rank: 1, id: null, self: false, name: 'Amaya J.', value: 88, streak: 7 },
      { rank: 2, id: 's1', self: true, name: 'Kasun Perera', value: 63, streak: 0 },
    ],
  },
  papers: [{ id: 'p1', name: 'Edexcel Maths Paper 2', has_file: false }],
};

/* -------------------------------------------------------------- helpers -- */

function asTeacher(over = {}) {
  S.role = 'teacher';
  S.lang = 'en';
  setLang('en');
  S.theme = 'night';
  S.today = TODAY;
  S.cal = { mode: 'day', date: TODAY };
  S.dash = { mode: 'week', date: TODAY };
  S.search = '';
  S.sub = null;
  S.data = structuredClone(TEACHER_DATA);
  S.teacher = S.data.teacher;
  S.data.marksByStudent = {};
  for (const m of S.data.marks) {
    (S.data.marksByStudent[m.student_id] = S.data.marksByStudent[m.student_id] || []).push(m);
  }
  Object.assign(S, over);
}

function asFamily(role = 'parent', over = {}) {
  S.role = role;
  S.lang = 'en';
  setLang('en');
  S.today = TODAY;
  S.sub = null;
  S.boardBy = 'marks';
  S.data = structuredClone(FAMILY_DATA);
  S.data.role = role;
  S.teacher = S.data.teacher;
  S.children = S.data.children;
  S.childId = S.data.child_id;
  Object.assign(S, over);
}

/** Every screen must produce real HTML with no leaked blanks. */
function check(name, html) {
  assert.equal(typeof html, 'string', `${name} returned ${typeof html}`);
  assert.ok(html.length > 50, `${name} produced almost nothing`);
  assert.ok(!html.includes('undefined'), `${name} has "undefined" in its HTML`);
  assert.ok(!html.includes('NaN'), `${name} has "NaN" in its HTML`);
  assert.ok(!html.includes('[object Object]'), `${name} stringified an object`);
  assert.ok(!/\bnull\b/.test(html.replace(/data-i="[^"]*"/g, '')), `${name} has "null" in its HTML`);
  return html;
}

/* ======================================================= teacher views == */

test('Today renders with the next class and the fee total', () => {
  asTeacher();
  const html = check('today', teacher.today());
  assert.match(html, /Hi, Nimal/);
  assert.match(html, /NEXT CLASS/);
  assert.match(html, /Grade 11 Maths small group/);
  assert.match(html, /Mark attendance/);
  assert.match(html, /LKR 7,600/, 'owed = 6,000 + 1,600');
});

test('Today copes with a day that has no classes', () => {
  asTeacher({ today: '2026-03-22', cal: { mode: 'day', date: '2026-03-22' } }); // a Sunday
  const html = check('today empty', teacher.today());
  assert.match(html, /No classes today/);
});

test('Today shows the new sign-up and the reschedule request', () => {
  asTeacher();
  const html = teacher.today();
  assert.match(html, /Ishara Madushani/);
  assert.match(html, /Kasun Perera/);
});

test('the calendar renders in all three modes', () => {
  for (const mode of ['day', 'week', 'month']) {
    asTeacher({ cal: { mode, date: TODAY } });
    const html = check(`calendar ${mode}`, teacher.calendar());
    assert.match(html, /data-a="cal.mode"/);
  }
});

test('the day timeline places a class by time and sizes it by duration', () => {
  asTeacher({ cal: { mode: 'day', date: TODAY } });
  const html = teacher.calendar();
  assert.match(html, /class="blk/, 'a block is drawn');
  assert.match(html, /16:00/);
  assert.match(html, /class="now"/, 'the now-line is drawn on today');
});

test('a cancelled day shows no class', () => {
  asTeacher({ cal: { mode: 'day', date: '2026-03-11' } }); // c1 is skipped
  const html = teacher.calendar();
  assert.ok(!html.includes('Grade 11 Maths'), 'the cancelled class is gone');
});

test('the week view draws seven columns and the month view six weeks', () => {
  asTeacher({ cal: { mode: 'week', date: TODAY } });
  const week = teacher.calendar();
  assert.equal((week.match(/class="wk-col[" ]/g) || []).length, 7);

  asTeacher({ cal: { mode: 'month', date: TODAY } });
  const month = teacher.calendar();
  assert.equal((month.match(/class="mon-d/g) || []).length, 42);
});

test('a future class offers Remind parent, not attendance', () => {
  asTeacher({ cal: { mode: 'day', date: '2026-03-25' } }); // a Wednesday, plus the one-off
  const sessions = teacher.sessionCard(
    { key: 'c3|2026-03-25', date: '2026-03-25', done: false, notified: false, absent: [], cls: S.data.classes[2] },
  );
  assert.match(sessions, /data-a="session.notify"/, 'the parents can be reminded');
  assert.ok(!sessions.includes('data-a="attend.open"'), 'attendance is not offered yet');

  const todaysCard = teacher.sessionCard(
    { key: `c1|${TODAY}`, date: TODAY, done: false, notified: false, absent: [], cls: S.data.classes[0] },
  );
  assert.match(todaysCard, /data-a="attend.open"/, "today's class goes to attendance");
  assert.ok(!todaysCard.includes('data-a="session.notify"'));
});

test('All classes groups by weekday and lists the one-off class', () => {
  asTeacher({ sub: { view: 'allclasses' } });
  const html = check('allClasses', teacher.allClasses());
  assert.match(html, /Monday/);
  assert.match(html, /Wednesday/);
  assert.match(html, /Grade 9 English/);
});

test('Class detail lists the students, the cancelled day and the remove button', () => {
  asTeacher({ sub: { view: 'class', id: 'c1' } });
  const html = check('classDetail', teacher.classDetail());
  assert.match(html, /Kasun Perera/);
  assert.match(html, /Amaya Jayasinghe/);
  assert.match(html, /2026-03-11/, 'the cancelled day is listed');
  assert.match(html, /Remove class/);
  assert.match(html, /LKR 6,000/, 'a student who owes shows the amount');
});

test('point 10: a class that has not begun offers only Start class', () => {
  asTeacher({ sub: { view: 'attendance', key: `c1|${TODAY}`, absent: [] } });
  const html = check('attendance scheduled', teacher.attendance());
  assert.match(html, /Start class/);
  assert.match(html, /00:00:00/, 'the clock is at zero');
  assert.doesNotMatch(html, /End class/, 'nothing to end yet');
  assert.doesNotMatch(html, />Present</, 'the roll comes with the class starting');
  assert.match(html, /Use scheduled time/, 'for a teacher who forgot to press Start');
});

test('point 10: a running class shows the timer, the roll and End class', () => {
  asTeacher({
    sub: {
      view: 'attendance',
      key: `c1|${TODAY}`,
      absent: [],
      told: [],
      startedAt: '2026-03-18T10:32:00.000Z',
    },
  });
  const clean = check('attendance running', teacher.attendance());
  assert.match(clean, /In progress/);
  assert.match(clean, /data-since="2026-03-18T10:32:00.000Z"/, 'the timer ticks from the real start');
  assert.equal((clean.match(/>Present</g) || []).length, 2, 'everyone starts present');
  assert.match(clean, /End class/);
  assert.doesNotMatch(clean, /Send now/, 'nobody is absent yet');

  asTeacher({
    sub: {
      view: 'attendance',
      key: `c1|${TODAY}`,
      absent: ['s1'],
      told: [],
      startedAt: '2026-03-18T10:32:00.000Z',
    },
  });
  const marked = teacher.attendance();
  assert.match(marked, />Absent</);
  assert.match(marked, /1 absent/);
  assert.match(marked, /Send now/, 'the parent can be told during the class');
  assert.match(marked, /message will be sent to .* parent when you end the class/);
});

test('point 10: a parent already told is not offered Send now again', () => {
  asTeacher({
    sub: {
      view: 'attendance',
      key: `c1|${TODAY}`,
      absent: ['s1'],
      told: ['s1'],
      startedAt: '2026-03-18T10:32:00.000Z',
    },
  });
  const html = teacher.attendance();
  assert.doesNotMatch(html, /Send now/);
});

test('point 10: the ended screen shows the real times and the message sent', () => {
  asTeacher({
    sub: {
      view: 'attendance',
      key: `c1|${TODAY}`,
      absent: ['s1'],
      told: [],
      result: {
        absentIds: ['s1'],
        started_at: '2026-03-18T10:32:00.000Z',
        ended_at: '2026-03-18T13:01:00.000Z',
        messages: [
          {
            student_id: 's1',
            name: 'Kasun Perera',
            text: 'Hi, this is Nimal Sir. Kasun Perera was absent from today’s class.',
            status: 'sent',
            at: '6:31 PM',
          },
        ],
      },
    },
  });
  const html = check('attendance ended', teacher.attendance());
  assert.match(html, /Class ended/);
  assert.match(html, /2 h 29 m/, 'the length actually taught');
  assert.match(html, /was absent from today/, 'the exact text that went out');
  assert.match(html, /Resend/);
  assert.match(html, /Edit text/);
  assert.match(html, /Start \/ end time wrong\?/);
});

test('Attendance can be opened for a class that was never marked', () => {
  asTeacher({ sub: { view: 'attendance', key: 'c1|2026-03-09', absent: [] } });
  const html = check('attendance past', teacher.attendance());
  assert.match(html, /Grade 11 Maths/);
});

test('the student list searches and puts new sign-ups first', () => {
  asTeacher();
  const all = check('students', teacher.studentsView());
  assert.ok(all.indexOf('Ishara') < all.indexOf('Amaya'), 'pending first');

  asTeacher({ search: 'dehiwala' });
  const filtered = teacher.studentList();
  assert.match(filtered, /Ravi Fernando/);
  assert.ok(!filtered.includes('Kasun'), 'the search excludes the others');

  asTeacher({ search: 'zzzz' });
  assert.equal(teacher.studentList(), '', 'no matches gives an empty list');
});

test('Student detail shows fees, marks, classes and the actions', () => {
  asTeacher({ sub: { view: 'student', id: 's1' } });
  const html = check('studentDetail', teacher.studentDetail());
  assert.match(html, /LKR 6,000/);
  assert.match(html, /4 classes · 32 days late/);
  assert.match(html, /Model paper 1/);
  assert.match(html, /72%/);
  assert.match(html, /Grade 11 Maths small group/);
  assert.match(html, /data-a="fees.pay"/);
  assert.match(html, /data-a="mark.add"/);
});

test('a pending student shows the fee box, not the fee balance', () => {
  asTeacher({ sub: { view: 'student', id: 's4' } });
  const html = check('studentDetail pending', teacher.studentDetail());
  assert.match(html, /New sign-up/);
  assert.match(html, /id="newfee"/);
  assert.match(html, /data-a="student.confirm"/);
});

test('a student who sent a slip offers Confirm slip', () => {
  asTeacher({ sub: { view: 'student', id: 's3' } });
  const html = teacher.studentDetail();
  assert.match(html, /data-a="fees.confirmslip"/);
  assert.ok(!html.includes('data-a="fees.pay"'), 'Paid is replaced by Confirm slip');
});

test('Fees totals the outstanding amount and sorts by days late', () => {
  asTeacher();
  const html = check('fees', teacher.fees());
  assert.match(html, /LKR 7,600/, '6,000 + 1,600');
  assert.match(html, /LKR 21,000/, 'collected this month');
  assert.ok(html.indexOf('Kasun') < html.indexOf('Ravi'), '32 days late before 9');
  assert.ok(!html.includes('Amaya'), 'a student who owes nothing is not listed');
});

test('Fees shows a friendly state when everyone has paid', () => {
  asTeacher();
  for (const s of S.data.students) {
    s.amount_due = 0;
    s.pending_classes = 0;
    s.days_late = 0;
  }
  const html = check('fees paid', teacher.fees());
  assert.match(html, /Everyone has paid/);
});

test('the months screen charts collected against still owed', () => {
  asTeacher({ sub: { view: 'months' } });
  const html = check('feeMonths', teacher.feeMonths());
  assert.match(html, /2026-02/);
  assert.match(html, /LKR 43,900/);
});

test('the dashboard adds up the week and lists income by class', () => {
  asTeacher({ sub: { view: 'dashboard' }, dash: { mode: 'week', date: TODAY } });
  const html = check('dashboard', teacher.dashboard());
  // Mon 16 Mar: c1 done with s1 absent → 1,200. Tue 17: c2 done → 800.
  assert.match(html, /LKR 2,000/, 'earned this week');
  assert.match(html, /Hours taught/);
  assert.match(html, /By class/);
  assert.match(html, /Grade 11 Maths small group/);
});

test('the dashboard renders for a day and a month too', () => {
  for (const mode of ['day', 'month']) {
    asTeacher({ sub: { view: 'dashboard' }, dash: { mode, date: TODAY } });
    check(`dashboard ${mode}`, teacher.dashboard());
  }
});

test('Earn more shows profit, revenue and cost', () => {
  asTeacher({ sub: { view: 'earn' } });
  const html = check('earn', teacher.earn());
  assert.match(html, /LKR 9,600/, 'revenue 9,600');
  assert.match(html, /LKR 3,800/, 'cost 3,800');
  assert.match(html, /LKR 5,800/, 'profit');
  assert.match(html, /data-a="paper.sell"/);
});

/* ======================================================== parent views == */

test('Parent home shows the next class, the tiles and the feed', () => {
  asFamily('parent');
  const html = check('parentHome', family.parentHome());
  assert.match(html, /Kasun Perera/);
  assert.match(html, /63%/, 'attendance from PPAPPAPA');
  assert.match(html, /65%/, 'average');
  assert.match(html, /#2/, 'rank');
  assert.match(html, /Pay LKR 6,000/);
  assert.match(html, /Scored 72\/100/);
});

test('Parent home tells a child with a slip to wait', () => {
  asFamily('parent');
  S.data.child.slip_sent = true;
  const html = check('parentHome slip', family.parentHome());
  assert.match(html, /waiting for confirmation/);
  assert.ok(!html.includes('data-a="family.slip"'), 'no second slip while one is pending');
});

test('the leaderboard never carries another child’s surname', () => {
  asFamily('parent');
  const html = check('parentBoard', family.parentBoard());
  assert.match(html, /Amaya J\./);
  assert.ok(!html.includes('Jayasinghe'), 'the surname is not on the page');
  assert.match(html, /surname initial only/);
});

test('both leaderboards render', () => {
  for (const by of ['marks', 'attendance']) {
    asFamily('parent', { boardBy: by });
    check(`board ${by}`, family.parentBoard());
  }
});

test('Parent classes marks the week as attended, absent or upcoming', () => {
  asFamily('parent');
  const html = check('parentClasses', family.parentClasses());
  assert.match(html, /Absent/, 'the child missed Monday');
  assert.match(html, /Reminded/, "today's class was notified");
  assert.match(html, /data-a="family.reschedule"/);
});

test('Parent fees shows what is due and what was paid', () => {
  asFamily('parent');
  const html = check('parentFees', family.parentFees());
  assert.match(html, /LKR 6,000/);
  assert.match(html, /4 classes × LKR 1,500/);
  assert.match(html, /32 days late/);
  assert.match(html, /Bank transfer/);
});

test('the progress report renders every mark', () => {
  asFamily('parent', { sub: { view: 'report' } });
  const html = check('parentReport', family.parentReport());
  assert.match(html, /Term test 1/);
  assert.match(html, /54\/100/);
  assert.match(html, /72\/100/);
  assert.match(html, /\+18/, 'progress from 54 % to 72 %');
});

/* ======================================================= student views == */

test('Student home shows the streak, the goal and the latest mark', () => {
  asFamily('student');
  const html = check('studentHome', family.studentHome());
  assert.match(html, /UP NEXT/);
  assert.match(html, /Goal 90%/);
  assert.match(html, /Keep going/, '63 % has not reached 90 %');
  assert.match(html, /Model paper 1/);
});

test('Student home says Reached when the goal is met', () => {
  asFamily('student');
  S.data.child.hist = 'PPPPPPPP';
  const html = check('studentHome reached', family.studentHome());
  assert.match(html, /Reached/);
});

test('Student marks charts every test', () => {
  asFamily('student');
  const html = check('studentMarks', family.studentMarks());
  assert.match(html, /68\/100/);
  assert.match(html, /Term test 2/);
  assert.match(html, /<svg/);
});

test('Student papers offers an Open button', () => {
  asFamily('student');
  const html = check('studentPapers', family.studentPapers());
  assert.match(html, /Edexcel Maths Paper 2/);
  assert.match(html, /data-a="family.paper"/);
});

test('a student is not offered the reschedule request', () => {
  asFamily('student');
  const html = family.parentClasses();
  assert.ok(!html.includes('data-a="family.reschedule"'), 'that is the parent’s action');
});

test('empty states render instead of blank screens', () => {
  asFamily('parent');
  S.data.marks = [];
  S.data.events = [];
  S.data.papers = [];
  S.data.board = { marks: [], attendance: [] };
  check('parentHome empty', family.parentHome());
  check('studentMarks empty', family.studentMarks());
  check('studentPapers empty', family.studentPapers());
});

/* ============================================================== login === */

test('the login screen renders the roles and the PIN pad', () => {
  S.role = null;
  S.lang = 'en';
  setLang('en');
  S.codeLength = 4;
  S.demoHint = false;
  const roles = check('rolePicker', login.view());
  assert.match(roles, /Who are you\?/);
  assert.match(roles, /data-a="login.role" data-i="teacher"/);
  assert.match(roles, /data-a="login.role" data-i="parent"/);
  assert.match(roles, /data-a="login.role" data-i="student"/);

  login.ACTIONS['login.role']('teacher', null, { render() {} });
  const pad = check('pinPad', login.view());
  assert.match(pad, /Enter your code/);
  assert.equal((pad.match(/data-a="login.key"/g) || []).length, 11, '0-9 plus delete');
  assert.equal((pad.match(/<i class=""><\/i>/g) || []).length, 4, 'four empty dots');
  login.ACTIONS['login.unrole'](null, null, { render() {} });
});

/* ============================================================== Tamil === */

test('every screen also renders in Tamil', () => {
  asTeacher();
  S.lang = 'ta';
  setLang('ta');
  for (const [name, fn] of [
    ['today', teacher.today],
    ['calendar', teacher.calendar],
    ['students', teacher.studentsView],
    ['fees', teacher.fees],
  ]) {
    const html = check(`ta ${name}`, fn());
    assert.match(html, /[஀-௿]/, `${name} shows no Tamil text`);
  }

  asFamily('parent');
  S.lang = 'ta';
  setLang('ta');
  for (const [name, fn] of [
    ['parentHome', family.parentHome],
    ['parentFees', family.parentFees],
  ]) {
    const html = check(`ta ${name}`, fn());
    assert.match(html, /[஀-௿]/, `${name} shows no Tamil text`);
  }
  setLang('en');
});

/* ========================================================== escaping ==== */

test('a name with an apostrophe or a bracket cannot become markup', () => {
  asTeacher();
  S.data.students[0].name = `O'Brien <script>alert(1)</script>`;
  S.data.students[0].area = '"quoted"';
  const html = teacher.studentsView();
  assert.ok(!html.includes('<script>'), 'the tag is escaped');
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /O&#39;Brien/);

  asTeacher({ sub: { view: 'student', id: 's1' } });
  S.data.students[0].name = `Zoë "Z" <b>`;
  const detail = teacher.studentDetail();
  assert.ok(!detail.includes('<b>Zoë'), 'no injected tag');
  assert.match(detail, /&lt;b&gt;/);
});
