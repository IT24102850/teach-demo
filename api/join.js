/**
 * /api/join  -  the public sign-up form (section 7.7). No login needed.
 *
 *   GET  ?r=config&t=<join_key>   which subjects and curricula to show
 *   POST ?r=submit                { t, name, call_name, grade, school, curriculum,
 *                                   subjects, ambition, parent_* }
 *
 * The form itself is the four-step wizard of point 8. It validates as the
 * person types, but nothing here trusts that: every rule is checked again
 * below, because a POST can always arrive without the form.
 *
 * A submission only creates a `pending` student. Nothing is visible to the
 * family until the teacher sets the fee and confirms, which is what creates
 * the family login code.
 */

import * as db from './_lib/db.js';
import { bad, clientIp, guard, ok, query, readJson, resource } from './_lib/http.js';
import { toLkMobile } from './_lib/rules.js';

const MAX_PER_HOUR = Number(process.env.JOIN_MAX_PER_HOUR || 5);

async function teacherByKey(key) {
  if (!key) return null;
  return db.selectOne('teachers', {
    select: 'id,name,title,subjects,curricula',
    join_key: `eq.${key}`,
  });
}

/** The biggest picture we accept, after the phone has shrunk it. */
const MAX_PHOTO_BYTES = 400 * 1024;

/**
 * Store a `data:image/...;base64,...` photo in the private photos bucket.
 * Returns the stored path, or null when the value is not a picture we take.
 */
async function storePhoto(teacherId, studentId, dataUrl) {
  const match = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
    String(dataUrl || '').trim(),
  );
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) return null;
  const ext = match[1] === 'jpg' ? 'jpeg' : match[1];
  return db.uploadObject(
    'photos',
    `${teacherId}/${studentId}.${ext === 'jpeg' ? 'jpg' : ext}`,
    bytes,
    `image/${ext}`,
  );
}

export default guard(async (req, res) => {
  const r = resource(req);

  if (req.method === 'GET') {
    if (r !== 'config') return bad(res, 'Unknown request', 404);
    const teacher = await teacherByKey(query(req).t);
    if (!teacher) return bad(res, 'That sign-up link is not valid any more', 404);
    return ok(res, {
      teacher: { name: teacher.name, title: teacher.title },
      subjects: teacher.subjects || [],
      curricula: teacher.curricula || [],
    });
  }

  if (req.method !== 'POST') return bad(res, 'Use POST', 405);
  if (r !== 'submit') return bad(res, 'Unknown request', 404);

  const ip = clientIp(req);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const recent = await db.select('login_attempts', {
    select: 'id',
    ip: `eq.${ip}`,
    role: 'eq.join',
    created_at: `gte.${since}`,
    limit: MAX_PER_HOUR + 1,
  });
  if (recent.length >= MAX_PER_HOUR) {
    return bad(res, 'Too many sign-ups from here. Please try again later.', 429);
  }

  const body = await readJson(req);
  const teacher = await teacherByKey(body.t);
  if (!teacher) return bad(res, 'That sign-up link is not valid any more', 404);

  // Rule 7.7.2 plus point 8: these are the required answers of the four steps.
  const name = String(body.name || '').trim();
  if (name.length < 2) return bad(res, 'Please enter the student name');

  // Point 3: the number is stored as 947XXXXXXXX whatever shape it arrived in.
  // A leading 0 or a typed +94 is cleaned up; anything that is not a Sri
  // Lankan mobile is refused rather than quietly saved and never reachable.
  const phone = toLkMobile(body.parent_phone);
  if (!phone) {
    return bad(res, 'Enter a Sri Lankan mobile number: 9 digits starting with 7');
  }

  const grade = Number(body.grade);
  if (!Number.isInteger(grade) || grade < 1 || grade > 13) {
    return bad(res, 'Pick a grade between 1 and 13');
  }

  const parentName = String(body.parent_name || '').trim();
  if (parentName.length < 2) return bad(res, "Please enter the parent's name");

  // Only subjects this teacher actually offers, whatever was posted.
  const wanted = (Array.isArray(body.subjects) ? body.subjects : [])
    .filter((s) => (teacher.subjects || []).includes(s))
    .slice(0, 6);
  if (!wanted.length) return bad(res, 'Pick at least one subject');

  const curriculum = (teacher.curricula || []).includes(body.curriculum)
    ? body.curriculum
    : (teacher.curricula || [])[0] || 'Local';

  const short = (value, max = 80) => String(value || '').trim().slice(0, max) || null;

  const [student] = await db.insert('students', {
    teacher_id: teacher.id,
    name,
    call_name: short(body.call_name) || name.split(/\s+/)[0],
    grade,
    school: short(body.school),
    area: short(body.area),
    curriculum,
    subject: wanted[0] || null,
    wanted_subjects: wanted,
    ambition: short(body.ambition),
    parent_name: parentName,
    parent_occupation: short(body.parent_occupation),
    parent_phone: phone,
    fee_per_class: 0,
    status: 'pending',
  });

  // Point 8: the photo is optional and must never cost the family their
  // registration. If storing it fails, the student is already saved and the
  // teacher can ask for a picture later.
  if (body.photo) {
    try {
      const stored = await storePhoto(teacher.id, student.id, body.photo);
      if (stored) {
        await db.update('students', { photo_path: stored }, { id: `eq.${student.id}` });
      }
    } catch (err) {
      console.error('[join] photo', err?.message || err);
    }
  }

  await db.insert('login_attempts', { ip, role: 'join', ok: true }, { returning: 'minimal' });
  await db.insert(
    'events',
    {
      teacher_id: teacher.id,
      student_id: student.id,
      type: 'join',
      text: `${name} filled in the sign-up form`,
    },
    { returning: 'minimal' },
  );

  return ok(res, {
    saved: true,
    teacher: `${teacher.name}${teacher.title ? ` ${teacher.title}` : ''}`,
  });
});
