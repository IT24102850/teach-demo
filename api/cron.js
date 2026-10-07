/**
 * /api/cron  -  the scheduled jobs the prototype only pretended to run
 * (section 10: "a switch and days are saved but nothing runs").
 *
 * Vercel calls this once a day from the `crons` entry in vercel.json, with
 * `Authorization: Bearer $CRON_SECRET`. Two jobs run:
 *
 *   1. Auto fee reminders - every teacher who has them on gets a reminder sent
 *      to the parents whose fees are later than their "remind after" setting,
 *      and no more often than that setting.
 *   2. Tomorrow's class reminders - one message per family per class, marked on
 *      the session so it is never sent twice.
 */

import * as db from './_lib/db.js';
import { bad, guard, ok, query } from './_lib/http.js';
import * as R from './_lib/rules.js';
import { FEED, render } from './_lib/templates.js';
import { sendWhatsApp } from './_lib/whatsapp.js';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function authorised(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // not configured: allow, but the job is also harmless
  const header = String(req.headers.authorization || '');
  return header === `Bearer ${secret}` || query(req).key === secret;
}

async function record(tid, student, type, text, feedText) {
  const result = await sendWhatsApp(student.parent_phone, text);
  await db.insert(
    'events',
    {
      teacher_id: tid,
      student_id: student.id,
      type,
      text: feedText,
      channel: 'whatsapp',
      delivery_status: result.status === 'sent' ? 'sent' : result.status,
      delivery_error: result.error || null,
    },
    { returning: 'minimal' },
  );
  return result.status;
}

async function feeReminders(teachers) {
  let sent = 0;
  for (const teacher of teachers) {
    if (!teacher.auto_reminders) continue;
    const after = Number(teacher.remind_after_days) || 14;
    const name = `${teacher.name}${teacher.title ? ` ${teacher.title}` : ''}`;

    const students = await db.select('v_students', {
      select: 'id,name,parent_phone,amount_due,pending_classes,days_late,last_reminded_at',
      teacher_id: `eq.${teacher.id}`,
      status: 'eq.active',
      days_late: `gte.${after}`,
    });

    for (const student of students) {
      if (Number(student.amount_due) <= 0) continue;
      // Do not nag: at most one automatic reminder per "remind after" period.
      if (student.last_reminded_at) {
        const days = (Date.now() - Date.parse(student.last_reminded_at)) / 86_400_000;
        if (days < after) continue;
      }
      const text = render(
        'fee',
        {
          teacher: name,
          student: student.name,
          classes: student.pending_classes,
          amount: student.amount_due,
        },
        teacher.lang,
      );
      await record(
        teacher.id,
        student,
        'fee',
        text,
        FEED.fee({ classes: student.pending_classes, amount: student.amount_due }),
      );
      await db.update(
        'students',
        { last_reminded_at: new Date().toISOString() },
        { id: `eq.${student.id}` },
      );
      sent += 1;
    }
  }
  return sent;
}

async function classReminders(teachers) {
  const tomorrow = R.addDays(R.today(), 1);
  let sent = 0;

  for (const teacher of teachers) {
    const name = `${teacher.name}${teacher.title ? ` ${teacher.title}` : ''}`;
    const classes = await db.select('classes', {
      select: 'id,subject,title,place,days,start_time,start_date,once_date,active,class_students(student_id),class_exceptions(skip_date)',
      teacher_id: `eq.${teacher.id}`,
      active: 'is.true',
    });
    const prepared = classes.map((c) => ({
      ...c,
      student_ids: (c.class_students || []).map((x) => x.student_id),
      skips: (c.class_exceptions || []).map((x) => x.skip_date),
    }));
    const skips = new Set(prepared.flatMap((c) => c.skips.map((d) => `${c.id}|${d}`)));
    const due = R.sessionsOn(prepared, tomorrow, skips);
    if (!due.length) continue;

    const already = await db.select('sessions', {
      select: 'class_id,notified_at',
      teacher_id: `eq.${teacher.id}`,
      session_date: `eq.${tomorrow}`,
    });
    const notified = new Set(already.filter((s) => s.notified_at).map((s) => s.class_id));

    for (const { cls } of due) {
      if (notified.has(cls.id) || !cls.student_ids.length) continue;

      const students = await db.select('students', {
        select: 'id,name,parent_phone',
        id: db.inList(cls.student_ids),
        status: 'eq.active',
      });
      for (const student of students) {
        const text = render(
          'classReminder',
          {
            student: student.name,
            subject: cls.subject,
            day: DAY_NAMES[R.weekday(tomorrow)],
            time: R.hhmm(cls.start_time),
            place: cls.place || '',
          },
          teacher.lang,
        );
        await record(
          teacher.id,
          student,
          'class',
          text,
          FEED.class({
            subject: cls.subject,
            day: DAY_NAMES[R.weekday(tomorrow)],
            time: R.hhmm(cls.start_time),
          }),
        );
        sent += 1;
      }

      await db.insert(
        'sessions',
        {
          class_id: cls.id,
          teacher_id: teacher.id,
          session_date: tomorrow,
          notified_at: new Date().toISOString(),
        },
        { onConflict: 'class_id,session_date', returning: 'minimal' },
      );
    }
  }
  return sent;
}

export default guard(async (req, res) => {
  if (!authorised(req)) return bad(res, 'Not allowed', 401);
  if (!db.configured) return bad(res, 'Supabase is not configured', 503);

  const only = query(req).job;
  const teachers = await db.select('teachers', {
    select: 'id,name,title,lang,auto_reminders,remind_after_days',
  });

  const result = { ran_at: new Date().toISOString(), date: R.today() };
  if (!only || only === 'fees') result.fee_reminders = await feeReminders(teachers);
  if (!only || only === 'classes') result.class_reminders = await classReminders(teachers);

  // Keep the rate-limit table from growing forever.
  await db
    .remove('login_attempts', { created_at: `lt.${new Date(Date.now() - 7 * 864e5).toISOString()}` })
    .catch(() => {});

  return ok(res, result);
});
