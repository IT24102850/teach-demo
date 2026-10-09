/**
 * /api/teacher  -  everything the teacher's four tabs need.
 *
 * One serverless function with `?r=<resource>` routing, so the whole app stays
 * well inside Vercel's function count. Every query is scoped by the teacher id
 * that came out of the signed session cookie - never by anything the browser
 * sent - so a teacher can only ever reach their own rows.
 */

import * as db from './_lib/db.js';
import { bad, guard, json, ok, query, readJson, resource } from './_lib/http.js';
import { codeLookup, hashCode, randomCode } from './_lib/session.js';
import { teacherSession } from './_lib/session.js';
import * as R from './_lib/rules.js';
import { FEED, render } from './_lib/templates.js';
import { sendWhatsApp, waLink } from './_lib/whatsapp.js';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/* Point 11: the three ways a parent can pay, plus the bank slip. */
const PAYMENT_METHODS = ['Cash', 'Bank transfer', 'Online', 'Slip'];

const STUDENT_FIELDS =
  'id,name,call_name,grade,school,area,curriculum,subject,wanted_subjects,ambition,' +
  'fee_per_class,parent_name,parent_occupation,parent_phone,status,slip_path,slip_sent_at,' +
  'last_reminded_at,created_at,amount_due,pending_classes,oldest_unpaid,paid_total,days_late,' +
  'hist,total_classes,present_classes,mark_count,avg_pct,best_pct,first_pct,latest_pct';

/* --------------------------------------------------------------- loading -- */

async function loadClasses(tid) {
  const rows = await db.select('classes', {
    select: '*,class_students(student_id),class_exceptions(skip_date)',
    teacher_id: `eq.${tid}`,
    active: 'is.true',
    order: 'start_time.asc',
  });
  return rows.map((c) => ({
    ...c,
    class_students: undefined,
    class_exceptions: undefined,
    student_ids: (c.class_students || []).map((x) => x.student_id),
    skips: (c.class_exceptions || []).map((x) => x.skip_date),
  }));
}

async function loadSessions(tid, from, to) {
  const rows = await db.select('sessions', {
    select:
      'id,class_id,session_date,status,notified_at,started_at,ended_at,' +
      'attendance(student_id,present)',
    teacher_id: `eq.${tid}`,
    and: `(session_date.gte.${from},session_date.lte.${to})`,
    order: 'session_date.asc',
  });
  return rows.map((s) => ({
    id: s.id,
    class_id: s.class_id,
    date: s.session_date,
    status: s.status,
    notified_at: s.notified_at,
    // Point 10: the clock times behind "In progress" and "Ended".
    started_at: s.started_at,
    ended_at: s.ended_at,
    absent: (s.attendance || []).filter((a) => !a.present).map((a) => a.student_id),
    present: (s.attendance || []).filter((a) => a.present).map((a) => a.student_id),
  }));
}

async function bootstrap(req, tid) {
  const today = R.today();
  const from = R.addDays(today, -200);
  const to = R.addDays(today, 90);

  const [
    teacher,
    students,
    classes,
    sessions,
    papers,
    sales,
    events,
    months,
    reschedules,
    marks,
    payments,
  ] = await Promise.all([
      db.selectOne('teachers', { id: `eq.${tid}` }),
      db.select('v_students', {
        select: STUDENT_FIELDS,
        teacher_id: `eq.${tid}`,
        status: 'neq.archived',
        order: 'name.asc',
      }),
      loadClasses(tid),
      loadSessions(tid, from, to),
      db.select('papers', { teacher_id: `eq.${tid}`, order: 'created_at.asc' }),
      db.select('paper_sales', { select: 'paper_id,price,sold_on', teacher_id: `eq.${tid}` }),
      db.select('events', {
        select: 'id,student_id,type,text,channel,delivery_status,created_at',
        teacher_id: `eq.${tid}`,
        order: 'created_at.desc',
        limit: 40,
      }),
      db.select('teacher_months', { teacher_id: `eq.${tid}`, order: 'month.asc' }),
      db.select('reschedule_requests', {
        select: 'id,student_id,class_id,session_date,note,status,created_at',
        teacher_id: `eq.${tid}`,
        status: 'eq.open',
        order: 'created_at.desc',
      }),
      db.select('marks', {
        select: 'id,student_id,title,score,max_score,taken_on',
        teacher_id: `eq.${tid}`,
        order: 'taken_on.asc',
      }),
      // Point 11: the recent receipts, so the student screen can show the
      // history and offer Undo after the ten seconds on the result screen.
      db.select('payments', {
        select: 'id,student_id,amount,method,paid_date,receipt_no,reversed_at,created_at',
        teacher_id: `eq.${tid}`,
        order: 'created_at.desc',
        limit: 60,
      }),
    ]);

  if (!teacher) return null;
  delete teacher.code_hash;
  delete teacher.code_salt;
  delete teacher.code_lookup;

  const soldByPaper = {};
  for (const s of sales) {
    soldByPaper[s.paper_id] = soldByPaper[s.paper_id] || { sold: 0, revenue: 0 };
    soldByPaper[s.paper_id].sold += 1;
    soldByPaper[s.paper_id].revenue += Number(s.price);
  }

  return {
    today,
    window: { from, to },
    teacher,
    students,
    classes,
    sessions,
    events,
    months,
    reschedules,
    marks,
    payments,
    papers: papers.map((p) => ({
      ...p,
      sold: soldByPaper[p.id]?.sold || 0,
      revenue: soldByPaper[p.id]?.revenue || 0,
    })),
    whatsapp_server: Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID),
  };
}

/* ---------------------------------------------------------------- helpers -- */

const mustStudent = async (tid, id, fields = STUDENT_FIELDS) => {
  const s = await db.selectOne('v_students', { select: fields, id: `eq.${id}`, teacher_id: `eq.${tid}` });
  if (!s) throw Object.assign(new Error('Student not found'), { status: 404 });
  return s;
};

const mustClass = async (tid, id) => {
  const c = await db.selectOne('classes', {
    select: '*,class_students(student_id)',
    id: `eq.${id}`,
    teacher_id: `eq.${tid}`,
  });
  if (!c) throw Object.assign(new Error('Class not found'), { status: 404 });
  c.student_ids = (c.class_students || []).map((x) => x.student_id);
  return c;
};

const teacherName = (t) => `${t.name}${t.title ? ` ${t.title}` : ''}`;

/**
 * Point 13: a clash is not an error the teacher has to decode. 409 carries the
 * class that is in the way, so the sheet can name it and offer "Save anyway".
 */
const clashReply = (res, clash) =>
  json(res, 409, {
    error: `That overlaps ${clash.title} (${R.hhmm(clash.start_time)}).`,
    clash: { id: clash.id, title: clash.title, start_time: R.hhmm(clash.start_time) },
  });

/**
 * Send a message to a parent and record it as one event. Works with or without
 * the WhatsApp Cloud API: without it, `link` comes back and the browser opens
 * WhatsApp with the text ready (section 10).
 */
async function notifyParent({ tid, student, type, text, feedText, lang }) {
  const result = await sendWhatsApp(student.parent_phone, text);
  const [event] = await db.insert('events', {
    teacher_id: tid,
    student_id: student.id,
    type,
    text: feedText || text,
    channel: 'whatsapp',
    delivery_status: result.status === 'sent' ? 'sent' : result.status,
    delivery_error: result.error || null,
  });
  return { event, link: result.link || null, status: result.status, lang };
}

/** An ISO timestamp, or null when the browser sent nothing usable. */
function isoOrNull(value) {
  if (!value) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

/**
 * Point 10: the absent message. One wording, used by "Send now" during the
 * class, by "End class", and by "Resend" afterwards - so the teacher always
 * sees the text that actually went out.
 */
async function sendAbsent({ tid, student, cls, date, teacher, lang, override }) {
  const text =
    String(override || '').trim() ||
    render(
      'absent',
      {
        student: student.name,
        subject: cls.subject,
        teacher: teacherName(teacher),
        class: cls.title,
        time: R.hhmm(cls.start_time),
      },
      lang,
    );
  const result = await notifyParent({
    tid,
    student,
    type: 'absent',
    text,
    feedText: FEED.absent({ subject: cls.subject }),
    lang,
  });
  return {
    student_id: student.id,
    name: student.name,
    text,
    date,
    status: result.status,
    link: result.link,
  };
}

/**
 * The exact text of a message, so the preview the teacher approves is the text
 * that is actually sent - one builder, two callers.
 */
async function messageText(kind, tid, studentId, teacher) {
  const lang = teacher.lang || 'en';
  const tname = teacherName(teacher);

  if (kind === 'fee') {
    const s = await mustStudent(tid, studentId, 'id,name,parent_phone,amount_due,pending_classes');
    return {
      student: s,
      text: render(
        'fee',
        { teacher: tname, student: s.name, classes: s.pending_classes, amount: s.amount_due },
        lang,
      ),
    };
  }
  if (kind === 'report') {
    const s = await mustStudent(tid, studentId);
    const present = [...(s.hist || '')].filter((c) => c === 'P').length;
    return {
      student: s,
      text: render(
        'report',
        {
          student: s.name,
          present,
          total: (s.hist || '').length,
          percent: R.attendancePct(s.hist),
          avg: s.avg_pct ?? 0,
          amount: s.amount_due,
        },
        lang,
      ),
    };
  }
  throw Object.assign(new Error(`Unknown message: ${kind}`), { status: 400 });
}

/* -------------------------------------------------------------- resources -- */

async function handlePost(req, res, tid, r) {
  const body = await readJson(req);
  const teacher = await db.selectOne('teachers', { id: `eq.${tid}` });
  const lang = teacher.lang || 'en';
  const tname = teacherName(teacher);

  switch (r) {
    /* ---- classes ---- */
    case 'class.create': {
      const studentIds = Array.isArray(body.student_ids) ? body.student_ids.filter(Boolean) : [];
      const owned = studentIds.length
        ? await db.select('students', {
            select: 'id,grade,area',
            teacher_id: `eq.${tid}`,
            id: db.inList(studentIds),
          })
        : [];
      if (owned.length !== studentIds.length) return bad(res, 'Some students are not yours', 403);

      const once = body.once_date || null;
      const days = Array.isArray(body.days)
        ? [...new Set(body.days.map(Number).filter((d) => d >= 0 && d <= 6))]
        : [];

      // Point 12: the kind is what the teacher chose, not a guess from how
      // many students were picked, and the venue question that goes with that
      // kind must have been answered.
      const kind = R.CLASS_KINDS.includes(body.kind)
        ? body.kind
        : R.classKind({ student_ids: studentIds });
      // An individual class is always at an area; only a group is asked where.
      const venueType =
        kind === 'individual'
          ? 'area'
          : R.VENUE_TYPES.includes(body.venue_type)
            ? body.venue_type
            : 'area';

      const draft = {
        kind,
        venue_type: venueType,
        venue_name: body.venue_name,
        // Point 12: at the teacher's own place the area comes from Settings -
        // that is the whole point of saving it there. Anywhere else it is
        // what was typed, falling back to the student's own area.
        area:
          venueType === 'own_place'
            ? teacher.own_place_area || body.area || ''
            : body.area || body.place || owned[0]?.area || '',
        student_ids: studentIds,
        days,
        once_date: once,
        start_time: body.start_time,
        duration_hours: Number(body.duration_hours) || 1,
      };

      const problem = R.classDraftError(draft);
      if (problem) return bad(res, problem);

      // Point 13: an overlap is refused unless the teacher chose "Save anyway".
      if (!body.allow_clash) {
        const clash = R.findClash(await loadClasses(tid), { ...draft, id: null });
        if (clash) return clashReply(res, clash);
      }

      const grade = Number(body.grade) || owned[0]?.grade || 0;
      const subject = body.subject || 'Maths';
      const [cls] = await db.insert('classes', {
        teacher_id: tid,
        subject,
        curriculum: body.curriculum || 'Local',
        grade,
        title: body.title || R.classTitle(grade, subject, studentIds.length),
        kind: draft.kind,
        venue_type: draft.venue_type,
        venue_name: draft.venue_type === 'institute' ? String(draft.venue_name).trim() : null,
        area: draft.area,
        // `place` is still filled in, so the message templates and any older
        // screen that reads it keep working. The venue fields above are what
        // the app itself now uses.
        place: R.venueLabel(draft, { ownPlaceName: teacher.own_place_name || 'My home' }),
        days: once ? [] : days,
        start_time: body.start_time,
        duration_hours: Number(body.duration_hours) || 1,
        start_date: body.start_date || R.today(),
        once_date: once,
      });
      await db.insert(
        'class_students',
        studentIds.map((id) => ({ class_id: cls.id, student_id: id })),
        { returning: 'minimal' },
      );
      return ok(res, { class_id: cls.id, title: cls.title, first_date: once || null });
    }

    /**
     * Point 9: "Edit" on a class in the calendar. This changes when and where
     * the class runs; who is in it is changed from the class screen.
     */
    case 'class.update': {
      const cls = await mustClass(tid, body.class_id);
      const once = body.once_date === undefined ? cls.once_date : body.once_date || null;
      const days =
        body.days === undefined
          ? cls.days || []
          : [...new Set((body.days || []).map(Number).filter((d) => d >= 0 && d <= 6))];

      const kind = R.CLASS_KINDS.includes(body.kind) ? body.kind : R.classKind(cls);
      const venueType =
        kind === 'individual'
          ? 'area'
          : R.VENUE_TYPES.includes(body.venue_type)
            ? body.venue_type
            : cls.venue_type || 'area';

      const draft = {
        id: cls.id,
        kind,
        venue_type: venueType,
        venue_name: body.venue_name === undefined ? cls.venue_name : body.venue_name,
        area:
          venueType === 'own_place'
            ? teacher.own_place_area || body.area || cls.area || ''
            : (body.area === undefined ? cls.area || cls.place : body.area) || '',
        student_ids: cls.student_ids,
        days,
        once_date: once,
        start_date: cls.start_date,
        start_time: body.start_time || R.hhmm(cls.start_time),
        duration_hours: Number(body.duration_hours ?? cls.duration_hours) || 0,
      };

      const problem = R.classDraftError(draft);
      if (problem) return bad(res, problem);

      if (!body.allow_clash) {
        const clash = R.findClash(await loadClasses(tid), draft);
        if (clash) return clashReply(res, clash);
      }

      await db.update(
        'classes',
        {
          kind: draft.kind,
          venue_type: draft.venue_type,
          venue_name: draft.venue_type === 'institute' ? String(draft.venue_name).trim() : null,
          area: draft.area,
          place: R.venueLabel(draft, { ownPlaceName: teacher.own_place_name || 'My home' }),
          days: once ? [] : days,
          once_date: once,
          start_time: draft.start_time,
          duration_hours: draft.duration_hours,
        },
        { id: `eq.${cls.id}`, teacher_id: `eq.${tid}` },
      );
      return ok(res, { saved: true, class_id: cls.id });
    }

    case 'class.delete': {
      await mustClass(tid, body.class_id);
      // Keep the history: the class stops appearing on the calendar, but past
      // sessions, charges and marks stay exactly as they were.
      await db.update('classes', { active: false }, { id: `eq.${body.class_id}` });
      return ok(res, { removed: true });
    }

    case 'class.skip': {
      await mustClass(tid, body.class_id);
      if (!body.date) return bad(res, 'Pick a date');
      await db.insert(
        'class_exceptions',
        { class_id: body.class_id, skip_date: body.date, reason: body.reason || null },
        { onConflict: 'class_id,skip_date', returning: 'minimal' },
      );
      return ok(res, { skipped: body.date });
    }

    case 'class.unskip': {
      await mustClass(tid, body.class_id);
      await db.remove('class_exceptions', {
        class_id: `eq.${body.class_id}`,
        skip_date: `eq.${body.date}`,
      });
      return ok(res, { restored: body.date });
    }

    /* ---- attendance: Scheduled -> In progress -> Ended (point 10) ---- */

    /**
     * "Start class". Records the real start time and nothing else, so the
     * class can sit in progress for as long as the lesson takes. Tapping it
     * twice does not restart the clock - the database keeps the first time.
     */
    case 'attendance.start': {
      const cls = await mustClass(tid, body.class_id);
      const date = body.date || R.today();
      const started = await db.rpc('start_class', {
        p_teacher: tid,
        p_class: cls.id,
        p_date: date,
      });
      return ok(res, { started_at: started, class_id: cls.id, date });
    }

    /**
     * "End class". One statement in the database writes the session, the
     * attendance and the charges together, so a half-saved class cannot
     * happen (rule 7.2.2). Then the absent parents are told - point 10 moves
     * that to the end of the class rather than the moment it was saved.
     */
    case 'attendance.finish': {
      const cls = await mustClass(tid, body.class_id);
      const date = body.date || R.today();
      const absent = (Array.isArray(body.absent) ? body.absent : []).filter((id) =>
        cls.student_ids.includes(id),
      );

      // "Use scheduled time" for a teacher who forgot to press Start: the
      // browser sends the scheduled start, and the length taught comes out as
      // the length that was planned.
      const started = isoOrNull(body.started_at);
      const ended = isoOrNull(body.ended_at);

      const sessionId = await db.rpc('finish_class', {
        p_teacher: tid,
        p_class: cls.id,
        p_date: date,
        p_absent: absent,
        p_started: started,
        p_ended: ended,
      });

      // Each absent student gets exactly one message: a parent already told
      // with "Send now" during the class is not told twice.
      const alreadyTold = new Set(
        Array.isArray(body.already_notified)
          ? body.already_notified.filter((id) => absent.includes(id))
          : [],
      );
      const toTell = absent.filter((id) => !alreadyTold.has(id));

      const sent = [];
      if (toTell.length) {
        const kids = await db.select('students', {
          select: 'id,name,parent_phone',
          id: db.inList(toTell),
        });
        for (const student of kids) {
          sent.push(await sendAbsent({ tid, student, cls, date, teacher, lang }));
        }
      }

      const saved = await db.selectOne('sessions', {
        select: 'id,started_at,ended_at',
        id: `eq.${sessionId}`,
      });

      return ok(res, {
        saved: true,
        session_id: sessionId,
        started_at: saved?.started_at || null,
        ended_at: saved?.ended_at || null,
        taught_minutes: R.taughtMinutes(saved || {}),
        absent: absent.length,
        present: cls.student_ids.length - absent.length,
        messages: sent.map((x) => ({
          student_id: x.student_id,
          name: x.name,
          text: x.text,
          status: x.status,
          link: x.link,
        })),
      });
    }

    /**
     * "Send now": the link under the absent warning, for a teacher who wants
     * to reach the parent while the class is still running.
     */
    case 'attendance.absent_now': {
      const cls = await mustClass(tid, body.class_id);
      const date = body.date || R.today();
      if (!cls.student_ids.includes(body.student_id)) {
        return bad(res, 'That student is not in this class', 404);
      }
      const student = await mustStudent(tid, body.student_id, 'id,name,parent_phone');
      const result = await sendAbsent({ tid, student, cls, date, teacher, lang });
      return ok(res, result);
    }

    /** "Not sent" on the ended screen: try that one message again. */
    case 'attendance.resend': {
      const cls = await mustClass(tid, body.class_id);
      const date = body.date || R.today();
      const student = await mustStudent(tid, body.student_id, 'id,name,parent_phone');
      const result = await sendAbsent({
        tid,
        student,
        cls,
        date,
        teacher,
        lang,
        override: body.text,
      });
      return ok(res, result);
    }

    /**
     * "Start/End time wrong?" - correct the clock times after the class, so
     * the hours on the dashboard can be put right without re-marking anyone.
     */
    case 'attendance.fix_times': {
      const cls = await mustClass(tid, body.class_id);
      const date = body.date || R.today();
      const started = isoOrNull(body.started_at);
      const ended = isoOrNull(body.ended_at);
      if (!started || !ended) return bad(res, 'Enter both a start and an end time');
      if (Date.parse(ended) <= Date.parse(started)) {
        return bad(res, 'The class cannot end before it started');
      }
      const [row] = await db.update(
        'sessions',
        { started_at: started, ended_at: ended },
        { class_id: `eq.${cls.id}`, session_date: `eq.${date}`, teacher_id: `eq.${tid}` },
      );
      if (!row) return bad(res, 'That class has not been marked yet', 404);
      return ok(res, {
        saved: true,
        started_at: row.started_at,
        ended_at: row.ended_at,
        taught_minutes: R.taughtMinutes(row),
      });
    }

    case 'session.notify': {
      const cls = await mustClass(tid, body.class_id);
      const date = body.date || R.today();
      const [session] = await db.insert(
        'sessions',
        {
          class_id: cls.id,
          teacher_id: tid,
          session_date: date,
          notified_at: new Date().toISOString(),
        },
        { onConflict: 'class_id,session_date' },
      );
      const kids = await db.select('students', {
        select: 'id,name,parent_phone',
        id: db.inList(cls.student_ids),
      });
      const results = [];
      for (const student of kids) {
        const text = render(
          'classReminder',
          {
            student: student.name,
            subject: cls.subject,
            day: date === R.today() ? 'today' : DAY_NAMES[R.weekday(date)],
            time: R.hhmm(cls.start_time),
            place: cls.place || '',
          },
          lang,
        );
        results.push(
          await notifyParent({
            tid,
            student,
            type: 'class',
            text,
            feedText: FEED.class({
              subject: cls.subject,
              day: DAY_NAMES[R.weekday(date)],
              time: R.hhmm(cls.start_time),
            }),
            lang,
          }),
        );
      }
      return ok(res, {
        notified: results.length,
        session_id: session?.id,
        messages: results.map((x) => ({ status: x.status, link: x.link })),
      });
    }

    /* ---- students ---- */
    case 'student.create': {
      if (!body.name?.trim()) return bad(res, 'Name is required');
      // Point 3: the same rule as the join form. Adding a student by hand
      // cannot smuggle in a number WhatsApp will not accept.
      const phone = R.toLkMobile(body.parent_phone);
      if (!phone) {
        return bad(res, 'Enter a Sri Lankan mobile number: 9 digits starting with 7');
      }
      const name = body.name.trim();
      const [student] = await db.insert('students', {
        teacher_id: tid,
        name,
        call_name: String(body.call_name || '').trim() || name.split(/\s+/)[0],
        grade: Number(body.grade) || null,
        school: body.school || null,
        area: body.area || null,
        curriculum: body.curriculum || 'Local',
        subject: body.subject || null,
        wanted_subjects: body.subject ? [body.subject] : [],
        ambition: String(body.ambition || '').trim() || null,
        fee_per_class: Number(body.fee_per_class) || 0,
        parent_name: body.parent_name || null,
        parent_occupation: String(body.parent_occupation || '').trim() || null,
        parent_phone: phone,
        status: Number(body.fee_per_class) > 0 ? 'active' : 'pending',
      });
      return ok(res, { student_id: student.id, status: student.status });
    }

    case 'student.update': {
      await mustStudent(tid, body.student_id, 'id');
      const patch = {};
      for (const key of [
        'name',
        'call_name',
        'grade',
        'school',
        'area',
        'curriculum',
        'subject',
        'ambition',
        'parent_name',
        'parent_occupation',
      ]) {
        if (body[key] !== undefined) patch[key] = body[key];
      }
      if (body.fee_per_class !== undefined) patch.fee_per_class = Number(body.fee_per_class) || 0;
      if (body.parent_phone !== undefined) {
        // Point 3: editing a number is held to the same rule as entering one.
        const phone = R.toLkMobile(body.parent_phone);
        if (!phone) {
          return bad(res, 'Enter a Sri Lankan mobile number: 9 digits starting with 7');
        }
        patch.parent_phone = phone;
      }
      if (!Object.keys(patch).length) return bad(res, 'Nothing to change');
      await db.update('students', patch, { id: `eq.${body.student_id}`, teacher_id: `eq.${tid}` });
      return ok(res, { saved: true });
    }

    /**
     * Rule 7.7.3/7.7.4: set the fee, approve the student, make a family code
     * that is not already in use and send it to the parent.
     */
    case 'student.confirm': {
      const student = await mustStudent(tid, body.student_id, 'id,name,parent_phone,status');
      const fee = Number(body.fee_per_class);
      if (!fee || fee <= 0) return bad(res, 'Enter a fee per class');

      await db.update(
        'students',
        { fee_per_class: fee, status: 'active' },
        { id: `eq.${student.id}`, teacher_id: `eq.${tid}` },
      );

      // Already has a code? Re-send it instead of making a second one.
      const existing = await db.selectOne('family_children', {
        select: 'account_id',
        student_id: `eq.${student.id}`,
      });

      let code = null;
      let accountId = existing?.account_id || null;

      if (!accountId) {
        for (let attempt = 0; attempt < 30 && !code; attempt += 1) {
          const candidate = randomCode();
          const lookup = codeLookup(candidate);
          const [clashA, clashB] = await Promise.all([
            db.selectOne('family_accounts', { select: 'id', code_lookup: `eq.${lookup}` }),
            db.selectOne('teachers', { select: 'id', code_lookup: `eq.${lookup}` }),
          ]);
          if (!clashA && !clashB) code = candidate;
        }
        if (!code) return bad(res, 'Could not make a free code - increase CODE_LENGTH', 500);

        const { hash, salt } = hashCode(code);
        const [account] = await db.insert('family_accounts', {
          teacher_id: tid,
          label: `${student.name}'s family`,
          phone: student.parent_phone,
          code_lookup: codeLookup(code),
          code_hash: hash,
          code_salt: salt,
        });
        accountId = account.id;
        await db.insert(
          'family_children',
          { account_id: accountId, student_id: student.id },
          { onConflict: 'account_id,student_id', returning: 'minimal' },
        );
      }

      const text = code
        ? render('code', { teacher: tname, code }, lang)
        : render('invite', { teacher: tname, link: body.app_url || '' }, lang);
      const result = await notifyParent({
        tid,
        student,
        type: 'join',
        text,
        feedText: code ? FEED.join({ code }) : 'Welcome!',
        lang,
      });

      // The code is shown to the teacher once, so they can read it out if the
      // WhatsApp message does not arrive. It is only ever stored hashed.
      return ok(res, { code, link: result.link, status: result.status, had_code: !code });
    }

    /**
     * Replace a family's code. Because codes are stored hashed, a lost code
     * cannot be read back - the teacher issues a new one and it is shown once.
     */
    case 'student.newcode': {
      const student = await mustStudent(tid, body.student_id, 'id,name,parent_phone');
      let code = null;
      for (let attempt = 0; attempt < 30 && !code; attempt += 1) {
        const candidate = randomCode();
        const lookup = codeLookup(candidate);
        const [clashA, clashB] = await Promise.all([
          db.selectOne('family_accounts', { select: 'id', code_lookup: `eq.${lookup}` }),
          db.selectOne('teachers', { select: 'id', code_lookup: `eq.${lookup}` }),
        ]);
        if (!clashA && !clashB) code = candidate;
      }
      if (!code) return bad(res, 'Could not make a free code - increase CODE_LENGTH', 500);

      const { hash, salt } = hashCode(code);
      const existing = await db.selectOne('family_children', {
        select: 'account_id',
        student_id: `eq.${student.id}`,
      });

      if (existing) {
        await db.update(
          'family_accounts',
          { code_lookup: codeLookup(code), code_hash: hash, code_salt: salt },
          { id: `eq.${existing.account_id}`, teacher_id: `eq.${tid}` },
        );
      } else {
        const [account] = await db.insert('family_accounts', {
          teacher_id: tid,
          label: `${student.name}'s family`,
          phone: student.parent_phone,
          code_lookup: codeLookup(code),
          code_hash: hash,
          code_salt: salt,
        });
        await db.insert(
          'family_children',
          { account_id: account.id, student_id: student.id },
          { onConflict: 'account_id,student_id', returning: 'minimal' },
        );
      }

      const result = await notifyParent({
        tid,
        student,
        type: 'join',
        text: render('code', { teacher: tname, code }, lang),
        feedText: 'A new family code was sent',
        lang,
      });
      return ok(res, { code, link: result.link, status: result.status });
    }

    /* ---- money (point 11) ---- */

    /**
     * Record a payment: the whole bill, or any part of it.
     *
     * The amount is decided in the database, which clamps it to what is
     * actually owed, so a mistyped extra zero can never create a credit. The
     * receipt number comes back with it and goes to the parent, unless the
     * teacher turned the receipt off.
     */
    case 'payment.record': {
      const student = await mustStudent(tid, body.student_id, 'id,name,parent_phone,amount_due');
      if (Number(student.amount_due) <= 0) return bad(res, 'Nothing is owed');

      if (body.amount !== undefined && body.amount !== null && body.amount !== '') {
        const asked = Number(body.amount);
        if (!Number.isFinite(asked) || asked <= 0) return bad(res, 'Enter an amount');
      }

      const result = await db.rpc('record_payment', {
        p_teacher: tid,
        p_student: student.id,
        p_classes: body.classes ? Number(body.classes) : null,
        p_amount:
          body.amount === undefined || body.amount === null || body.amount === ''
            ? null
            : Number(body.amount),
        p_method: PAYMENT_METHODS.includes(body.method) ? body.method : 'Bank transfer',
        p_paid_date: body.paid_date || null,
      });

      const receipt = R.receiptNo(result.receipt_no);
      const amount = Number(result.amount);
      const balance = Number(result.balance);

      // The tick in the sheet is on by default, but a teacher who is standing
      // next to the parent can turn it off.
      let sent = { status: 'none', link: null };
      if (body.send_receipt !== false) {
        sent = await notifyParent({
          tid,
          student,
          type: 'paid',
          text: render('paid', { student: student.name, amount, receipt, balance }, lang),
          feedText: FEED.paid({ amount, receipt }),
          lang,
        });
      }

      return ok(res, {
        payment_id: result.payment_id,
        amount,
        balance,
        full: Boolean(result.full),
        receipt,
        receipt_no: result.receipt_no,
        link: sent.link || null,
        status: sent.status,
      });
    }

    /**
     * Undo. Within the ten seconds the result screen offers it, and later from
     * the student's payment history. The row is marked reversed, never
     * deleted, so the history still explains the balance.
     */
    case 'payment.reverse': {
      const result = await db.rpc('reverse_payment', {
        p_teacher: tid,
        p_payment: body.payment_id,
      });
      const student = await mustStudent(tid, result.student_id, 'id,name,parent_phone,amount_due');
      await db.insert(
        'events',
        {
          teacher_id: tid,
          student_id: student.id,
          type: 'paid',
          text: FEED.reversed({ amount: Number(result.amount) }),
        },
        { returning: 'minimal' },
      );
      return ok(res, {
        reversed: true,
        amount: Number(result.amount),
        balance: Number(student.amount_due),
      });
    }

    case 'payment.confirm_slip': {
      // Rule 7.2.6: confirming a slip pays the full amount owed.
      const student = await mustStudent(tid, body.student_id, 'id,name,parent_phone,amount_due');
      if (Number(student.amount_due) <= 0) return bad(res, 'Nothing is owed');
      const result = await db.rpc('record_payment', {
        p_teacher: tid,
        p_student: student.id,
        p_classes: null,
        p_amount: null,
        p_method: 'Slip',
        p_paid_date: body.paid_date || null,
      });
      const receipt = R.receiptNo(result.receipt_no);
      const amount = Number(result.amount);
      const sent = await notifyParent({
        tid,
        student,
        type: 'paid',
        text: render('paid', { student: student.name, amount, receipt, balance: 0 }, lang),
        feedText: FEED.paid({ amount, receipt }),
        lang,
      });
      return ok(res, {
        payment_id: result.payment_id,
        amount,
        balance: Number(result.balance),
        full: true,
        receipt,
        receipt_no: result.receipt_no,
        link: sent.link,
        status: sent.status,
      });
    }

    /* ---- marks ---- */
    case 'mark.add': {
      const student = await mustStudent(tid, body.student_id, 'id,name,parent_phone');
      const title = String(body.title || '').trim();
      const score = Number(body.score);
      const max = Number(body.max_score) || 100;
      if (!title) return bad(res, 'Enter a test name');
      if (!Number.isFinite(score) || score < 0) return bad(res, 'Enter a score');
      if (score > max) return bad(res, 'The score is higher than the maximum');

      await db.insert(
        'marks',
        {
          teacher_id: tid,
          student_id: student.id,
          title,
          score,
          max_score: max,
          taken_on: body.taken_on || R.today(),
        },
        { returning: 'minimal' },
      );
      const text = render('mark', { student: student.name, score, max, test: title }, lang);
      const result = await notifyParent({
        tid,
        student,
        type: 'mark',
        text,
        feedText: FEED.mark({ score, max, test: title }),
        lang,
      });
      return ok(res, { saved: true, link: result.link, status: result.status });
    }

    /* ---- messages ---- */
    case 'message.fee': {
      const { student, text } = await messageText('fee', tid, body.student_id, teacher);
      if (Number(student.amount_due) <= 0) return bad(res, 'Nothing is owed');
      const result = await notifyParent({
        tid,
        student,
        type: 'fee',
        text,
        feedText: FEED.fee({ classes: student.pending_classes, amount: student.amount_due }),
        lang,
      });
      await db.update(
        'students',
        { last_reminded_at: new Date().toISOString() },
        { id: `eq.${student.id}` },
      );
      return ok(res, { link: result.link, status: result.status, text });
    }

    case 'message.report': {
      const { student, text } = await messageText('report', tid, body.student_id, teacher);
      const result = await notifyParent({
        tid,
        student,
        type: 'report',
        text,
        feedText: FEED.report(),
        lang,
      });
      return ok(res, { link: result.link, status: result.status, text });
    }

    case 'message.timetable': {
      // Share this week's timetable with every family (section 2.3).
      const classes = await loadClasses(tid);
      const skips = new Set(classes.flatMap((c) => c.skips.map((d) => `${c.id}|${d}`)));
      const start = R.startOfWeek(R.today());
      const lines = [];
      for (let i = 0; i < 7; i += 1) {
        const date = R.addDays(start, i);
        for (const s of R.sessionsOn(classes, date, skips)) {
          lines.push(`${DAY_NAMES[i]} ${R.hhmm(s.cls.start_time)} - ${s.cls.title} (${s.cls.place || ''})`);
        }
      }
      const students = await db.select('students', {
        select: 'id,name,parent_phone',
        teacher_id: `eq.${tid}`,
        status: 'eq.active',
      });
      const text = render('timetable', { teacher: tname, lines: lines.join('\n') }, lang);
      const results = [];
      for (const student of students) {
        results.push(
          await notifyParent({
            tid,
            student,
            type: 'class',
            text,
            feedText: "This week's timetable was shared",
            lang,
          }),
        );
      }
      return ok(res, { sent: results.length, text, messages: results.map((x) => x.status) });
    }

    /* ---- papers ---- */
    case 'paper.create': {
      if (!String(body.name || '').trim()) return bad(res, 'Enter a name');
      const [paper] = await db.insert('papers', {
        teacher_id: tid,
        name: body.name.trim(),
        price: Number(body.price) || 0,
        cost: Number(body.cost) || 0,
      });
      return ok(res, { paper_id: paper.id });
    }

    case 'paper.sell': {
      const paper = await db.selectOne('papers', { id: `eq.${body.paper_id}`, teacher_id: `eq.${tid}` });
      if (!paper) return bad(res, 'Paper not found', 404);
      if (body.student_id) await mustStudent(tid, body.student_id, 'id');
      await db.insert(
        'paper_sales',
        {
          paper_id: paper.id,
          teacher_id: tid,
          student_id: body.student_id || null,
          price: Number(body.price ?? paper.price),
        },
        { returning: 'minimal' },
      );
      return ok(res, { sold: true });
    }

    case 'paper.send': {
      const paper = await db.selectOne('papers', { id: `eq.${body.paper_id}`, teacher_id: `eq.${tid}` });
      if (!paper) return bad(res, 'Paper not found', 404);
      const student = await mustStudent(tid, body.student_id, 'id,name,parent_phone');
      const link = paper.file_path
        ? await db.signObject('papers', paper.file_path.replace(/^papers\//, ''), 60 * 60 * 24 * 7)
        : null;
      const text = render(
        'paper',
        { teacher: tname, paper: paper.name, student: student.name, link: link || '(attached)' },
        lang,
      );
      const result = await notifyParent({
        tid,
        student,
        type: 'class',
        text,
        feedText: `Paper shared: ${paper.name}`,
        lang,
      });
      return ok(res, { link: result.link, download: link, status: result.status });
    }

    /* ---- settings ---- */
    case 'settings.update': {
      const patch = {};
      if (body.lang && ['en', 'ta'].includes(body.lang)) patch.lang = body.lang;
      if (body.theme && ['night', 'day', 'auto'].includes(body.theme)) patch.theme = body.theme;
      if (body.auto_reminders !== undefined) patch.auto_reminders = Boolean(body.auto_reminders);
      if (body.remind_after_days && [7, 14, 30].includes(Number(body.remind_after_days))) {
        patch.remind_after_days = Number(body.remind_after_days);
      }
      if (body.name) patch.name = body.name;
      // Point 12: typed once here, then reused by every class held there.
      if (body.own_place_name !== undefined) {
        patch.own_place_name = String(body.own_place_name || '').trim() || 'My home';
      }
      if (body.own_place_area !== undefined) {
        patch.own_place_area = String(body.own_place_area || '').trim() || null;
      }
      if (!Object.keys(patch).length) return bad(res, 'Nothing to change');
      const [updated] = await db.update('teachers', patch, { id: `eq.${tid}` });
      delete updated.code_hash;
      delete updated.code_salt;
      delete updated.code_lookup;
      return ok(res, { teacher: updated });
    }

    case 'reschedule.resolve': {
      if (!['accepted', 'declined'].includes(body.status)) return bad(res, 'Unknown status');
      await db.update(
        'reschedule_requests',
        { status: body.status },
        { id: `eq.${body.request_id}`, teacher_id: `eq.${tid}` },
      );
      return ok(res, { saved: true });
    }

    default:
      return bad(res, `Unknown action: ${r}`, 404);
  }
}

export default guard(async (req, res) => {
  const session = teacherSession(req);
  if (!session) return bad(res, 'Please log in', 401);
  const tid = session.tid;
  const r = resource(req);

  if (req.method === 'GET') {
    switch (r) {
      case 'bootstrap': {
        const data = await bootstrap(req, tid);
        if (!data) return bad(res, 'Teacher not found', 404);
        return ok(res, data);
      }
      case 'sessions': {
        const { from, to } = query(req);
        if (!from || !to) return bad(res, 'from and to are required');
        return ok(res, { sessions: await loadSessions(tid, from, to) });
      }
      case 'slip': {
        const { student_id: id } = query(req);
        const student = await mustStudent(tid, id, 'id,slip_path');
        if (!student.slip_path) return bad(res, 'No slip on file', 404);
        const url = await db.signObject('slips', student.slip_path.replace(/^slips\//, ''), 600);
        return ok(res, { url });
      }
      case 'preview': {
        const { kind, student_id: id } = query(req);
        const teacher = await db.selectOne('teachers', { id: `eq.${tid}` });
        const { text } = await messageText(kind, tid, id, teacher);
        return ok(res, { text });
      }
      case 'invite': {
        const teacher = await db.selectOne('teachers', { select: 'name,title,join_key', id: `eq.${tid}` });
        const base = (process.env.APP_URL || `https://${req.headers.host}`).replace(/\/+$/, '');
        const link = `${base}/join?t=${teacher.join_key}`;
        const text = render('invite', { teacher: teacherName(teacher), link }, 'en');
        return ok(res, { link, text, whatsapp: waLink('', text) });
      }
      default:
        return bad(res, `Unknown request: ${r}`, 404);
    }
  }

  if (req.method !== 'POST') return bad(res, 'Use POST', 405);
  return handlePost(req, res, tid, r);
});
