/**
 * The rules behind the teacher onboarding wizard.
 *
 * Pure functions over a plain answers object, kept apart from the screen so
 * they can be tested without a browser - the same arrangement as the family
 * sign-up form in join-steps.js.
 *
 * This wizard is a Plus team tool, not something a teacher opens by
 * themselves: step 6 carries notes the teacher is explicitly not shown.
 */

import { lkMobileError } from './rules.js';

export const TOTAL = 4; // the four numbered steps; 2 and 4 are sheets over them

export const STEPS = [
  { title: 'ob_about_title', name: 'ob_about' },
  { title: 'ob_classes_title', name: 'ob_classes' },
  { title: 'ob_how_title', name: 'ob_how' },
  { title: 'ob_done_title', name: 'ob_done' },
];

/* --------------------------------------------------- the subject catalogue */

/**
 * What Sri Lankan tuition teachers actually teach, grouped the way the
 * curriculum is. A teacher who does not find theirs can type their own, so
 * this list never has to be complete to be useful.
 */
export const SUBJECTS = [
  {
    band: 'primary',
    label: 'ob_primary',
    items: ['Maths', 'English', 'Sinhala', 'Tamil', 'Environment', 'Scholarship exam'],
  },
  {
    band: 'ol',
    label: 'ob_ol',
    items: [
      'Maths', 'Science', 'English', 'Sinhala', 'Tamil', 'History', 'Geography',
      'Commerce', 'ICT', 'Civics', 'Buddhism', 'Hinduism', 'Islam', 'Christianity',
      'Literature', 'Art', 'Music', 'Dancing', 'Health & PE', 'Agriculture',
      'Design & Tech',
    ],
  },
  {
    band: 'al',
    label: 'ob_al',
    items: [
      'Combined Maths', 'Physics', 'Chemistry', 'Biology', 'Accounting',
      'Business Studies', 'Economics', 'ICT', 'SFT', 'ET', 'BST',
      'Political Science', 'Logic', 'Geography', 'History', 'Languages',
      'General English',
    ],
  },
  {
    band: 'other',
    label: 'ob_other',
    items: [
      'Spoken English', 'Elocution', 'French', 'Japanese', 'Korean', 'Coding',
      'Music lessons',
    ],
  },
];

/** Every subject the catalogue knows, once each. */
export const ALL_SUBJECTS = [...new Set(SUBJECTS.flatMap((g) => g.items))];

/** Filter the catalogue by what has been typed into the search box. */
export function searchSubjects(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return SUBJECTS;
  return SUBJECTS.map((group) => ({
    ...group,
    items: group.items.filter((s) => s.toLowerCase().includes(q)),
  })).filter((group) => group.items.length);
}

/* ----------------------------------------------------- the other choices */

export const TITLES = ['Mr', 'Mrs', 'Miss', 'Ms', 'Dr', 'Rev'];
export const MEDIUMS = ['English', 'Sinhala', 'Tamil'];
export const GRADES = Array.from({ length: 13 }, (_, i) => `Grade ${i + 1}`);

/** Where a class happens. Maps onto the venue the teacher app already has. */
export const PLACES = [
  { key: 'home', label: 'ob_home', glyph: '🏠', venue_type: 'own_place' },
  { key: 'institute', label: 'ob_institute', glyph: '🏢', venue_type: 'institute' },
  { key: 'student', label: 'ob_student_home', glyph: '👤', venue_type: 'area' },
  { key: 'online', label: 'ob_online', glyph: '💻', venue_type: 'area' },
];

export const FEE_BANDS = ['Under 1,000', '1,000–2,000', '2,000–3,000', '3,000+'];

/* The "how do you work today" answers. Each is a single choice. */
export const HOW = [
  { key: 'tracking', label: 'ob_tracking', options: ['Book', 'Excel', 'An app', 'Not really'] },
  { key: 'messaging', label: 'ob_messaging', options: ['Yes, a group', 'Yes, one by one', 'No'] },
  {
    key: 'headache',
    label: 'ob_headache',
    options: ['Collecting fees', 'Attendance', 'Updating parents', 'Marks & reports'],
  },
  { key: 'growing', label: 'ob_growing', options: ['Yes', 'Maybe', 'No'] },
  { key: 'refer', label: 'ob_refer', options: ['None yet', '1–2', '3–5', '5+'] },
];

/** Step 6's panel, which the teacher is never shown. */
export const TEAM_TAGS = ['Very keen', 'Needs phone help', 'Can refer teachers', 'Follow up'];

/* ------------------------------------------------------------- the form */

export const emptyAnswers = () => ({
  /* step 1 */
  title: 'Mr',
  name: '',
  phone: '',
  email: '',
  area: '',
  subjects: [],
  medium: 'English',
  at_school: null, // true | false
  school: '',
  /* step 2 */
  classes: [],
  /* step 3 */
  how: {},
  /* step 4, team only */
  tags: [],
  notes: '',
});

/** A class as the wizard collects it: no start time, that comes later. */
export const emptyClass = () => ({
  grade: 'Grade 11',
  subject: '',
  place: 'home',
  institute: '',
  days: [],
  students: 10,
  fee_band: '2,000–3,000',
});

export function classError(draft) {
  if (!draft.subject) return 'ob_pick_subject';
  if (!draft.grade) return 'ob_pick_grade';
  if (!PLACES.some((p) => p.key === draft.place)) return 'ob_pick_place';
  if (draft.place === 'institute' && !String(draft.institute || '').trim()) {
    return 'ob_pick_institute';
  }
  if (!(draft.days || []).length) return 'pick_days';
  if (!(Number(draft.students) > 0)) return 'ob_pick_count';
  return null;
}

/** What is missing from one step, as { field: messageKey }. */
export function problems(answers, step) {
  const bad = {};
  const text = (v) => String(v ?? '').trim();

  if (step === 1) {
    if (text(answers.name).length < 2) bad['o-name'] = 'enter_name';
    const tel = lkMobileError(answers.phone);
    if (tel) bad['o-phone'] = tel === 'empty' ? 'tel_nine' : tel;
    if (!text(answers.area)) bad['o-area'] = 'enter_area';
    if (!(answers.subjects || []).length) bad.subjects = 'ob_pick_subject';
    if (answers.at_school === null) bad.at_school = 'ob_pick_school';
    if (answers.at_school === true && !text(answers.school)) bad['o-school'] = 'ob_pick_school';
  }

  if (step === 2 && !(answers.classes || []).length) bad.classes = 'ob_add_a_class';

  if (step === 3) {
    for (const q of HOW) if (!answers.how?.[q.key]) bad[q.key] = q.label;
  }

  // Step 4 is the summary and the team's own notes: nothing is required.
  return bad;
}

export const stepOk = (answers, step) => Object.keys(problems(answers, step)).length === 0;

export function firstUnfinished(answers) {
  for (let step = 1; step <= TOTAL; step += 1) if (!stepOk(answers, step)) return step;
  return null;
}

/** The "your week" strip under the class list. */
export function weekSummary(classes) {
  const list = classes || [];
  const days = new Set(list.flatMap((c) => c.days || []));
  const places = new Set(list.map((c) => (c.place === 'institute' ? c.institute || 'Institute' : c.place)));
  return {
    classes: list.length,
    days: days.size,
    students: list.reduce((sum, c) => sum + (Number(c.students) || 0), 0),
    places: places.size,
  };
}

/** The payload the API is sent. Shaped here so the screen stays about drawing. */
export function toPayload(answers) {
  return {
    title: answers.title,
    name: answers.name.trim(),
    phone: answers.phone,
    email: answers.email.trim(),
    area: answers.area.trim(),
    subjects: answers.subjects,
    medium: answers.medium,
    school: answers.at_school ? answers.school.trim() : null,
    classes: (answers.classes || []).map((c) => ({
      grade: c.grade,
      subject: c.subject,
      place: c.place,
      institute: c.institute?.trim() || null,
      days: c.days,
      students: Number(c.students) || 0,
      fee_band: c.fee_band,
    })),
    how: answers.how,
    tags: answers.tags,
    notes: answers.notes.trim(),
  };
}
