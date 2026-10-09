/**
 * Check the schema against a real PostgreSQL, not a stub.
 *
 *   node --env-file=.env scripts/db-verify.mjs
 *
 * The unit tests in tests/ cover the JavaScript; the money rules, though, live
 * in SQL views and functions, and only PostgreSQL can tell us whether those
 * are right. So this inserts a small fixture, asserts every rule of section 7
 * against it, and then rolls the whole thing back. It is safe to run against a
 * database with real data in it: nothing is committed.
 */

import { connect, PgError } from './pg.mjs';
import { parseDatabaseUrl } from './db-push.mjs';

const TZ = process.env.APP_TIMEZONE || 'Asia/Colombo';
const todayThere = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );

const shift = (days) => {
  const [y, m, d] = todayThere().split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
};

/* ----------------------------------------------------------------- checks */

const TEACHER = '00000000-0000-4000-8000-000000000001';
const KASUN = '00000000-0000-4000-8000-000000000002';
const AMAYA = '00000000-0000-4000-8000-000000000003';
const CLASS = '00000000-0000-4000-8000-000000000004';

const fixture = `
insert into teachers (id, name, title, join_key, code_lookup)
values ('${TEACHER}', 'Verify', 'Sir', 'verify-${Date.now()}', 'lookup-${Date.now()}');

insert into students (id, teacher_id, name, grade, fee_per_class, parent_phone, status) values
  ('${KASUN}', '${TEACHER}', 'Kasun Perera',     11, 1500, '94770000001', 'active'),
  ('${AMAYA}', '${TEACHER}', 'Amaya Jayasinghe', 11, 1200, '94770000004', 'active');

insert into classes (id, teacher_id, subject, grade, title, place, days, start_time, duration_hours, start_date)
values ('${CLASS}', '${TEACHER}', 'Maths', 11, 'Grade 11 Maths small group', 'Nugegoda',
        '{0,2}', '16:00', 1.5, '${shift(-60)}');

insert into class_students (class_id, student_id) values
  ('${CLASS}', '${KASUN}'), ('${CLASS}', '${AMAYA}');
`;

const checks = [
  {
    name: 'every table, view and function exists',
    async run(db, t) {
      const tables = (
        await db.rows(
          "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'",
        )
      ).map((r) => r.table_name);
      for (const needed of [
        'teachers', 'students', 'classes', 'class_students', 'class_exceptions', 'sessions',
        'attendance', 'charges', 'payments', 'marks', 'events', 'papers', 'paper_sales',
        'family_accounts', 'family_children', 'reschedule_requests', 'login_attempts',
      ]) {
        t.ok(tables.includes(needed), `table ${needed}`);
      }

      const views = (
        await db.rows("select table_name from information_schema.views where table_schema='public'")
      ).map((r) => r.table_name);
      for (const needed of [
        'student_dues', 'student_history', 'student_attendance_totals',
        'student_marks_summary', 'v_students', 'teacher_months',
      ]) {
        t.ok(views.includes(needed), `view ${needed}`);
      }

      const fns = (
        await db.rows(
          "select routine_name from information_schema.routines where routine_schema='public'",
        )
      ).map((r) => r.routine_name);
      t.ok(fns.includes('finish_class'), 'function finish_class');
      t.ok(fns.includes('record_payment'), 'function record_payment');
      t.ok(fns.includes('start_class'), 'function start_class (point 10)');
      t.ok(fns.includes('reverse_payment'), 'function reverse_payment (point 11)');

      // The columns the v2 screens read. Without them the app loads and then
      // shows blanks, which is much harder to diagnose than this line.
      const columns = (
        await db.rows(`
          select table_name || '.' || column_name as col
            from information_schema.columns
           where table_schema = 'public'
             and (table_name, column_name) in (
               ('teachers','own_place_name'), ('teachers','own_place_area'),
               ('students','call_name'), ('students','ambition'),
               ('students','parent_occupation'), ('students','photo_path'),
               ('classes','kind'), ('classes','venue_type'),
               ('classes','venue_name'), ('classes','area'),
               ('sessions','started_at'), ('sessions','ended_at'),
               ('payments','receipt_no'), ('payments','reversed_at')
             )`)
      ).map((r) => r.col);
      for (const col of [
        'teachers.own_place_name',
        'teachers.own_place_area',
        'students.call_name',
        'students.ambition',
        'students.parent_occupation',
        'students.photo_path',
        'classes.kind',
        'classes.venue_type',
        'classes.venue_name',
        'classes.area',
        'sessions.started_at',
        'sessions.ended_at',
        'payments.receipt_no',
        'payments.reversed_at',
      ]) {
        t.ok(columns.includes(col), `column ${col}`);
      }

      const buckets = await db.rows(
        "select id from storage.buckets where id in ('slips','papers','photos')",
      );
      t.equal(buckets.length, 3, 'all three storage buckets exist');
    },
  },

  {
    name: 'row level security is on and the anon key has no grants',
    async run(db, t) {
      const open = await db.rows(`
        select tablename from pg_tables
         where schemaname = 'public' and rowsecurity = false
           and tablename in ('teachers','students','classes','class_students','class_exceptions',
                             'sessions','attendance','charges','payments','marks','events',
                             'papers','paper_sales','family_accounts','family_children',
                             'reschedule_requests','login_attempts')`);
      t.equal(open.length, 0, `RLS on every table${open.length ? `: ${open.map((r) => r.tablename)} are open` : ''}`);

      const policies = await db.rows(
        "select count(*) n from pg_policies where schemaname='public'",
      );
      t.equal(Number(policies[0].n), 0, 'no policy grants the anon key anything');

      const grants = await db.rows(`
        select table_name, privilege_type from information_schema.role_table_grants
         where grantee in ('anon','authenticated') and table_schema='public'`);
      t.equal(grants.length, 0, `anon and authenticated hold no table grants${grants.length ? `: ${grants.length} found` : ''}`);
    },
  },

  {
    name: 'amount owed is charges minus payments, allocated oldest first',
    async run(db, t) {
      await db.query(`
        insert into charges (teacher_id, student_id, amount, charge_date) values
          ('${TEACHER}', '${KASUN}', 1500, '${shift(-28)}'),
          ('${TEACHER}', '${KASUN}', 1500, '${shift(-21)}'),
          ('${TEACHER}', '${KASUN}', 1500, '${shift(-14)}'),
          ('${TEACHER}', '${KASUN}', 1500, '${shift(-7)}');
        insert into payments (teacher_id, student_id, amount, method, paid_date)
        values ('${TEACHER}', '${KASUN}', 3000, 'Bank transfer', '${shift(-20)}');
      `);

      const [due] = await db.rows(
        `select pending_classes, amount_due, oldest_unpaid, charged_total, paid_total
           from student_dues where student_id = '${KASUN}'`,
      );
      t.equal(Number(due.charged_total), 6000, '4 classes at 1,500 charged 6,000');
      t.equal(Number(due.paid_total), 3000, '3,000 paid');
      t.equal(Number(due.amount_due), 3000, 'so 3,000 is still owed');
      t.equal(Number(due.pending_classes), 2, 'two classes remain unpaid');
      t.equal(due.oldest_unpaid, shift(-14), 'the oldest unpaid charge is the third one');

      const [student] = await db.rows(
        `select days_late, amount_due, pending_classes from v_students where id = '${KASUN}'`,
      );
      t.equal(Number(student.days_late), 14, 'days late is counted from that charge, in the teacher’s timezone');
      t.equal(Number(student.amount_due), 3000, 'v_students agrees with student_dues');
    },
  },

  {
    name: 'a student with no charges owes nothing rather than disappearing',
    async run(db, t) {
      const rows = await db.rows(
        `select amount_due, pending_classes, days_late, hist, mark_count from v_students where id = '${AMAYA}'`,
      );
      t.equal(rows.length, 1, 'the student is still listed');
      t.equal(Number(rows[0].amount_due), 0, 'nothing owed');
      t.equal(Number(rows[0].pending_classes), 0, 'no pending classes');
      t.equal(Number(rows[0].days_late), 0, 'not late');
      t.equal(rows[0].hist, '', 'no attendance history yet');
      t.equal(Number(rows[0].mark_count), 0, 'no marks yet');
    },
  },

  {
    name: 'finish_class charges only the students who were present',
    async run(db, t) {
      const [{ finish_class: sessionId }] = await db.rows(
        `select finish_class('${TEACHER}', '${CLASS}', '${shift(-1)}', array['${KASUN}']::uuid[])`,
      );
      t.ok(sessionId, 'it returns the session id');

      const [session] = await db.rows(`select status, done_at from sessions where id = '${sessionId}'`);
      t.equal(session.status, 'done', 'the session is marked done');
      t.ok(session.done_at, 'and time-stamped');

      const attendance = await db.rows(
        `select student_id, present from attendance where session_id = '${sessionId}' order by present`,
      );
      t.equal(attendance.length, 2, 'one attendance row per enrolled student');
      t.equal(attendance[0].student_id, KASUN, 'the absent student is recorded absent');
      t.equal(attendance[0].present, 'f', 'present = false');
      t.equal(attendance[1].present, 't', 'the other was present');

      const charges = await db.rows(
        `select student_id, amount from charges where session_id = '${sessionId}'`,
      );
      t.equal(charges.length, 1, 'only one charge was raised');
      t.equal(charges[0].student_id, AMAYA, 'and it is for the student who turned up');
      t.equal(Number(charges[0].amount), 1200, 'at that student’s own fee');
    },
  },

  {
    name: 'finish_class can be run again without doubling the money',
    async run(db, t) {
      await db.query(
        `select finish_class('${TEACHER}', '${CLASS}', '${shift(-1)}', array['${KASUN}']::uuid[])`,
      );
      await db.query(`select finish_class('${TEACHER}', '${CLASS}', '${shift(-1)}', '{}'::uuid[])`);

      const sessions = await db.rows(
        `select count(*) n from sessions where class_id = '${CLASS}' and session_date = '${shift(-1)}'`,
      );
      t.equal(Number(sessions[0].n), 1, 'still one session for that date');

      const charges = await db.rows(
        `select count(*) n, coalesce(sum(amount),0) total from charges
          where student_id in ('${KASUN}','${AMAYA}') and charge_date = '${shift(-1)}'`,
      );
      t.equal(Number(charges[0].n), 2, 'the second run charged both, not four rows');
      t.equal(Number(charges[0].total), 2700, 'and the total is 1,500 + 1,200');
    },
  },

  {
    name: 'finish_class refuses another teacher’s class',
    async run(db, t) {
      await t.throws(
        () => db.query(`select finish_class('${AMAYA}', '${CLASS}', '${shift(-3)}', '{}'::uuid[])`),
        /class not found/,
        'it raises rather than writing',
      );
    },
  },

  {
    name: 'record_payment takes the oldest unpaid classes and caps at what is owed',
    async run(db, t) {
      await db.query(`
        insert into charges (teacher_id, student_id, amount, charge_date) values
          ('${TEACHER}', '${KASUN}', 1500, '${shift(-28)}'),
          ('${TEACHER}', '${KASUN}', 1500, '${shift(-21)}'),
          ('${TEACHER}', '${KASUN}',  800, '${shift(-14)}');
      `);

      const [two] = await db.rows(
        `select (record_payment('${TEACHER}', '${KASUN}', 2, null, 'Cash')->>'amount')::numeric as amount`,
      );
      t.equal(Number(two.amount), 3000, 'two classes at the fee they were charged at');

      const [rest] = await db.rows(
        `select (record_payment('${TEACHER}', '${KASUN}', 99, null, 'Cash')->>'amount')::numeric as amount`,
      );
      t.equal(Number(rest.amount), 800, 'asking for more classes than exist pays only what is left');

      const [due] = await db.rows(`select amount_due from student_dues where student_id = '${KASUN}'`);
      t.equal(Number(due.amount_due), 0, 'nothing is owed now');

      await t.throws(
        () => db.query(`select record_payment('${TEACHER}', '${KASUN}', 1, null, 'Cash')`),
        /nothing is owed/,
        'paying again is refused',
      );
    },
  },

  {
    name: 'start_class records a start time without finishing the class (point 10)',
    async run(db, t) {
      const date = shift(-4);
      const [first] = await db.rows(
        `select start_class('${TEACHER}', '${CLASS}', '${date}') as at`,
      );
      t.ok(Boolean(first.at), 'a start time is recorded');

      const [second] = await db.rows(
        `select start_class('${TEACHER}', '${CLASS}', '${date}') as at`,
      );
      t.equal(String(second.at), String(first.at), 'pressing Start twice does not restart it');

      const [row] = await db.rows(
        `select status, started_at, ended_at from sessions
          where class_id = '${CLASS}' and session_date = '${date}'`,
      );
      t.equal(row.status, 'planned', 'starting a class does not finish it');
      t.equal(row.ended_at, null, 'and leaves no end time');

      await db.query(
        `select finish_class('${TEACHER}', '${CLASS}', '${date}', '{}'::uuid[], null, now())`,
      );
      const [done] = await db.rows(
        `select status, started_at, ended_at from sessions
          where class_id = '${CLASS}' and session_date = '${date}'`,
      );
      t.equal(String(done.started_at), String(first.at), 'ending it keeps the recorded start');
      t.ok(Boolean(done.ended_at), 'and records the end');
      t.equal(done.status, 'done', 'and the class is done');
    },
  },

  {
    name: 'a part payment leaves the rest owing, and Undo puts it back (point 11)',
    async run(db, t) {
      await db.query(
        `insert into charges (teacher_id, student_id, amount, charge_date)
         values ('${TEACHER}', '${KASUN}', 6000, '${shift(-5)}')`,
      );
      const [part] = await db.rows(
        `select record_payment('${TEACHER}', '${KASUN}', null, 2000, 'Online') as r`,
      );
      const paid = typeof part.r === 'string' ? JSON.parse(part.r) : part.r;
      t.equal(Number(paid.amount), 2000, 'the amount is taken as typed');
      t.equal(Number(paid.balance), 4000, '2,000 off 6,000 leaves 4,000');
      t.ok(Number(paid.receipt_no) > 0, 'and it has a receipt number');

      const [owing] = await db.rows(
        `select amount_due from student_dues where student_id = '${KASUN}'`,
      );
      t.equal(Number(owing.amount_due), 4000, 'the ledger agrees');

      await db.query(`select reverse_payment('${TEACHER}', '${paid.payment_id}')`);
      const [back] = await db.rows(
        `select amount_due from student_dues where student_id = '${KASUN}'`,
      );
      t.equal(Number(back.amount_due), 6000, 'Undo restores the exact previous balance');

      const [kept] = await db.rows(
        `select reversed_at from payments where id = '${paid.payment_id}'`,
      );
      t.ok(Boolean(kept.reversed_at), 'the row is kept, marked reversed, never deleted');

      await t.throws(
        () => db.query(`select reverse_payment('${TEACHER}', '${paid.payment_id}')`),
        /already/,
        'and it cannot be undone twice',
      );
    },
  },

  {
    name: 'record_payment never takes more than the balance',
    async run(db, t) {
      await db.query(
        `insert into charges (teacher_id, student_id, amount, charge_date)
         values ('${TEACHER}', '${KASUN}', 1000, '${shift(-5)}')`,
      );
      const [over] = await db.rows(
        `select (record_payment('${TEACHER}', '${KASUN}', null, 999999, 'Cash')->>'amount')::numeric as amount`,
      );
      t.equal(Number(over.amount), 1000, 'an over-payment is clipped to the amount owed');
    },
  },

  {
    name: 'record_payment refuses another teacher’s student',
    async run(db, t) {
      await db.query(
        `insert into charges (teacher_id, student_id, amount, charge_date)
         values ('${TEACHER}', '${KASUN}', 1000, '${shift(-5)}')`,
      );
      await t.throws(
        () => db.query(`select record_payment('${KASUN}', '${KASUN}', 1, null, 'Cash')`),
        /student not found/,
        'it raises',
      );
    },
  },

  {
    name: 'clearing the balance clears the slip and the reminder note',
    async run(db, t) {
      await db.query(`
        update students set slip_path = 'slips/x.jpg', slip_sent_at = now(), last_reminded_at = now()
         where id = '${KASUN}';
        insert into charges (teacher_id, student_id, amount, charge_date)
        values ('${TEACHER}', '${KASUN}', 1500, '${shift(-3)}');
      `);
      await db.query(`select record_payment('${TEACHER}', '${KASUN}', null, null, 'Slip')`);
      const [student] = await db.rows(
        `select slip_path, slip_sent_at, last_reminded_at from students where id = '${KASUN}'`,
      );
      t.equal(student.slip_path, null, 'the slip is cleared');
      t.equal(student.slip_sent_at, null, 'and its timestamp');
      t.equal(student.last_reminded_at, null, 'and the reminder note');
    },
  },

  {
    name: 'attendance history is the last eight results, oldest first',
    async run(db, t) {
      // Ten classes: present except the 2nd and the 9th.
      for (let i = 1; i <= 10; i += 1) {
        const date = shift(-40 + i);
        const present = i === 2 || i === 9 ? 'false' : 'true';
        await db.query(`
          insert into sessions (class_id, teacher_id, session_date, status)
          values ('${CLASS}', '${TEACHER}', '${date}', 'done');
          insert into attendance (session_id, student_id, present)
          select id, '${KASUN}', ${present} from sessions
           where class_id = '${CLASS}' and session_date = '${date}';
        `);
      }

      const [history] = await db.rows(`select hist from student_history where student_id = '${KASUN}'`);
      t.equal(history.hist.length, 8, 'exactly eight results');
      t.equal(history.hist, 'PPPPPPAP', 'oldest first, and the 2nd absence has fallen out of the window');

      const [totals] = await db.rows(
        `select total_classes, present_classes from student_attendance_totals where student_id = '${KASUN}'`,
      );
      t.equal(Number(totals.total_classes), 10, 'lifetime total counts all ten');
      t.equal(Number(totals.present_classes), 8, 'eight of them attended');

      const [student] = await db.rows(`select hist from v_students where id = '${KASUN}'`);
      t.equal(student.hist, history.hist, 'v_students carries the same window');
    },
  },

  {
    name: 'a session that was never marked is left out of the history',
    async run(db, t) {
      await db.query(`
        insert into sessions (class_id, teacher_id, session_date, status, notified_at)
        values ('${CLASS}', '${TEACHER}', '${shift(2)}', 'planned', now());
      `);
      const rows = await db.rows(`select hist from student_history where student_id = '${KASUN}'`);
      t.equal(rows.length, 0, 'a planned session contributes nothing');
    },
  },

  {
    name: 'mark percentages work off each test’s own maximum',
    async run(db, t) {
      await db.query(`
        insert into marks (teacher_id, student_id, title, score, max_score, taken_on) values
          ('${TEACHER}', '${KASUN}', 'Term test 1', 54, 100, '${shift(-50)}'),
          ('${TEACHER}', '${KASUN}', 'Term test 2', 34,  50, '${shift(-30)}'),
          ('${TEACHER}', '${KASUN}', 'Model paper', 72, 100, '${shift(-10)}');
      `);
      const [m] = await db.rows(
        `select mark_count, avg_pct, best_pct, first_pct, latest_pct
           from student_marks_summary where student_id = '${KASUN}'`,
      );
      t.equal(Number(m.mark_count), 3, 'three marks');
      t.equal(Number(m.first_pct), 54, 'the first is 54 %');
      t.equal(Number(m.latest_pct), 72, 'the latest is 72 %');
      t.equal(Number(m.best_pct), 72, 'the best is 72 %');
      t.equal(Number(m.avg_pct), 65, '54, 68 and 72 average to 65 % - 34/50 counts as 68 %');
    },
  },

  {
    name: 'the monthly totals come from the ledger',
    async run(db, t) {
      await db.query(`
        insert into charges (teacher_id, student_id, amount, charge_date) values
          ('${TEACHER}', '${KASUN}', 5000, date_trunc('month', current_date)::date),
          ('${TEACHER}', '${KASUN}', 3000, (date_trunc('month', current_date) - interval '1 month')::date);
        insert into payments (teacher_id, student_id, amount, method, paid_date) values
          ('${TEACHER}', '${KASUN}', 2000, 'Cash', date_trunc('month', current_date)::date);
      `);
      const months = await db.rows(
        `select month, collected, charged from teacher_months where teacher_id = '${TEACHER}' order by month`,
      );
      t.ok(months.length >= 2, 'at least two months are reported');
      const thisMonth = months[months.length - 1];
      t.equal(Number(thisMonth.charged), 5000, 'this month charged 5,000');
      t.equal(Number(thisMonth.collected), 2000, 'and collected 2,000');
    },
  },

  {
    name: 'one class cannot be charged to the same student twice',
    async run(db, t) {
      const [{ finish_class: sessionId }] = await db.rows(
        `select finish_class('${TEACHER}', '${CLASS}', '${shift(-2)}', '{}'::uuid[])`,
      );
      await t.throws(
        () =>
          db.query(
            `insert into charges (teacher_id, student_id, session_id, amount, charge_date)
             values ('${TEACHER}', '${KASUN}', '${sessionId}', 1500, '${shift(-2)}')`,
          ),
        /duplicate key|unique/i,
        'the unique index stops it',
      );
    },
  },

  {
    name: 'a class must either repeat or have a single date',
    async run(db, t) {
      await t.throws(
        () =>
          db.query(
            `insert into classes (teacher_id, subject, grade, title, days, start_time)
             values ('${TEACHER}', 'Maths', 11, 'Nowhere class', '{}', '16:00')`,
          ),
        /classes_repeat_ck/,
        'the check constraint holds',
      );
    },
  },

  {
    name: 'deleting a teacher takes their data with them',
    async run(db, t) {
      await db.query(`delete from teachers where id = '${TEACHER}'`);
      for (const table of ['students', 'classes', 'charges', 'payments', 'marks', 'events']) {
        const [{ n }] = await db.rows(
          `select count(*) n from ${table} where teacher_id = '${TEACHER}'`,
        );
        t.equal(Number(n), 0, `${table} cascaded`);
      }
    },
  },
];

/* ------------------------------------------------------------------- run */

async function main() {
  const target = parseDatabaseUrl(process.env.DATABASE_URL);
  console.log(`\nVerifying ${target.host} (timezone ${TZ}, today ${todayThere()})\n`);

  const db = await connect(target);
  let passed = 0;
  let failed = 0;

  try {
    await db.query('begin');

    for (const check of checks) {
      const results = [];
      const t = {
        ok(value, label) {
          results.push([Boolean(value), label]);
        },
        equal(actual, expected, label) {
          const same = String(actual) === String(expected);
          results.push([same, same ? label : `${label} (got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)})`]);
        },
        async throws(fn, pattern, label) {
          try {
            await fn();
            results.push([false, `${label} - but nothing was raised`]);
          } catch (err) {
            const message = err instanceof PgError ? `${err.code} ${err.message}` : err.message;
            results.push([pattern.test(message), pattern.test(message) ? label : `${label} (raised: ${message})`]);
          }
        },
      };

      await db.query('savepoint check_point');
      try {
        await db.query(fixture);
        await check.run(db, t);
      } catch (err) {
        const message = err instanceof PgError ? err.describe() : err.message;
        results.push([false, `the check itself failed: ${message}`]);
      }
      // A raised exception inside the transaction needs the savepoint restored.
      await db.query('rollback to savepoint check_point').catch(() => {});

      const bad = results.filter(([good]) => !good);
      if (bad.length === 0) {
        console.log(`  PASS  ${check.name}`);
        passed += 1;
      } else {
        console.log(`  FAIL  ${check.name}`);
        for (const [, label] of bad) console.log(`          ${label}`);
        failed += 1;
      }
    }
  } finally {
    await db.query('rollback').catch(() => {});
    db.end();
  }

  console.log(`\n  ${passed} passed, ${failed} failed. Nothing was committed.\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n${err instanceof PgError ? err.describe() : err.message}\n`);
  process.exit(1);
});
