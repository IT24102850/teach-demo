/**
 * /api/join  -  the public sign-up form (section 7.7). No login needed.
 *
 *   GET  ?r=config&t=<join_key>   which subjects and curricula to show
 *   POST ?r=submit                { t, name, grade, school, curriculum, subjects, parent_* }
 *
 * A submission only creates a `pending` student. Nothing is visible to the
 * family until the teacher sets the fee and confirms, which is what creates
 * the family login code.
 */

import * as db from './_lib/db.js';
import { bad, clientIp, guard, ok, query, readJson, resource } from './_lib/http.js';

const MAX_PER_HOUR = Number(process.env.JOIN_MAX_PER_HOUR || 5);

async function teacherByKey(key) {
  if (!key) return null;
  return db.selectOne('teachers', {
    select: 'id,name,title,subjects,curricula',
    join_key: `eq.${key}`,
  });
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

  // Rule 7.7.2: name and phone are the only required fields.
  const name = String(body.name || '').trim();
  const phone = String(body.parent_phone || '').replace(/[^\d]/g, '');
  if (name.length < 2) return bad(res, 'Please enter the student name');
  if (phone.length < 9) return bad(res, 'Please enter a WhatsApp number, for example 94771234567');

  const wanted = (Array.isArray(body.subjects) ? body.subjects : [])
    .filter((s) => (teacher.subjects || []).includes(s))
    .slice(0, 6);
  const curriculum = (teacher.curricula || []).includes(body.curriculum) ? body.curriculum : 'Local';

  const [student] = await db.insert('students', {
    teacher_id: teacher.id,
    name,
    grade: Number(body.grade) || null,
    school: String(body.school || '').trim() || null,
    area: String(body.area || '').trim() || null,
    curriculum,
    subject: wanted[0] || null,
    wanted_subjects: wanted,
    parent_name: String(body.parent_name || '').trim() || null,
    parent_phone: phone,
    fee_per_class: 0,
    status: 'pending',
  });

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
