/**
 * /api/review  -  "Review with AI": Gemini suggests marks for a student's
 * photographed answer paper.
 *
 * Its own function rather than a case in /api/teacher, for two reasons: a
 * review can take tens of seconds, so it gets a longer maxDuration in
 * vercel.json without stretching every other teacher request; and its body
 * is photos, which are kept out of the handler that does everything else.
 *
 * It only reads. The teacher looks at the suggestion, changes what they
 * disagree with, and saves through mark.add like any other mark.
 */

import * as db from './_lib/db.js';
import {
  GeminiError,
  MAX_IMAGE_CHARS,
  MAX_PAGES,
  MAX_SCHEME_PAGES,
  configured,
  imagePart,
  markPaper,
  normaliseReview,
  userPrompt,
} from './_lib/gemini.js';
import { bad, guard, ok, readJson } from './_lib/http.js';
import { teacherSession } from './_lib/session.js';

export default guard(async (req, res) => {
  const session = teacherSession(req);
  if (!session) return bad(res, 'Please log in', 401);
  if (req.method !== 'POST') return bad(res, 'Use POST', 405);
  if (!configured()) return bad(res, 'AI review is not set up on the server.', 503);

  const tid = session.tid;
  const body = await readJson(req);

  const pagesIn = Array.isArray(body.pages) ? body.pages : [];
  const schemeIn = Array.isArray(body.scheme) ? body.scheme : [];
  if (!pagesIn.length) return bad(res, 'Add a photo of the answer paper');
  if (pagesIn.length > MAX_PAGES) return bad(res, `Up to ${MAX_PAGES} answer pages at a time`);
  if (schemeIn.length > MAX_SCHEME_PAGES) {
    return bad(res, `Up to ${MAX_SCHEME_PAGES} pages of question paper or marking scheme`);
  }
  const chars = [...pagesIn, ...schemeIn].reduce((a, x) => a + String(x || '').length, 0);
  if (chars > MAX_IMAGE_CHARS) return bad(res, 'The photos are too large together. Remove a page.', 413);

  const pages = pagesIn.map(imagePart);
  const scheme = schemeIn.map(imagePart);
  if (pages.includes(null) || scheme.includes(null)) {
    return bad(res, 'Only photos can be reviewed (JPEG, PNG or WebP)');
  }

  const maxScore = Number(body.max_score) || 100;
  if (!(maxScore > 0 && maxScore <= 1000)) return bad(res, 'Out of must be between 1 and 1000');

  // Scoped by the session's teacher, as everything in /api is: a review can
  // only be run against one of this teacher's own students.
  const [student, teacher] = await Promise.all([
    db.selectOne('students', {
      select: 'id,name,call_name,grade,subject,curriculum',
      id: `eq.${body.student_id}`,
      teacher_id: `eq.${tid}`,
    }),
    db.selectOne('teachers', { select: 'lang', id: `eq.${tid}` }),
  ]);
  if (!student) return bad(res, 'Student not found', 404);

  const lang = ['en', 'ta'].includes(body.lang) ? body.lang : teacher?.lang || 'en';
  const prompt = userPrompt({
    subject: String(body.subject || student.subject || '').slice(0, 60),
    grade: student.grade,
    curriculum: student.curriculum,
    title: String(body.title || '').slice(0, 120),
    maxScore,
    notes: String(body.notes || '').trim().slice(0, 1500),
    hasScheme: scheme.length > 0,
  });

  try {
    const { result, model, fallback } = await markPaper({ pages, scheme, lang, prompt });
    const review = normaliseReview(result, {
      maxScore,
      studentName: student.call_name || String(student.name || '').split(/\s+/)[0],
    });
    // The back-up model marks more generously: never call its result confident.
    if (fallback && review.confidence === 'high') review.confidence = 'medium';
    return ok(res, { review: { ...review, model, fallback } });
  } catch (err) {
    if (err instanceof GeminiError) return bad(res, err.message, err.status);
    throw err;
  }
});
