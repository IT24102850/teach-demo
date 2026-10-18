/**
 * The teacher onboarding wizard (design handoff, second sheet of screens).
 *
 * A Plus team tool: somebody sits with a teacher and fills this in, and at
 * the end the teacher exists, their classes exist, and they have a code. The
 * last screen carries a panel the teacher is explicitly not shown.
 *
 * It is English only, deliberately. The teacher app is English and Tamil
 * because teachers and families use it every day; this is used once, by the
 * Plus team, so a translation layer would be weight for nobody.
 *
 * Nothing here works without ONBOARD_KEY in the URL - the API answers 404
 * otherwise, so a stray link is not an open door to making teachers.
 */

import { api } from './api.js';
import { loadFonts } from './fonts.js';
import { formatLkMobile, toLkMobile } from './rules.js';
import * as W from './onboard-steps.js';
import {
  actionButton,
  button,
  card,
  chip,
  closeSheet,
  esc,
  field,
  footerBar,
  label,
  muted,
  okScreen,
  openSheet,
  segmented,
  selectField,
  stepBar,
  telField,
  toast,
  wireTelFields,
} from './ui.js';

const host = document.getElementById('onboard');

const form = {
  key: '',
  ready: false,
  error: null,
  step: 1,
  show: false,
  sending: false,
  failed: null,
  done: null, // the result, once the teacher exists
  draft: null, // the class being added, while that sheet is open
  draftAt: -1, // which class is being edited, or -1 for a new one
  search: '',
  ...W.emptyAnswers(),
};

const STEP_NAMES = ['About', 'Classes', 'How you work', 'Done'];

/* ------------------------------------------------------------- reading --- */

/** Pull every box on screen back into `form`, so nothing is lost on redraw. */
function capture() {
  const read = (id) => document.getElementById(id);
  const set = (key, id) => {
    const el = read(id);
    if (el) form[key] = el.value;
  };
  set('name', 'o-name');
  set('email', 'o-email');
  set('area', 'o-area');
  set('school', 'o-school');
  set('notes', 'o-notes');
  const tel = read('o-phone');
  if (tel) form.phone = tel.value;
  const title = read('o-title');
  if (title) form.title = title.value;

  // The class sheet, if it is open.
  if (form.draft) {
    const grade = read('c-grade');
    const subject = read('c-subject');
    const institute = read('c-inst');
    const count = read('c-count');
    if (grade) form.draft.grade = grade.value;
    if (subject) form.draft.subject = subject.value;
    if (institute) form.draft.institute = institute.value;
    if (count) form.draft.students = Number(count.value) || 0;
  }
}

const problems = () => (form.show ? W.problems(form, form.step) : {});
const note = (bad, key) => (bad[key] ? `<p class="fld-note no">${esc(message(bad[key]))}</p>` : '');

/** The wizard's own wording, kept here rather than in the app's dictionary. */
const MESSAGES = {
  enter_name: 'Enter the full name',
  tel_nine: 'Enter 9 digits starting with 7',
  tel_start7: 'A Sri Lankan mobile number starts with 7',
  enter_area: 'Enter the main area or town',
  ob_pick_subject: 'Pick at least one subject',
  ob_pick_grade: 'Pick a grade',
  ob_pick_place: 'Say where the class is',
  ob_pick_institute: 'Enter the institute name',
  ob_pick_count: 'How many students?',
  ob_pick_school: 'Answer this to carry on',
  ob_add_a_class: 'Add at least one class',
  pick_days: 'Pick the days it runs',
  ob_tracking: 'Pick one',
  ob_messaging: 'Pick one',
  ob_headache: 'Pick one',
  ob_growing: 'Pick one',
  ob_refer: 'Pick one',
};
const message = (key) => MESSAGES[key] || key;

/* ------------------------------------------------------------- screens --- */

function stepAbout(bad) {
  return `
    <h1>Let’s set up your Plus profile</h1>
    <p class="mu">Takes 2 minutes. You can edit later.</p>
    ${stepBar(1, W.TOTAL)}<div class="step-n">Step 1 of ${W.TOTAL} · About</div>

    ${label('Full name')}
    <div class="row gap">
      <div style="flex:0 0 92px">
        ${selectField('o-title', '', W.TITLES.map((x) => ({ value: x, label: x })), form.title)}
      </div>
      <div class="g">
        ${field('o-name', '', { value: form.name, placeholder: 'Nimal Perera', invalid: Boolean(bad['o-name']) })}
      </div>
    </div>
    ${note(bad, 'o-name')}

    ${telField('o-phone', 'WhatsApp number', { value: form.phone, error: bad['o-phone'] || null })}
    ${field('o-email', 'Email (optional)', { type: 'email', value: form.email, placeholder: 'nimal@gmail.com' })}
    ${field('o-area', 'Main area / town', {
      value: form.area,
      required: true,
      placeholder: 'Nugegoda',
      invalid: Boolean(bad['o-area']),
    })}
    ${note(bad, 'o-area')}

    ${label('Subjects you teach')}
    <div class="chips">
      ${form.subjects
        .map(
          (s) =>
            `<button type="button" class="chip on" data-a="subject.drop" data-i="${esc(s)}">${esc(
              s,
            )} ✕</button>`,
        )
        .join('')}
      <button type="button" class="chip" data-a="subjects.open">+ Add subject</button>
    </div>
    ${note(bad, 'subjects')}

    ${label('Teaching medium')}
    ${segmented(W.MEDIUMS.map((m) => ({ value: m, label: m })), form.medium, 'medium')}

    ${label('Do you also teach at a school?')}
    <div class="row gap">
      ${button('Yes', { act: 'school.yes', cls: form.at_school === true ? 'gr' : 'o' })}
      ${button('No', { act: 'school.no', cls: form.at_school === false ? 'gr' : 'o' })}
    </div>
    ${note(bad, 'at_school')}
    ${
      form.at_school
        ? field('o-school', '', {
            value: form.school,
            placeholder: 'Royal College, Colombo 7',
            invalid: Boolean(bad['o-school']),
          }) + note(bad, 'o-school')
        : ''
    }
  `;
}

function stepClasses(bad) {
  const week = W.weekSummary(form.classes);
  return `
    <h1>Your classes</h1>
    <p class="mu">Add each class once. Add students later.</p>
    ${stepBar(2, W.TOTAL)}<div class="step-n">Step 2 of ${W.TOTAL} · Classes</div>

    ${form.classes
      .map((cls, i) => {
        const place = W.PLACES.find((p) => p.key === cls.place);
        const where = cls.place === 'institute' ? cls.institute : place?.glyph
          ? `${place.glyph} ${message(place.label) === place.label ? PLACE_LABEL[cls.place] : ''}`
          : '';
        return card(
          `<div class="row sp">
             <b class="g">${esc(`${cls.grade} · ${cls.subject}`)}</b>
             <button type="button" class="link-btn" data-a="class.edit" data-i="${i}">Edit</button>
           </div>
           ${muted(cls.place === 'institute' ? `${cls.institute}, ${form.area}` : PLACE_LABEL[cls.place])}
           <div class="chips" style="margin:8px 0 4px">${DAYS.map(
             (d, n) =>
               `<span class="chip${cls.days.includes(n) ? ' on' : ''}" aria-hidden="true">${d}</span>`,
           ).join('')}</div>
           ${muted(`${cls.students} students · Rs ${cls.fee_band}`)}`,
          { cls: 'sess', style: 'border-left-color:var(--teal)' },
        );
      })
      .join('')}
    ${note(bad, 'classes')}

    ${button('+ Add another class', { act: 'class.add', cls: 'o wide' })}

    ${
      form.classes.length
        ? card(
            `${label('Your week')}
             <div class="tiles">
               <div class="card"><div class="lbl">Classes</div><div class="big">${week.classes}</div></div>
               <div class="card"><div class="lbl">Days</div><div class="big">${week.days}</div></div>
               <div class="card"><div class="lbl">Students</div><div class="big">${week.students}</div></div>
               <div class="card"><div class="lbl">Places</div><div class="big">${week.places}</div></div>
             </div>`,
          )
        : ''
    }
  `;
}

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const PLACE_LABEL = {
  home: '🏠 Home class',
  institute: '🏢 Institute',
  student: '👤 Student’s home',
  online: '💻 Online',
};

function stepHow(bad) {
  return `
    <h1>How do you run things today?</h1>
    <p class="mu">Helps us set up Plus the right way.</p>
    ${stepBar(3, W.TOTAL)}<div class="step-n">Step 3 of ${W.TOTAL} · How you work</div>

    ${W.HOW.map(
      (q) => `
      ${label(HOW_LABEL[q.key])}
      <div class="chips">${q.options
        .map((opt) =>
          chip(opt, { act: 'how', arg: `${q.key}|${opt}`, on: form.how[q.key] === opt }),
        )
        .join('')}</div>
      ${note(bad, q.key)}`,
    ).join('')}
  `;
}

const HOW_LABEL = {
  tracking: 'How do you track attendance & fees?',
  messaging: 'Do you message parents on WhatsApp?',
  headache: 'Biggest headache right now?',
  growing: 'Planning more classes this year?',
  refer: 'Know other teachers who’d like Plus?',
};

function stepDone() {
  const week = W.weekSummary(form.classes);
  const places = [
    ...new Set(
      form.classes.map((c) => (c.place === 'institute' ? 'Institute' : PLACE_LABEL[c.place].slice(2).trim())),
    ),
  ];

  return `
    <h1>You’re on Plus, ${esc(form.name.split(' ')[0] || '')}!</h1>
    <p class="mu">Here’s the profile.</p>
    ${stepBar(4, W.TOTAL)}<div class="step-n">Step 4 of ${W.TOTAL} · Done</div>

    ${card(
      `<div class="row sp" style="padding:3px 0"><span class="mu">Subjects</span><b class="amt">${esc(
        form.subjects.join(', '),
      )}</b></div>
       <div class="row sp" style="padding:3px 0"><span class="mu">Area</span><b class="amt">${esc(form.area)}</b></div>
       <div class="row sp" style="padding:3px 0"><span class="mu">Classes</span><b class="amt">${week.classes} classes · ${week.days} days</b></div>
       <div class="row sp" style="padding:3px 0"><span class="mu">Students</span><b class="amt">${week.students}</b></div>
       <div class="row sp" style="padding:3px 0"><span class="mu">Places</span><b class="amt">${esc(places.join(', '))}</b></div>
       ${form.school ? `<div class="row sp" style="padding:3px 0"><span class="mu">School</span><b class="amt">${esc(form.school)}</b></div>` : ''}`,
    )}

    <!-- The handoff marks this panel "Plus team only". It is never sent to
         the teacher's app, only stored against their record. -->
    ${card(
      `${label('★ PLUS TEAM ONLY')}
       ${muted('The teacher cannot see this.')}
       <div class="chips">${W.TEAM_TAGS.map((tag) =>
         chip(tag, { act: 'tag', arg: tag, on: form.tags.includes(tag) }),
       ).join('')}</div>
       <label class="fld"><span class="lbl">Notes</span>
         <textarea id="o-notes" rows="3"
           placeholder="Big Grade 10 class at Sigma. Wants fee reminders first.">${esc(form.notes)}</textarea></label>`,
      { cls: 'team-only' },
    )}
  `;
}

/* -------------------------------------------------------------- sheets --- */

function subjectsSheet() {
  const groups = W.searchSubjects(form.search);
  const BAND = { primary: 'PRIMARY (GR 1–5)', ol: 'GRADE 6–11 / O/L', al: 'A/L', other: 'OTHER' };

  openSheet(`
    <div class="row sp"><h2 class="sheet-h">Your subjects</h2>
      <span class="pill t">${form.subjects.length} selected</span></div>
    <input id="s-search" class="search" type="search" placeholder="Search subjects"
      value="${esc(form.search)}" aria-label="Search subjects">
    ${groups
      .map(
        (g) => `${label(BAND[g.band])}
        <div class="chips">${g.items
          .map((s) =>
            chip(`${form.subjects.includes(s) ? '✓ ' : ''}${s}`, {
              act: 'subject',
              arg: s,
              on: form.subjects.includes(s),
            }),
          )
          .join('')}</div>`,
      )
      .join('')}
    ${groups.length ? '' : muted('Nothing matches that.')}
    <p class="fld-hint">Not here? <button type="button" class="link-btn" data-a="subject.own">+ Type your own</button></p>
    ${button('Done', { act: 'subjects.done', cls: 'wide' })}
  `);

  const search = document.getElementById('s-search');
  if (search) {
    search.oninput = (e) => {
      form.search = e.target.value;
      subjectsSheet();
      const again = document.getElementById('s-search');
      if (again) {
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      }
    };
  }
}

function classSheet() {
  const d = form.draft;
  const subjects = form.subjects.length ? form.subjects : W.ALL_SUBJECTS.slice(0, 12);

  openSheet(`
    <div class="row sp"><h2 class="sheet-h">Add a class</h2>
      ${
        form.classes.length
          ? button('Copy last class', { act: 'class.copy', cls: 'sm o' })
          : ''
      }</div>

    ${label('1 · Class')}
    <div class="row gap">
      ${selectField('c-grade', '', W.GRADES.map((g) => ({ value: g, label: g })), d.grade)}
      ${selectField(
        'c-subject',
        '',
        [{ value: '', label: '— subject —' }].concat(subjects.map((s) => ({ value: s, label: s }))),
        d.subject,
      )}
    </div>

    ${label('2 · Where')}
    <div class="chips">${W.PLACES.map((p) =>
      chip(`${p.glyph} ${PLACE_LABEL[p.key].slice(2).trim()}`, {
        act: 'class.place',
        arg: p.key,
        on: d.place === p.key,
      }),
    ).join('')}</div>
    ${
      d.place === 'institute'
        ? field('c-inst', 'Institute name', { value: d.institute, placeholder: 'Sigma Institute' })
        : ''
    }

    ${label('3 · Days')}
    <div class="chips">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      .map((name, i) => chip(name, { act: 'class.day', arg: String(i), on: d.days.includes(i) }))
      .join('')}</div>

    ${label('4 · Number of students in this class')}
    <div class="row gap">
      ${button('−', { act: 'class.less', cls: 'o' })}
      ${field('c-count', '', { type: 'number', min: 1, inputmode: 'numeric', value: String(d.students) })}
      ${button('+', { act: 'class.more', cls: 'o' })}
    </div>
    <p class="fld-hint">Add each student’s name later from the class.</p>

    ${label('5 · Monthly fee per student (Rs)')}
    <div class="chips">${W.FEE_BANDS.map((b) =>
      chip(b, { act: 'class.fee', arg: b, on: d.fee_band === b }),
    ).join('')}</div>

    ${actionButton('Save class', { act: 'class.save', cls: 'wide' })}
    ${
      form.draftAt >= 0
        ? button('Remove this class', { act: 'class.remove', cls: 'd wide' })
        : button('Cancel', { act: 'sheet.close', cls: 'o wide' })
    }
  `);
}

/* -------------------------------------------------------------- render --- */

function render() {
  if (form.done) return renderDone();

  if (!form.ready) {
    host.className = '';
    host.innerHTML = `<p class="mu center mt">${esc(form.error || 'Checking…')}</p>`;
    return;
  }

  const bad = problems();
  const body =
    form.step === 1
      ? stepAbout(bad)
      : form.step === 2
        ? stepClasses(bad)
        : form.step === 3
          ? stepHow(bad)
          : stepDone();

  const last = form.step === W.TOTAL;
  host.className = 'has-footer';
  host.innerHTML = `
    ${body}
    ${
      form.failed
        ? `<div class="card warn"><b>Could not finish.</b>${muted(form.failed)}</div>`
        : ''
    }
    ${footerBar(
      `${
        form.step > 1
          ? actionButton('Back', { act: 'step.back', cls: 'o back', disabled: form.sending })
          : ''
      }${actionButton(last ? (form.failed ? 'Try again' : 'Finish') : 'Next', {
        act: last ? 'submit' : 'step.next',
        cls: last ? 'gr' : '',
        busy: form.sending,
        busyText: 'Saving…',
        disabled: !form.sending && !W.stepOk(form, form.step),
      })}`,
    )}
    ${last ? '<p class="mu center note">Sends a welcome message on WhatsApp.</p>' : ''}
  `;
  wireTelFields(host);
}

/** The one moment the teacher's code can be read. */
function renderDone() {
  const r = form.done;
  host.className = '';
  host.innerHTML = okScreen(`${r.name} is on Plus`, 'Read this code out, or send it on WhatsApp.', {
    extra: `
      <div class="code-big">${esc(r.code)}</div>
      <p class="mu">The code is stored hashed, so this is the only time it can be shown.</p>
      ${card(
        `<div class="row sp" style="padding:3px 0"><span class="mu">Classes</span><b class="amt">${r.classes}</b></div>
         <div class="row sp" style="padding:3px 0"><span class="mu">Students</span><b class="amt">${r.students}</b></div>
         <div class="row sp" style="padding:3px 0"><span class="mu">Sign-up link</span><b class="amt">/join?t=${esc(
           r.join_key,
         )}</b></div>`,
      )}
      ${
        r.whatsapp?.link
          ? `<a class="btn wide" href="${esc(r.whatsapp.link)}" target="_blank" rel="noopener">Send the code on WhatsApp</a>`
          : `<p class="fld-note ok">✓ Sent on WhatsApp</p>`
      }
      ${button('Set up another teacher', { act: 'again', cls: 'o wide' })}`,
  });
}

/* ------------------------------------------------------------- actions --- */

const ACTIONS = {
  'step.next': () => {
    capture();
    if (!W.stepOk(form, form.step)) {
      form.show = true;
      render();
      return toast('Please finish this step first', 'bad');
    }
    form.show = false;
    form.step = Math.min(W.TOTAL, form.step + 1);
    render();
    host.scrollTop = 0;
  },
  'step.back': () => {
    capture();
    form.show = false;
    form.step = Math.max(1, form.step - 1);
    render();
    host.scrollTop = 0;
  },

  medium: (value) => {
    capture();
    form.medium = value;
    render();
  },
  'school.yes': () => {
    capture();
    form.at_school = true;
    render();
  },
  'school.no': () => {
    capture();
    form.at_school = false;
    form.school = '';
    render();
  },

  'subjects.open': () => {
    capture();
    form.search = '';
    subjectsSheet();
  },
  subject: (name) => {
    const at = form.subjects.indexOf(name);
    if (at >= 0) form.subjects.splice(at, 1);
    else form.subjects.push(name);
    subjectsSheet();
  },
  'subject.drop': (name) => {
    capture();
    form.subjects = form.subjects.filter((s) => s !== name);
    render();
  },
  'subject.own': () => {
    const typed = String(form.search || '').trim();
    if (!typed) return toast('Type the subject in the search box first', 'bad');
    if (!form.subjects.includes(typed)) form.subjects.push(typed);
    form.search = '';
    subjectsSheet();
  },
  'subjects.done': () => {
    closeSheet();
    render();
  },

  'class.add': () => {
    capture();
    form.draft = W.emptyClass();
    form.draft.subject = form.subjects[0] || '';
    form.draftAt = -1;
    classSheet();
  },
  'class.copy': () => {
    const last = form.classes[form.classes.length - 1];
    if (last) form.draft = { ...last, days: [...last.days] };
    classSheet();
  },
  'class.edit': (index) => {
    capture();
    const at = Number(index);
    form.draft = { ...form.classes[at], days: [...form.classes[at].days] };
    form.draftAt = at;
    classSheet();
  },
  'class.place': (key) => {
    capture();
    form.draft.place = key;
    classSheet();
  },
  'class.day': (index) => {
    capture();
    const i = Number(index);
    const at = form.draft.days.indexOf(i);
    if (at >= 0) form.draft.days.splice(at, 1);
    else form.draft.days.push(i);
    classSheet();
  },
  'class.fee': (band) => {
    capture();
    form.draft.fee_band = band;
    classSheet();
  },
  'class.less': () => {
    capture();
    form.draft.students = Math.max(1, (Number(form.draft.students) || 1) - 1);
    classSheet();
  },
  'class.more': () => {
    capture();
    form.draft.students = (Number(form.draft.students) || 0) + 1;
    classSheet();
  },
  'class.save': () => {
    capture();
    const problem = W.classError(form.draft);
    if (problem) return toast(message(problem), 'bad');
    if (form.draftAt >= 0) form.classes[form.draftAt] = form.draft;
    else form.classes.push(form.draft);
    form.draft = null;
    form.draftAt = -1;
    closeSheet();
    render();
  },
  'class.remove': () => {
    if (form.draftAt >= 0) form.classes.splice(form.draftAt, 1);
    form.draft = null;
    form.draftAt = -1;
    closeSheet();
    render();
  },

  how: (arg) => {
    capture();
    const [key, value] = String(arg).split('|');
    form.how[key] = value;
    render();
  },
  tag: (name) => {
    capture();
    const at = form.tags.indexOf(name);
    if (at >= 0) form.tags.splice(at, 1);
    else form.tags.push(name);
    render();
  },

  'sheet.close': () => {
    form.draft = null;
    form.draftAt = -1;
    closeSheet();
  },

  submit: async () => {
    capture();
    const unfinished = W.firstUnfinished(form);
    if (unfinished) {
      form.step = unfinished;
      form.show = true;
      render();
      return toast('Please finish this step first', 'bad');
    }

    form.sending = true;
    form.failed = null;
    render();
    try {
      form.done = await api.onboardSubmit({ k: form.key, ...W.toPayload(form) });
    } catch (err) {
      form.failed = err.message;
    } finally {
      form.sending = false;
      render();
    }
  },

  again: () => {
    Object.assign(form, W.emptyAnswers(), { step: 1, show: false, done: null, failed: null });
    render();
  },
};

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-a]');
  if (!el) return;
  if (el.tagName === 'A' && el.getAttribute('href')) return;
  event.preventDefault();
  const run = ACTIONS[el.dataset.a];
  if (run) run(el.dataset.i);
});

/* ---------------------------------------------------------------- boot --- */

async function boot() {
  document.documentElement.dataset.mode = 'night';
  loadFonts();

  form.key = new URL(location.href).searchParams.get('k') || '';
  render();

  if (!form.key) {
    form.error = 'This link is not complete.';
    render();
    return;
  }
  try {
    await api.onboardConfig(form.key);
    form.ready = true;
  } catch {
    // The API says 404 for a bad key, on purpose. Say the same thing.
    form.error = 'This link is not valid.';
  }
  render();
}

boot();

export { form, toLkMobile, formatLkMobile };
