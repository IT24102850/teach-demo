/**
 * Seed the database with the demo teacher, students, classes and history.
 *
 *   node --env-file=.env scripts/seed.mjs            # add, keep what is there
 *   node --env-file=.env scripts/seed.mjs --fresh    # wipe this teacher first
 *
 * Login codes are hashed with the very same functions the server uses, so the
 * only place a plain code exists is this file's output.
 *
 * The attendance and fee history is generated for real: one session row per
 * past class, one attendance row per student, one charge per student who was
 * present, and payments on top. Every total on every screen is therefore
 * calculated from the ledger, exactly as it will be in production.
 */

import * as db from '../api/_lib/db.js';
import { codeLookup, hashCode } from '../api/_lib/session.js';
import { addDays, today, weekday } from '../api/_lib/rules.js';

const FRESH = process.argv.includes('--fresh');
const TODAY = today();
const WEEKS_OF_HISTORY = 8;

const TEACHER_CODE = '1234';
const JOIN_KEY = 'nimal';

/* ------------------------------------------------------------ demo data --- */

const STUDENTS = [
  // name, grade, subject, area, school, curriculum, fee, parent, phone
  ['Kasun Perera', 11, 'Maths', 'Nugegoda', 'Royal College', 'Local', 1500, 'Sunil Perera', '94770000001'],
  ['Amaya Jayasinghe', 11, 'Maths', 'Nugegoda', 'Visakha Vidyalaya', 'Local', 1200, 'Ruvini Jayasinghe', '94770000004'],
  ['Dilini Silva', 9, 'Maths', 'Maharagama', 'Maharagama MV', 'Local', 800, 'Nadeeka Silva', '94770000002'],
  ['Ravi Fernando', 10, 'Science', 'Dehiwala', 'St. Peter’s', 'Cambridge', 800, 'Anton Fernando', '94770000003'],
  ['Tharindu Bandara', 9, 'English', 'Kotte', 'Ananda College', 'Edexcel', 1000, 'Kamala Bandara', '94770000005'],

  ['Nethmi Wickrama', 10, 'Maths', 'Nugegoda', 'Nugegoda MMV', 'Local', 900, 'Sanath Wickrama', '94770000006'],
  ['Sachini Gunawardena', 10, 'Maths', 'Nugegoda', 'Nugegoda MMV', 'Local', 900, 'Chandima Gunawardena', '94770000007'],
  ['Pasindu Rathnayake', 10, 'Maths', 'Nugegoda', 'Thurstan College', 'Local', 900, 'Ajith Rathnayake', '94770000008'],
  ['Hiruni Senanayake', 10, 'Maths', 'Nugegoda', 'Nugegoda MMV', 'Local', 900, 'Dilhani Senanayake', '94770000009'],
  ['Yasith Kumara', 10, 'Maths', 'Nugegoda', 'Thurstan College', 'Local', 900, 'Ranjith Kumara', '94770000010'],
  ['Thisara Mendis', 10, 'Maths', 'Nugegoda', 'St. Joseph’s', 'Local', 900, 'Nilantha Mendis', '94770000011'],
  ['Oshadi Weerasinghe', 10, 'Maths', 'Nugegoda', 'Nugegoda MMV', 'Local', 900, 'Pradeep Weerasinghe', '94770000012'],
  ['Kavindu Herath', 10, 'Maths', 'Nugegoda', 'Thurstan College', 'Local', 900, 'Gayan Herath', '94770000013'],
  ['Senuri Dias', 10, 'Maths', 'Nugegoda', 'Nugegoda MMV', 'Local', 900, 'Shanika Dias', '94770000014'],
  ['Minuda Alwis', 10, 'Maths', 'Nugegoda', 'St. Joseph’s', 'Local', 900, 'Thilak Alwis', '94770000015'],

  ['Nimali Silva', 4, 'Maths', 'Maharagama', 'Maharagama Primary', 'Local', 800, 'Nadeeka Silva', '94770000002'],
  ['Sahan Peiris', 5, 'English', 'Kotte', 'Kotte Primary', 'Local', 800, 'Dulani Peiris', '94770000016'],
];

const CLASSES = [
  // subject, curriculum, grade, days (0=Mon), time, hours, place, student names
  ['Maths', 'Local', 11, [0, 2], '16:00', 1.5, 'Hall B, Nugegoda', ['Kasun Perera', 'Amaya Jayasinghe']],
  ['Maths', 'Local', 9, [1, 3], '15:00', 1, 'Maharagama', ['Dilini Silva']],
  ['Science', 'Cambridge', 10, [2, 4], '17:30', 1, 'Dehiwala', ['Ravi Fernando']],
  ['English', 'Edexcel', 9, [0, 5], '10:00', 1, 'Kotte', ['Tharindu Bandara']],
  [
    'Maths',
    'Local',
    10,
    [5],
    '08:00',
    2,
    'Hall A, Nugegoda',
    [
      'Nethmi Wickrama',
      'Sachini Gunawardena',
      'Pasindu Rathnayake',
      'Hiruni Senanayake',
      'Yasith Kumara',
      'Thisara Mendis',
      'Oshadi Weerasinghe',
      'Kavindu Herath',
      'Senuri Dias',
      'Minuda Alwis',
    ],
  ],
  ['Maths', 'Local', 10, [3], '18:00', 1, 'Hall A, Nugegoda', ['Nethmi Wickrama', 'Yasith Kumara', 'Senuri Dias']],
  ['Maths', 'Local', 4, [6], '09:00', 1, 'Maharagama', ['Nimali Silva']],
  ['English', 'Local', 5, [6], '10:30', 1, 'Kotte', ['Sahan Peiris']],
  ['Maths', 'Cambridge', 11, [4], '16:00', 1.5, 'Hall B, Nugegoda', ['Amaya Jayasinghe']],
  ['Science', 'Edexcel', 11, [1], '17:00', 1.5, 'Dehiwala', ['Kasun Perera', 'Ravi Fernando']],
  ['English', 'Local', 9, [4], '11:00', 1, 'Kotte', ['Tharindu Bandara', 'Sahan Peiris']],
];

/** How many of the most recent classes each student has not paid for yet. */
const UNPAID_CLASSES = {
  'Kasun Perera': 4,
  'Ravi Fernando': 2,
  'Tharindu Bandara': 3,
  'Nethmi Wickrama': 2,
  'Pasindu Rathnayake': 1,
  'Thisara Mendis': 3,
  'Kavindu Herath': 2,
  'Sahan Peiris': 1,
};

/**
 * Who was away, counted back through that student's OWN classes: 0 is their
 * most recent class, 1 the one before it, and so on.
 *
 * It has to be per student rather than per week, because a student enrolled in
 * two classes has two or three a week - marking "week 3" absent would wipe out
 * every class in it and leave the attendance percentage looking broken.
 *
 * The first eight indices are the window the app shows (rule 7.3), so these
 * numbers decide the P/A string on the parent's screen. The comments give the
 * string each one produces.
 */
const ABSENT_RECENT = {
  'Kasun Perera': [1, 3, 6, 11, 14],   // PAPPAPAP  -> 63 %
  'Amaya Jayasinghe': [0, 13],         // PPPPPPPA  -> 88 %
  'Ravi Fernando': [4, 12],            // PPPAPPPP  -> 88 %
  'Tharindu Bandara': [1, 4, 6, 10],   // PAPPAPAP  -> 63 %
  'Hiruni Senanayake': [1, 5, 9],      // PPAPPPAP  -> 75 %
  'Yasith Kumara': [2, 11],            // PPPPPAPP  -> 88 %
  'Pasindu Rathnayake': [2, 5, 15],    // PPAPPAPP  -> 75 %
  'Thisara Mendis': [3],               // PPPPAPPP  -> 88 %
  'Sahan Peiris': [6],                 // PAPPPPPP  -> 88 %
  // Dilini Silva and the rest have a clean record: 100 %.
};

const MARKS = {
  'Kasun Perera': [['Term test 1', 54], ['Term test 2', 68], ['Model paper 1', 72]],
  'Amaya Jayasinghe': [['Term test 1', 90], ['Term test 2', 93]],
  'Dilini Silva': [['Term test 1', 81], ['Term test 2', 88]],
  'Ravi Fernando': [['Term test 1', 45], ['Term test 2', 61]],
  'Tharindu Bandara': [['Term test 1', 70]],
  'Nethmi Wickrama': [['Term test 1', 76], ['Term test 2', 79]],
  'Sachini Gunawardena': [['Term test 1', 64], ['Term test 2', 71]],
  'Pasindu Rathnayake': [['Term test 1', 49]],
  'Hiruni Senanayake': [['Term test 1', 58], ['Term test 2', 55]],
  'Yasith Kumara': [['Term test 1', 83]],
  'Senuri Dias': [['Term test 1', 92], ['Term test 2', 87]],
};

const PAPERS = [
  ['Edexcel Maths Paper 2', 2000, 2000, 3],
  ['English medium Science term test', 500, 700, 5],
  ['Cambridge IGCSE Maths mock', 1800, 1800, 2],
];

/* ----------------------------------------------------------------- run ---- */

function requireEnv() {
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SESSION_SECRET', 'LOGIN_PEPPER'].filter(
    (k) => !process.env[k] && !(k === 'SUPABASE_SERVICE_KEY' && process.env.SUPABASE_SERVICE_ROLE_KEY),
  );
  if (missing.length) {
    console.error(`\nMissing environment variables: ${missing.join(', ')}`);
    console.error('Copy .env.example to .env, fill it in, then run:');
    console.error('  node --env-file=.env scripts/seed.mjs\n');
    process.exit(1);
  }
}

async function wipeTeacher() {
  const existing = await db.selectOne('teachers', { select: 'id', join_key: `eq.${JOIN_KEY}` });
  if (!existing) return;
  // Everything else cascades from the teacher row.
  await db.remove('teachers', { id: `eq.${existing.id}` });
  console.log('· removed the previous demo teacher');
}

async function main() {
  requireEnv();
  console.log(`\nSeeding Plus demo data (today is ${TODAY})`);

  if (FRESH) await wipeTeacher();

  let teacher = await db.selectOne('teachers', { select: 'id', join_key: `eq.${JOIN_KEY}` });
  if (teacher) {
    console.log('· demo teacher already exists - run with --fresh to rebuild');
    process.exit(0);
  }

  /* 1 · teacher */
  const teacherCode = hashCode(TEACHER_CODE);
  [teacher] = await db.insert('teachers', {
    name: 'Nimal',
    title: 'Sir',
    phone: '94771112222',
    join_key: JOIN_KEY,
    subjects: ['Maths', 'Science', 'English'],
    curricula: ['Local', 'Cambridge', 'Edexcel'],
    lang: 'en',
    theme: 'night',
    auto_reminders: true,
    remind_after_days: 14,
    code_lookup: codeLookup(TEACHER_CODE),
    code_hash: teacherCode.hash,
    code_salt: teacherCode.salt,
  });
  const tid = teacher.id;
  console.log('· teacher: Nimal Sir');

  /* 2 · students */
  const inserted = await db.insert(
    'students',
    STUDENTS.map(([name, grade, subject, area, school, curriculum, fee, parent, phone]) => ({
      teacher_id: tid,
      name,
      grade,
      subject,
      wanted_subjects: [subject],
      area,
      school,
      curriculum,
      fee_per_class: fee,
      parent_name: parent,
      parent_phone: phone,
      status: 'active',
    })),
  );
  const byName = Object.fromEntries(inserted.map((s) => [s.name, s]));
  console.log(`· students: ${inserted.length}`);

  /* 3 · one pending sign-up, so the "confirm a new family" flow is visible */
  const [pending] = await db.insert('students', {
    teacher_id: tid,
    name: 'Ishara Madushani',
    grade: 11,
    school: 'Devi Balika Vidyalaya',
    area: 'Nugegoda',
    curriculum: 'Local',
    subject: 'Maths',
    wanted_subjects: ['Maths', 'Science'],
    fee_per_class: 0,
    parent_name: 'Lalith Madushani',
    parent_phone: '94770000017',
    status: 'pending',
  });

  /* 4 · classes */
  const startDate = addDays(TODAY, -WEEKS_OF_HISTORY * 7);
  const classRows = await db.insert(
    'classes',
    CLASSES.map(([subject, curriculum, grade, days, time, hours, place]) => ({
      teacher_id: tid,
      subject,
      curriculum,
      grade,
      title: `Grade ${grade} ${subject}`,
      place,
      days,
      start_time: time,
      duration_hours: hours,
      start_date: startDate,
    })),
  );

  // Give each class the title its size implies (rule 6.2).
  const links = [];
  for (let i = 0; i < CLASSES.length; i += 1) {
    const names = CLASSES[i][7];
    const size = names.length;
    const suffix = size > 5 ? ' group' : size > 1 ? ' small group' : '';
    await db.update(
      'classes',
      { title: `Grade ${CLASSES[i][2]} ${CLASSES[i][0]}${suffix}` },
      { id: `eq.${classRows[i].id}` },
    );
    for (const name of names) links.push({ class_id: classRows[i].id, student_id: byName[name].id });
  }
  await db.insert('class_students', links, { returning: 'minimal' });
  console.log(`· classes: ${classRows.length}, enrolments: ${links.length}`);

  // One cancelled day, so the "cancel just this day" rule has an example.
  await db.insert(
    'class_exceptions',
    { class_id: classRows[0].id, skip_date: addDays(TODAY, -7), reason: 'Public holiday' },
    { returning: 'minimal' },
  );

  /* 5 · history: sessions, attendance and charges */
  const sessions = [];
  for (let i = 0; i < classRows.length; i += 1) {
    const [, , , days] = CLASSES[i];
    for (let back = WEEKS_OF_HISTORY * 7; back >= 1; back -= 1) {
      const date = addDays(TODAY, -back);
      if (!days.includes(weekday(date))) continue;
      if (i === 0 && date === addDays(TODAY, -7)) continue; // the cancelled day
      sessions.push({
        class_id: classRows[i].id,
        teacher_id: tid,
        session_date: date,
        status: 'done',
        done_at: `${date}T12:00:00Z`,
      });
    }
  }
  const sessionRows = await db.insert('sessions', sessions);

  const classOf = Object.fromEntries(classRows.map((c, i) => [c.id, i]));

  // Each student's own classes, oldest first, so an absence can be placed at a
  // known distance from their latest class.
  const mine = {};
  for (const session of sessionRows) {
    for (const name of CLASSES[classOf[session.class_id]][7]) {
      (mine[name] = mine[name] || []).push(session);
    }
  }
  const absentSessions = {};
  for (const [name, list] of Object.entries(mine)) {
    list.sort((a, b) => a.session_date.localeCompare(b.session_date));
    absentSessions[name] = new Set(
      (ABSENT_RECENT[name] || [])
        .map((back) => list[list.length - 1 - back])
        .filter(Boolean)
        .map((s) => s.id),
    );
  }

  const attendance = [];
  const charges = [];
  for (const session of sessionRows) {
    const names = CLASSES[classOf[session.class_id]][7];
    for (const name of names) {
      const student = byName[name];
      const away = absentSessions[name].has(session.id);
      attendance.push({ session_id: session.id, student_id: student.id, present: !away });
      // Rule 7.2.2: a student who was away is not charged for that class.
      if (!away) {
        charges.push({
          teacher_id: tid,
          student_id: student.id,
          session_id: session.id,
          amount: student.fee_per_class,
          charge_date: session.session_date,
          note: `${CLASSES[classOf[session.class_id]][0]} class`,
        });
      }
    }
  }
  await db.insert('attendance', attendance, { returning: 'minimal' });
  await db.insert('charges', charges, { returning: 'minimal' });
  console.log(`· history: ${sessionRows.length} classes taught, ${charges.length} charges`);

  /* 6 · payments, so that each student owes what the demo expects */
  const payments = [];
  for (const student of inserted) {
    const own = charges
      .filter((c) => c.student_id === student.id)
      .sort((a, b) => a.charge_date.localeCompare(b.charge_date));
    const unpaid = UNPAID_CLASSES[student.name] || 0;
    const paidRows = unpaid ? own.slice(0, Math.max(0, own.length - unpaid)) : own;
    if (!paidRows.length) continue;

    // Spread the money over monthly instalments, so the six-month chart is real.
    const byMonth = {};
    for (const row of paidRows) {
      const month = row.charge_date.slice(0, 7);
      byMonth[month] = (byMonth[month] || 0) + Number(row.amount);
    }
    for (const [month, amount] of Object.entries(byMonth)) {
      payments.push({
        teacher_id: tid,
        student_id: student.id,
        amount,
        method: Math.random() < 0.65 ? 'Bank transfer' : 'Cash',
        paid_date: `${month}-28`,
      });
    }
  }
  await db.insert('payments', payments, { returning: 'minimal' });
  console.log(`· payments: ${payments.length}`);

  /* 7 · a slip waiting for the teacher to confirm (rule 7.2.6) */
  await db.update(
    'students',
    { slip_sent_at: new Date(Date.parse(TODAY) - 864e5).toISOString() },
    { id: `eq.${byName['Ravi Fernando'].id}` },
  );

  /* 8 · marks */
  const markRows = [];
  for (const [name, list] of Object.entries(MARKS)) {
    list.forEach(([title, score], index) => {
      markRows.push({
        teacher_id: tid,
        student_id: byName[name].id,
        title,
        score,
        max_score: 100,
        taken_on: addDays(TODAY, -(list.length - index) * 18),
      });
    });
  }
  await db.insert('marks', markRows, { returning: 'minimal' });
  console.log(`· marks: ${markRows.length}`);

  /* 9 · papers */
  const paperRows = await db.insert(
    'papers',
    PAPERS.map(([name, price, cost]) => ({ teacher_id: tid, name, price, cost })),
  );
  const sales = [];
  PAPERS.forEach(([, price, , sold], index) => {
    for (let n = 0; n < sold; n += 1) {
      sales.push({
        paper_id: paperRows[index].id,
        teacher_id: tid,
        price,
        sold_on: addDays(TODAY, -(n * 3 + 2)),
      });
    }
  });
  await db.insert('paper_sales', sales, { returning: 'minimal' });
  console.log(`· papers: ${paperRows.length}, sales: ${sales.length}`);

  /* 10 · family login codes */
  const families = [
    ['3333', 'Perera family', ['Kasun Perera']],
    ['4444', 'Jayasinghe family', ['Amaya Jayasinghe']],
    ['5555', 'Silva family', ['Dilini Silva', 'Nimali Silva']], // one code, two children
    ['6666', 'Fernando family', ['Ravi Fernando']],
    ['7777', 'Bandara family', ['Tharindu Bandara']],
  ];
  for (const [code, labelText, kids] of families) {
    const { hash, salt } = hashCode(code);
    const [account] = await db.insert('family_accounts', {
      teacher_id: tid,
      label: labelText,
      phone: byName[kids[0]].parent_phone,
      code_lookup: codeLookup(code),
      code_hash: hash,
      code_salt: salt,
    });
    await db.insert(
      'family_children',
      kids.map((name) => ({ account_id: account.id, student_id: byName[name].id })),
      { returning: 'minimal' },
    );
  }

  /* 11 · a few events, so the parent's Updates feed is not empty on day one */
  // Every row carries the same keys: PostgREST refuses a bulk insert whose
  // objects have different shapes.
  const feed = [
    ['Kasun Perera', 'mark', 'Scored 72/100 in Model paper 1', 'app', 'none'],
    ['Kasun Perera', 'fee', 'Fee reminder: 4 classes pending', 'whatsapp', 'manual'],
    ['Ravi Fernando', 'slip', 'Bank slip sent, waiting for confirmation', 'app', 'none'],
    ['Amaya Jayasinghe', 'paid', 'Payment received. Thank you.', 'whatsapp', 'sent'],
    ['Tharindu Bandara', 'absent', 'Marked absent for English', 'whatsapp', 'manual'],
  ];
  await db.insert(
    'events',
    [
      ...feed.map(([name, type, text, channel, delivery_status]) => ({
        teacher_id: tid,
        student_id: byName[name].id,
        type,
        text,
        channel,
        delivery_status,
      })),
      {
        teacher_id: tid,
        student_id: pending.id,
        type: 'join',
        text: 'Ishara Madushani filled in the sign-up form',
        channel: 'app',
        delivery_status: 'none',
      },
    ],
    { returning: 'minimal' },
  );

  /* ------------------------------------------------------------- summary -- */
  const dues = await db.select('v_students', {
    select: 'name,amount_due,pending_classes,days_late,hist,avg_pct,total_classes,present_classes',
    teacher_id: `eq.${tid}`,
    order: 'days_late.desc',
  });
  const outstanding = dues.reduce((a, s) => a + Number(s.amount_due), 0);
  const collected = payments.reduce((a, p) => a + Number(p.amount), 0);

  console.log('\n  Login codes');
  console.log('  ───────────');
  console.log(`  Teacher          ${TEACHER_CODE}   (Nimal Sir)`);
  for (const [code, labelText, kids] of families) {
    console.log(`  Parent/Student   ${code}   (${labelText}: ${kids.join(', ')})`);
  }
  console.log(`\n  Sign-up link     /join?t=${JOIN_KEY}`);
  console.log(`  Collected        LKR ${collected.toLocaleString('en-US')}`);
  console.log(`  Outstanding      LKR ${outstanding.toLocaleString('en-US')}`);
  console.log('\n  Who owes what');
  for (const s of dues.filter((d) => Number(d.amount_due) > 0)) {
    console.log(
      `   ${s.name.padEnd(24)} ${String(s.pending_classes).padStart(2)} classes  ` +
        `LKR ${String(Math.round(s.amount_due)).padStart(6)}  ${s.days_late} days late`,
    );
  }
  console.log('\n  Attendance (the last 8 classes, oldest first)');
  for (const s of [...dues].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!s.hist) continue;
    const pct = Math.round(([...s.hist].filter((c) => c === 'P').length / s.hist.length) * 100);
    console.log(
      `   ${s.name.padEnd(24)} ${s.hist.padEnd(9)} ${String(pct).padStart(3)}%` +
        `   lifetime ${s.present_classes}/${s.total_classes}` +
        `${s.avg_pct ? `   avg mark ${s.avg_pct}%` : ''}`,
    );
  }
  console.log('\nDone. Set DEMO_HINT=1 to show the codes on the login screen.\n');
}

main().catch((err) => {
  console.error('\nSeeding failed:', err.message);
  if (err.detail) console.error(err.detail);
  process.exit(1);
});
