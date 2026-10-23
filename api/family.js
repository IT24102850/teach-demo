/**
 * /api/family  -  the Parent and Student views.
 *
 * The signed session carries the child ids this family may read. Every query
 * below is filtered by that list, so changing an id in the address bar reaches
 * nothing (test checklist: "a parent code cannot open another family's data").
 *
 * The leaderboard is masked HERE, on the server: a parent's browser never
 * receives another child's surname (rule 7.4.5).
 */

import * as db from './_lib/db.js';
import { bad, guard, ok, readJson, resource } from './_lib/http.js';
import { familySession, startSession } from './_lib/session.js';
import * as R from './_lib/rules.js';

const CHILD_FIELDS =
  'id,name,grade,school,area,curriculum,subject,fee_per_class,fee_status,parent_name,status,slip_path,' +
  'slip_sent_at,amount_due,pending_classes,days_late,hist,total_classes,present_classes,' +
  'mark_count,avg_pct,best_pct,first_pct,latest_pct';

function activeChild(session, requested) {
  const id = requested && session.children.includes(requested) ? requested : session.child;
  return session.children.includes(id) ? id : session.children[0];
}

/**
 * The subscriber rule from the Income handoff: "there are no free parents in
 * the app".
 *
 * A family whose subscription is not active sees a single screen asking them
 * to subscribe, and nothing else - no attendance, no marks, no fees. They
 * still get the WhatsApp fee reminder, which is the one thing that reaches
 * them without the app.
 *
 * Families who were already using the app keep it: the migration grandfathers
 * every student who had a family code when subscriptions were turned on, so
 * nobody was locked out by the deploy.
 */
async function subscriptionFor(childId) {
  return db.selectOne('student_plus', {
    select: 'student_id,on_plus,started_on',
    student_id: `eq.${childId}`,
  });
}

async function lockedPayload(session, childId) {
  const [child, teacher] = await Promise.all([
    db.selectOne('students', { select: 'id,name,call_name', id: `eq.${childId}` }),
    db.selectOne('teachers', {
      select: 'id,name,title,lang,theme,join_key,plus_price',
      id: `eq.${session.tid}`,
    }),
  ]);
  if (!child) return null;
  return {
    locked: true,
    today: R.today(),
    child: { id: child.id, name: child.name, call_name: child.call_name },
    teacher: { name: teacher?.name, title: teacher?.title, lang: teacher?.lang },
    price: Number(teacher?.plus_price || 0),
    // What the parent is asked to do: speak to the teacher. There is no
    // payment screen in this build - a subscription is recorded by hand.
    how: 'ask_teacher',
  };
}

async function bootstrap(session, requestedChild) {
  const childId = activeChild(session, requestedChild);
  const today = R.today();

  const plus = await subscriptionFor(childId);
  if (!plus?.on_plus) return lockedPayload(session, childId);

  const [child, teacher, children, enrolments, marks, events, payments, papers] = await Promise.all([
    db.selectOne('v_students', { select: CHILD_FIELDS, id: `eq.${childId}` }),
    db.selectOne('teachers', { select: 'id,name,title,lang,theme', id: `eq.${session.tid}` }),
    db.select('students', {
      select: 'id,name,grade,area,subject',
      id: db.inList(session.children),
      order: 'name.asc',
    }),
    db.select('class_students', {
      select: 'class_id,classes(id,subject,curriculum,grade,title,place,days,start_time,duration_hours,start_date,once_date,active,class_exceptions(skip_date))',
      student_id: `eq.${childId}`,
    }),
    db.select('marks', {
      select: 'id,title,score,max_score,taken_on',
      student_id: `eq.${childId}`,
      order: 'taken_on.asc',
    }),
    db.select('events', {
      select: 'id,type,text,created_at,delivery_status',
      student_id: `eq.${childId}`,
      order: 'created_at.desc',
      limit: 20,
    }),
    db.select('payments', {
      select: 'id,amount,method,paid_date',
      student_id: `eq.${childId}`,
      order: 'paid_date.desc',
      limit: 12,
    }),
    db.select('papers', { select: 'id,name,price,file_path', teacher_id: `eq.${session.tid}` }),
  ]);

  if (!child) return null;

  const classes = enrolments
    .map((e) => e.classes)
    .filter((c) => c && c.active)
    .map((c) => ({
      ...c,
      class_exceptions: undefined,
      skips: (c.class_exceptions || []).map((x) => x.skip_date),
    }));

  // Sessions for the weeks around today, with this child's own result only.
  const from = R.addDays(today, -60);
  const to = R.addDays(today, 30);
  const classIds = classes.map((c) => c.id);
  const sessionRows = classIds.length
    ? await db.select('sessions', {
        select: 'id,class_id,session_date,status,notified_at,attendance(student_id,present)',
        class_id: db.inList(classIds),
        and: `(session_date.gte.${from},session_date.lte.${to})`,
        order: 'session_date.asc',
      })
    : [];
  const sessions = sessionRows.map((s) => {
    const mine = (s.attendance || []).find((a) => a.student_id === childId);
    return {
      class_id: s.class_id,
      date: s.session_date,
      status: s.status,
      notified: Boolean(s.notified_at),
      present: mine ? mine.present : null,
    };
  });

  // Peers: everyone who shares a class with this child (rule 7.4.4).
  let board = { marks: [], attendance: [] };
  if (classIds.length) {
    const peerRows = await db.select('class_students', {
      select: 'student_id',
      class_id: db.inList(classIds),
    });
    const peerIds = [...new Set(peerRows.map((p) => p.student_id))];
    const peers = await db.select('v_students', {
      select: 'id,name,hist,avg_pct,mark_count',
      id: db.inList(peerIds),
      status: 'eq.active',
    });
    board = {
      marks: R.rankPeers(peers, childId, 'marks'),
      attendance: R.rankPeers(peers, childId, 'attendance'),
    };
  }

  return {
    today,
    role: session.role,
    teacher,
    children,
    child_id: childId,
    child: { ...child, slip_path: undefined, slip_sent: Boolean(child.slip_sent_at) },
    classes,
    sessions,
    marks,
    events,
    payments,
    board,
    papers: papers.map((p) => ({ id: p.id, name: p.name, has_file: Boolean(p.file_path) })),
  };
}

/** Accept a slip photo as a data URL, so no multipart parser is needed. */
function decodeDataUrl(dataUrl) {
  const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!match) return null;
  const [, contentType, b64] = match;
  if (!/^image\/(png|jpeg|jpg|webp)$/.test(contentType)) return null;
  const bytes = Buffer.from(b64, 'base64');
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) return null;
  return { contentType, bytes, ext: contentType.split('/')[1].replace('jpeg', 'jpg') };
}

export default guard(async (req, res) => {
  const session = familySession(req);
  if (!session) return bad(res, 'Please log in', 401);
  const r = resource(req);

  if (req.method === 'GET') {
    if (r === 'bootstrap') {
      const url = new URL(req.url, 'http://localhost');
      const data = await bootstrap(session, url.searchParams.get('child_id'));
      if (!data) return bad(res, 'Student not found', 404);
      return ok(res, data);
    }
    return bad(res, `Unknown request: ${r}`, 404);
  }

  if (req.method !== 'POST') return bad(res, 'Use POST', 405);
  const body = await readJson(req);
  const childId = activeChild(session, body.child_id);

  // The gate applies to writing as well as reading: a parent who is not
  // subscribed cannot send a slip or ask to reschedule either.
  const plus = await subscriptionFor(childId);
  if (!plus?.on_plus) return bad(res, 'This needs a Plus subscription', 402);

  switch (r) {
    /** Send a photo of a bank transfer slip (rule 7.2.6 from the parent's side). */
    case 'slip': {
      const file = decodeDataUrl(body.image);
      if (!file) return bad(res, 'Choose a photo of the slip (JPG or PNG, up to 4 MB)');
      const path = `${session.tid}/${childId}/${Date.now()}.${file.ext}`;
      await db.uploadObject('slips', path, file.bytes, file.contentType);
      await db.update(
        'students',
        { slip_path: path, slip_sent_at: new Date().toISOString() },
        { id: `eq.${childId}` },
      );
      await db.insert(
        'events',
        {
          teacher_id: session.tid,
          student_id: childId,
          type: 'slip',
          text: 'Bank slip sent, waiting for confirmation',
        },
        { returning: 'minimal' },
      );
      return ok(res, { sent: true });
    }

    case 'reschedule': {
      await db.insert(
        'reschedule_requests',
        {
          teacher_id: session.tid,
          student_id: childId,
          class_id: body.class_id || null,
          session_date: body.date || null,
          note: String(body.note || '').slice(0, 500) || null,
        },
        { returning: 'minimal' },
      );
      return ok(res, { sent: true });
    }

    /** A short-lived signed link, so papers are never world-readable. */
    case 'paper.link': {
      const paper = await db.selectOne('papers', {
        select: 'id,name,file_path',
        id: `eq.${body.paper_id}`,
        teacher_id: `eq.${session.tid}`,
      });
      if (!paper) return bad(res, 'Paper not found', 404);
      if (!paper.file_path) return bad(res, 'Your teacher has not uploaded this paper yet', 404);
      const url = await db.signObject('papers', paper.file_path.replace(/^papers\//, ''), 600);
      return ok(res, { url });
    }

    case 'child': {
      if (!session.children.includes(body.child_id)) return bad(res, 'Not your child', 403);
      startSession(res, { ...session, child: body.child_id });
      return ok(res, await bootstrap({ ...session, child: body.child_id }));
    }

    default:
      return bad(res, `Unknown action: ${r}`, 404);
  }
});
