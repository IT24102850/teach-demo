/**
 * /api/onboard  -  the teacher onboarding wizard.
 *
 *   GET  ?r=config&k=<key>   is this key good, and what does the form offer
 *   POST ?r=submit           create the teacher, their classes and their code
 *
 * This creates teacher accounts, so it is not open. ONBOARD_KEY must be set
 * in the environment and presented on every request; without it the endpoint
 * answers 404 and behaves as though it is not there at all. The wizard is a
 * tool the Plus team uses sitting next to a teacher, not a public sign-up.
 *
 * The teacher's four-digit code is shown once, at the end, exactly like a
 * family code: it is stored hashed and cannot be read back.
 */

import * as db from './_lib/db.js';
import { bad, clientIp, guard, ok, query, readJson, resource } from './_lib/http.js';
import { codeLookup, hashCode, randomCode } from './_lib/session.js';
import { toLkMobile } from './_lib/rules.js';
import { render } from './_lib/templates.js';
import { sendWhatsApp } from './_lib/whatsapp.js';

const KEY = process.env.ONBOARD_KEY || '';
const MAX_PER_HOUR = Number(process.env.ONBOARD_MAX_PER_HOUR || 20);

/** Timing-safe enough for a shared key of this length. */
function keyOk(given) {
  if (!KEY) return false;
  const a = String(given || '');
  if (a.length !== KEY.length) return false;
  let diff = 0;
  for (let i = 0; i < KEY.length; i += 1) diff |= a.charCodeAt(i) ^ KEY.charCodeAt(i);
  return diff === 0;
}

/* Where a class happens, as the teacher app stores it. */
const PLACES = {
  home: { venue_type: 'own_place', area: null },
  institute: { venue_type: 'institute', area: null },
  student: { venue_type: 'area', area: null },
  online: { venue_type: 'area', area: 'Online' },
};

const MEDIUM_LANG = { English: 'en', Tamil: 'ta', Sinhala: 'en' };

/** A join key from the teacher's name, made unique if it is already taken. */
async function freeJoinKey(name) {
  const base =
    String(name || 'teacher')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 14) || 'teacher';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = attempt ? `${base}${attempt + 1}` : base;
    const taken = await db.selectOne('teachers', { select: 'id', join_key: `eq.${candidate}` });
    if (!taken) return candidate;
  }
  throw Object.assign(new Error('Could not make a sign-up link for that name'), { status: 500 });
}

/** A login code nothing else is using. */
async function freeCode() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = randomCode();
    const lookup = codeLookup(candidate);
    const [a, b] = await Promise.all([
      db.selectOne('teachers', { select: 'id', code_lookup: `eq.${lookup}` }),
      db.selectOne('family_accounts', { select: 'id', code_lookup: `eq.${lookup}` }),
    ]);
    if (!a && !b) return candidate;
  }
  throw Object.assign(new Error('Could not make a free code - increase CODE_LENGTH'), {
    status: 500,
  });
}

export default guard(async (req, res) => {
  const r = resource(req);
  const given = req.method === 'GET' ? query(req).k : (await readJson(req))?.k;

  // Off unless a key is configured, and silent about why.
  if (!KEY) return bad(res, 'Not found', 404);

  if (req.method === 'GET') {
    if (r !== 'config') return bad(res, 'Not found', 404);
    if (!keyOk(given)) return bad(res, 'Not found', 404);
    return ok(res, { ready: true, code_length: Number(process.env.CODE_LENGTH || 4) });
  }

  if (req.method !== 'POST') return bad(res, 'Use POST', 405);
  if (r !== 'submit') return bad(res, 'Not found', 404);

  // The body was already read above to find the key, so read it again from
  // the cached value rather than the stream.
  const body = (req.body && typeof req.body === 'object' ? req.body : null) || (await readJson(req));
  if (!keyOk(body.k || given)) return bad(res, 'Not found', 404);

  const ip = clientIp(req);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const recent = await db.select('login_attempts', {
    select: 'id',
    ip: `eq.${ip}`,
    role: 'eq.onboard',
    created_at: `gte.${since}`,
    limit: MAX_PER_HOUR + 1,
  });
  if (recent.length >= MAX_PER_HOUR) {
    return bad(res, 'Too many teachers set up from here. Please try again later.', 429);
  }

  /* --------------------------------------------------------- validation -- */

  const name = String(body.name || '').trim();
  if (name.length < 2) return bad(res, "Enter the teacher's full name");

  const phone = toLkMobile(body.phone);
  if (!phone) return bad(res, 'Enter a Sri Lankan mobile number: 9 digits starting with 7');

  const area = String(body.area || '').trim();
  if (!area) return bad(res, 'Enter the main area or town');

  const subjects = (Array.isArray(body.subjects) ? body.subjects : [])
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 20);
  if (!subjects.length) return bad(res, 'Pick at least one subject');

  const classes = Array.isArray(body.classes) ? body.classes.slice(0, 30) : [];
  for (const cls of classes) {
    if (!cls.subject || !cls.grade) return bad(res, 'Every class needs a grade and a subject');
    if (!PLACES[cls.place]) return bad(res, 'Say where each class is held');
    if (cls.place === 'institute' && !String(cls.institute || '').trim()) {
      return bad(res, 'Enter the institute name');
    }
    const days = Array.isArray(cls.days) ? cls.days.map(Number).filter((d) => d >= 0 && d <= 6) : [];
    if (!days.length) return bad(res, 'Pick the days each class runs');
  }

  const taken = await db.selectOne('teachers', { select: 'id,name', phone: `eq.${phone}` });
  if (taken) return bad(res, 'A teacher with that number is already on Plus', 409);

  /* ------------------------------------------------------------- create -- */

  const joinKey = await freeJoinKey(name);
  const code = await freeCode();
  const { hash, salt } = hashCode(code);

  const [teacher] = await db.insert('teachers', {
    name,
    title: String(body.title || 'Mr').slice(0, 12),
    phone,
    email: String(body.email || '').trim() || null,
    school: String(body.school || '').trim() || null,
    join_key: joinKey,
    subjects,
    lang: MEDIUM_LANG[body.medium] || 'en',
    code_lookup: codeLookup(code),
    code_hash: hash,
    code_salt: salt,
    own_place_area: area,
    plus_since: new Date().toISOString().slice(0, 10),
    // Everything the wizard asked that is not a column of its own, including
    // the panel the teacher is not shown.
    onboarding: {
      medium: body.medium || 'English',
      area,
      how: body.how || {},
      team: { tags: Array.isArray(body.tags) ? body.tags : [], notes: String(body.notes || '').trim() },
      classes,
      at: new Date().toISOString(),
    },
    onboarded_at: new Date().toISOString(),
  });

  /*
   * The wizard does not ask what time a class starts - that would be a sixth
   * screen for something that takes ten seconds in the app. The classes are
   * created with a placeholder and flagged, so the teacher is asked to set
   * the real time before the class reaches a calendar.
   */
  if (classes.length) {
    await db.insert(
      'classes',
      classes.map((cls) => {
        const place = PLACES[cls.place];
        const grade = Number(String(cls.grade).replace(/\D/g, '')) || null;
        return {
          teacher_id: teacher.id,
          subject: cls.subject,
          curriculum: 'Local',
          grade,
          title: `${cls.grade} ${cls.subject}`,
          kind: Number(cls.students) === 1 ? 'individual' : 'group',
          venue_type: place.venue_type,
          venue_name: cls.place === 'institute' ? String(cls.institute).trim() : null,
          area: place.area || area,
          place:
            cls.place === 'institute'
              ? `${String(cls.institute).trim()} · ${area}`
              : place.area || area,
          days: cls.days.map(Number),
          start_time: '16:00',
          duration_hours: 1.5,
          start_date: new Date().toISOString().slice(0, 10),
          once_date: null,
          setup_pending: true,
          expected_students: Number(cls.students) || null,
          fee_band: cls.fee_band || null,
        };
      }),
      { returning: 'minimal' },
    );
  }

  await db.insert('login_attempts', { ip, role: 'onboard', ok: true }, { returning: 'minimal' });

  /* ---------------------------------------------------------- welcome ---- */

  const lang = MEDIUM_LANG[body.medium] || 'en';
  const text = render('code', { teacher: `${name}${body.title ? '' : ''}`, code }, lang);
  const sent = await sendWhatsApp(phone, text);

  // Shown once. The code is only ever stored hashed, so this is the single
  // moment it can be read.
  return ok(res, {
    teacher_id: teacher.id,
    name,
    code,
    join_key: joinKey,
    classes: classes.length,
    students: classes.reduce((sum, c) => sum + (Number(c.students) || 0), 0),
    whatsapp: { status: sent.status, link: sent.link || null, text },
  });
});
