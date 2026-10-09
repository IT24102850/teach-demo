/**
 * The public sign-up form (section 7.7, improvement plan points 8 and 15).
 *
 * One question page at a time: four short steps with a progress bar, Back and
 * Next fixed at the bottom, and a check page before Submit. Nothing is sent
 * until the last step, and Back never loses an answer - every field is read
 * into `form` before the screen is redrawn.
 *
 * No login: the teacher's key in the link decides which subjects and
 * curricula to show. A submission creates a `pending` student and nothing
 * more.
 */

import { api } from './api.js';
import { t, setLang } from './i18n.js';
import { loadFonts } from './fonts.js';
import { formatLkMobile, groupLkMobile, lkMobileError, toLkMobile } from './rules.js';
import {
  actionButton,
  button,
  chip,
  esc,
  field,
  footerBar,
  label,
  muted,
  okScreen,
  selectField,
  stepBar,
  stepLabel,
  telField,
  toast,
  wireTelFields,
} from './ui.js';

const host = document.getElementById('join');

const TOTAL = 4;
const STEP_NAMES = ['step_about', 'step_classes', 'step_parent', 'step_check'];

const form = {
  key: '',
  teacher: null,
  subjects: [],
  curricula: [],
  error: null,

  /* step 1 */
  name: '',
  call_name: '',
  callTouched: false,
  grade: '',
  school: '',
  /* step 2 */
  curriculum: '',
  wanted: [],
  ambition: '',
  /* step 3 */
  parent_name: '',
  phone: '',
  parent_occupation: '',
  /* step 4 */
  photo: null, // { data, name }

  /* the wizard itself */
  step: 1,
  show: false, // show the problems on this step
  sending: false,
  done: false,
  failed: null,
};

/* --------------------------------------------------------- step checks --- */

/**
 * What is wrong with the step the person is on, as { fieldId: messageKey }.
 * Next only ever checks the current step, so an unanswered question three
 * steps away never blocks the one in front of them (point 8).
 */
function problems(step = form.step) {
  const bad = {};
  if (step === 1) {
    if (form.name.trim().length < 2) bad['j-name'] = 'enter_name';
    if (!form.call_name.trim()) bad['j-call'] = 'enter_name';
    const g = Number(form.grade);
    if (!Number.isInteger(g) || g < 1 || g > 13) bad['j-grade'] = 'pick_grade';
  }
  if (step === 2) {
    if (form.curricula.length > 1 && !form.curriculum) bad['curriculum'] = 'curriculum';
    if (!form.wanted.length) bad.subjects = 'pick_subject';
  }
  if (step === 3) {
    if (form.parent_name.trim().length < 2) bad['j-parent'] = 'enter_parent_name';
    const tel = lkMobileError(form.phone);
    if (tel) bad['j-phone'] = tel === 'empty' ? 'tel_nine' : tel;
  }
  return bad;
}

const stepOk = (step) => Object.keys(problems(step)).length === 0;

/** Read whatever is on screen into `form`, so Back and Next keep every answer. */
function capture() {
  const read = (id) => document.getElementById(id)?.value ?? null;
  const set = (key, id) => {
    const v = read(id);
    if (v !== null) form[key] = v;
  };
  set('name', 'j-name');
  set('call_name', 'j-call');
  set('grade', 'j-grade');
  set('school', 'j-school');
  set('ambition', 'j-ambition');
  set('parent_name', 'j-parent');
  set('parent_occupation', 'j-job');
  const tel = read('j-phone');
  if (tel !== null) form.phone = tel;

  // "What should we call you?" follows the first name until it is edited.
  if (!form.callTouched) {
    const first = form.name.trim().split(/\s+/)[0] || '';
    if (first && form.call_name !== first) form.call_name = first;
  }
}

/* ------------------------------------------------------------- screens --- */

function errorNote(id, bad) {
  return bad[id] ? `<p class="fld-note no">${esc(t(bad[id]))}</p>` : '';
}

function stepAbout(bad) {
  return `
    <h1>${esc(t('tell_us_student'))}</h1>
    ${stepBar(1, TOTAL)}${stepLabel(1, TOTAL, t('step_about'))}
    ${field('j-name', t('student_name'), {
      value: form.name,
      required: true,
      placeholder: 'Kasun Perera',
      invalid: Boolean(bad['j-name']),
    })}${errorNote('j-name', bad)}
    ${field('j-call', t('call_you_what'), {
      value: form.call_name,
      required: true,
      placeholder: 'Kasun',
      invalid: Boolean(bad['j-call']),
    })}${errorNote('j-call', bad)}
    ${selectField(
      'j-grade',
      t('grade'),
      [{ value: '', label: '—' }].concat(
        Array.from({ length: 13 }, (_, i) => ({
          value: String(i + 1),
          label: `${t('grade')} ${i + 1}`,
        })),
      ),
      String(form.grade || ''),
      { required: true, invalid: Boolean(bad['j-grade']) },
    )}${errorNote('j-grade', bad)}
    ${field('j-school', t('school'), { value: form.school, placeholder: 'e.g. Royal College' })}
  `;
}

function stepClasses(bad) {
  const showCurriculum = form.curricula.length > 1;
  return `
    <h1>${esc(t('what_will_you_study'))}</h1>
    ${stepBar(2, TOTAL)}${stepLabel(2, TOTAL, t('step_classes'))}
    <p class="mu">${esc(t('teacher_subjects_are', { teacher: form.teacher }))}</p>

    ${
      showCurriculum
        ? `${label(t('curriculum'))}<div class="chips">${form.curricula
            .map((c) => chip(c, { act: 'curriculum', arg: c, on: form.curriculum === c }))
            .join('')}</div>${errorNote('curriculum', bad)}`
        : ''
    }

    ${label(t('subjects_pick'))}
    <div class="chips">${form.subjects
      .map((s) =>
        chip(`${form.wanted.includes(s) ? '✓ ' : ''}${s}`, {
          act: 'subject',
          arg: s,
          on: form.wanted.includes(s),
        }),
      )
      .join('')}</div>
    ${errorNote('subjects', bad)}

    ${field('j-ambition', `${t('ambition_q')} (${t('optional')})`, {
      value: form.ambition,
      placeholder: 'Doctor',
    })}
  `;
}

function stepParent(bad) {
  return `
    <h1>${esc(t('your_parent'))}</h1>
    ${stepBar(3, TOTAL)}${stepLabel(3, TOTAL, t('step_parent'))}
    <p class="mu">${esc(t('messages_go_here'))}</p>

    ${field('j-parent', t('parent_name'), {
      value: form.parent_name,
      required: true,
      placeholder: 'Nadeesha Perera',
      invalid: Boolean(bad['j-parent']),
    })}${errorNote('j-parent', bad)}

    ${telField('j-phone', t('parent_whatsapp'), { value: form.phone })}

    ${field('j-job', `${t('parent_occupation')} (${t('optional')})`, {
      value: form.parent_occupation,
      placeholder: 'e.g. Engineer',
    })}
  `;
}

function stepCheck() {
  const rows = [
    [t('student_name'), form.name],
    [t('grade'), `${t('grade')} ${form.grade}${form.curriculum ? ` · ${form.curriculum}` : ''}`],
    [t('subjects_wanted'), form.wanted.join(', ')],
    [t('school'), form.school],
    [t('ambition_q'), form.ambition],
    [t('parent_name'), form.parent_name],
    [t('parent_whatsapp'), formatLkMobile(toLkMobile(form.phone) || form.phone)],
    [t('parent_occupation'), form.parent_occupation],
  ].filter(([, v]) => String(v || '').trim());

  return `
    <h1>${esc(t('almost_done'))}</h1>
    ${stepBar(4, TOTAL)}${stepLabel(4, TOTAL, t('step_check'))}

    <div class="center">
      <button type="button" class="av" data-a="photo.pick"
        style="width:76px;height:76px;font-size:26px;margin:8px auto;border:2px dashed var(--teal);background:${
          form.photo ? 'transparent' : 'var(--card2)'
        }"
        aria-label="${esc(t('add_photo'))}">${
          form.photo
            ? `<img src="${esc(form.photo.data)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
            : '📷'
        }</button>
      <p class="mu">${esc(t('add_photo'))}</p>
      <input id="j-photo" type="file" accept="image/*" hidden>
    </div>

    <div class="card">
      ${rows
        .map(
          ([k, v]) =>
            `<div class="row sp" style="padding:3px 0"><span class="mu">${esc(k)}</span><b class="amt">${esc(
              v,
            )}</b></div>`,
        )
        .join('')}
    </div>
    <p class="mu center">${esc(t('what_next'))}</p>
  `;
}

function render() {
  if (form.done) {
    host.className = '';
    host.innerHTML = okScreen(t('sent_to', { teacher: form.teacher }), t('what_next'), {
      extra: button(t('done'), { act: 'close', cls: 'o wide' }),
    });
    return;
  }

  if (!form.teacher) {
    host.className = '';
    host.innerHTML = `<p class="mu center mt">${esc(form.error || t('loading'))}</p>`;
    return;
  }

  const bad = form.show ? problems() : {};
  const body =
    form.step === 1
      ? stepAbout(bad)
      : form.step === 2
        ? stepClasses(bad)
        : form.step === 3
          ? stepParent(bad)
          : stepCheck();

  const last = form.step === TOTAL;
  // Point 2: the last step says Submit, the earlier ones say Next. The button
  // is dimmed until the step is answered, but tapping it still explains what
  // is missing rather than doing nothing.
  const nextDisabled = !form.sending && !stepOk(form.step);

  host.className = 'has-footer';
  host.innerHTML = `
    <div class="row top-row">
      ${
        form.step > 1
          ? ''
          : `<span class="mu">${esc(t('join_title', { teacher: form.teacher }))}</span>`
      }
    </div>
    ${body}
    ${
      form.failed
        ? `<div class="card warn"><b>${esc(t('could_not_send'))}</b>${muted(form.failed)}</div>`
        : ''
    }
    ${footerBar(
      `${
        form.step > 1
          ? actionButton(t('back'), {
              act: 'step.back',
              cls: 'o back',
              disabled: form.sending,
            })
          : ''
      }${actionButton(last ? (form.failed ? t('try_again') : t('submit')) : t('next'), {
        act: last ? 'submit' : 'step.next',
        cls: last ? 'gr' : '',
        busy: form.sending,
        busyText: t('sending'),
        disabled: nextDisabled,
      })}`,
    )}
  `;

  wireTelFields(host);
  wirePhoto();
}

/* ------------------------------------------------------------- photo ----- */

/**
 * Point 8: a photo is optional, and it is shrunk on the phone before it is
 * sent - a full camera picture would be several megabytes on a mobile
 * connection. If anything goes wrong the sign-up still goes through without
 * the photo.
 */
const PHOTO_PX = 320;

function wirePhoto() {
  const input = document.getElementById('j-photo');
  if (!input || input.dataset.wired) return;
  input.dataset.wired = '1';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) return toast(t('photo_too_big'), 'bad');
    try {
      form.photo = { data: await shrink(file), name: file.name };
    } catch {
      toast(t('photo_too_big'), 'bad');
    }
    render();
  });
}

/** Draw the picture into a small square and read it back as a JPEG. */
function shrink(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const side = Math.min(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = PHOTO_PX;
        canvas.height = PHOTO_PX;
        canvas
          .getContext('2d')
          .drawImage(
            img,
            (img.width - side) / 2,
            (img.height - side) / 2,
            side,
            side,
            0,
            0,
            PHOTO_PX,
            PHOTO_PX,
          );
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('not an image'));
    };
    img.src = url;
  });
}

/* ------------------------------------------------------------- sending --- */

async function submit() {
  capture();
  // Every step is checked again here: the dimmed button is a hint, not a lock.
  for (let step = 1; step <= 3; step += 1) {
    if (stepOk(step)) continue;
    form.step = step;
    form.show = true;
    render();
    return toast(t('fill_this_step'), 'bad');
  }

  form.sending = true;
  form.failed = null;
  render();
  try {
    const result = await api.joinSubmit({
      t: form.key,
      name: form.name.trim(),
      call_name: form.call_name.trim(),
      grade: Number(form.grade),
      school: form.school.trim(),
      curriculum: form.curriculum || form.curricula[0] || 'Local',
      subjects: form.wanted,
      ambition: form.ambition.trim(),
      parent_name: form.parent_name.trim(),
      parent_occupation: form.parent_occupation.trim(),
      parent_phone: toLkMobile(form.phone),
      photo: form.photo?.data || null,
    });
    form.teacher = result.teacher || form.teacher;
    form.done = true;
  } catch (err) {
    // Point 2: nothing typed is lost - the same button becomes "Try again".
    form.failed = err.message;
  } finally {
    form.sending = false;
    render();
  }
}

/* -------------------------------------------------------------- wiring --- */

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-a]');
  if (!el) return;
  event.preventDefault();
  const action = el.dataset.a;
  const arg = el.dataset.i;

  if (action === 'curriculum') {
    capture();
    form.curriculum = arg;
    render();
  } else if (action === 'subject') {
    capture();
    const at = form.wanted.indexOf(arg);
    if (at >= 0) form.wanted.splice(at, 1);
    else form.wanted.push(arg);
    render();
  } else if (action === 'step.next') {
    capture();
    if (!stepOk(form.step)) {
      form.show = true;
      render();
      return void toast(t('fill_this_step'), 'bad');
    }
    form.show = false;
    form.step = Math.min(TOTAL, form.step + 1);
    render();
    host.scrollTop = 0;
  } else if (action === 'step.back') {
    capture();
    form.show = false;
    form.step = Math.max(1, form.step - 1);
    render();
    host.scrollTop = 0;
  } else if (action === 'photo.pick') {
    document.getElementById('j-photo')?.click();
  } else if (action === 'submit') {
    submit();
  } else if (action === 'close') {
    window.close();
  }
});

/** Typing in the short-name box stops it following the full name. */
document.addEventListener('input', (event) => {
  if (event.target?.id === 'j-call') form.callTouched = true;
});

/* ---------------------------------------------------------------- boot --- */

function applyPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem('plus.prefs') || '{}');
    if (['en', 'ta'].includes(saved.lang)) setLang(saved.lang);
    document.documentElement.dataset.lang = saved.lang || 'en';
    document.documentElement.dataset.mode = saved.theme === 'day' ? 'day' : 'night';
  } catch {
    document.documentElement.dataset.mode = 'night';
  }
}

async function boot() {
  applyPrefs();
  loadFonts();
  form.key = teacherKey();
  render();
  if (!form.key) {
    form.error = 'That sign-up link is not complete.';
    render();
    return;
  }
  try {
    const config = await api.joinConfig(form.key);
    form.teacher = `${config.teacher.name}${config.teacher.title ? ` ${config.teacher.title}` : ''}`;
    form.subjects = config.subjects;
    form.curricula = config.curricula;
    // Hidden when the teacher offers only one, and then chosen for them.
    form.curriculum = config.curricula.length === 1 ? config.curricula[0] : '';
  } catch (err) {
    form.error = err.message;
  }
  render();
}

function teacherKey() {
  const url = new URL(location.href);
  const fromQuery = url.searchParams.get('t');
  if (fromQuery) return fromQuery;
  const parts = url.pathname.split('/').filter(Boolean);
  return parts[0] === 'join' && parts[1] ? parts[1] : '';
}

boot();

/* Exported for the tests: the step rules are the heart of this screen. */
export { form, problems, stepOk, TOTAL };
export { groupLkMobile };
