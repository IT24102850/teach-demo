/**
 * The public sign-up form (section 7.7 / 8.1 "Send sign-up link").
 *
 * No login: the teacher's key in the link decides which subjects and curricula
 * to show. A submission creates a `pending` student and nothing more.
 */

import { api } from './api.js';
import { t, setLang } from './i18n.js';
import { button, card, chip, esc, field, label, muted, toast } from './ui.js';

const host = document.getElementById('join');

const form = {
  key: '',
  teacher: null,
  subjects: [],
  curricula: [],
  wanted: [],
  curriculum: 'Local',
  sending: false,
  done: false,
};

function teacherKey() {
  const url = new URL(location.href);
  const fromQuery = url.searchParams.get('t');
  if (fromQuery) return fromQuery;
  const parts = url.pathname.split('/').filter(Boolean);
  return parts[0] === 'join' && parts[1] ? parts[1] : '';
}

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

function render() {
  if (form.done) {
    host.innerHTML = `
      <div class="brand"><img class="logo" src="/assets/logo.png" alt="Plus" width="140" height="70"></div>
      <h1 class="center">${esc(t('join_thanks'))}</h1>
      <p class="mu center">${esc(t('join_done', { teacher: form.teacher }))}</p>
      ${card(`${label(t('family_code'))}${muted(t('join_blurb'))}`)}`;
    return;
  }

  if (!form.teacher) {
    host.innerHTML = `<p class="mu center mt">${esc(form.error || t('loading'))}</p>`;
    return;
  }

  host.innerHTML = `
    <div class="brand"><img class="logo" src="/assets/logo.png" alt="Plus" width="140" height="70"></div>
    <h1>${esc(t('join_title', { teacher: form.teacher }))}</h1>
    <p class="mu">${esc(t('join_blurb'))}</p>

    <form id="join-form" novalidate>
      ${field('j-name', t('student_name'), { required: true })}
      <div class="row gap">
        ${field('j-grade', t('grade'), { type: 'number', min: 1 })}
        ${field('j-school', t('school'))}
      </div>
      ${field('j-area', t('place'))}

      ${label(t('curriculum'))}
      <div class="chips">${form.curricula
        .map((c) => chip(c, { act: 'curriculum', arg: c, on: form.curriculum === c }))
        .join('')}</div>

      ${label(t('subjects_wanted'))}
      <div class="chips">${form.subjects
        .map((s) => chip(s, { act: 'subject', arg: s, on: form.wanted.includes(s) }))
        .join('')}</div>

      ${field('j-parent', t('parent_name'))}
      ${field('j-phone', t('parent_whatsapp'), { required: true, placeholder: '94771234567' })}

      ${button(form.sending ? t('checking') : t('join_send'), {
        act: 'submit',
        cls: 'wide mt',
        disabled: form.sending,
      })}
    </form>`;
}

async function submit() {
  const name = document.getElementById('j-name').value.trim();
  const phone = document.getElementById('j-phone').value.trim();
  if (!name) return toast(t('student_name'), 'bad');
  if (!phone) return toast(t('parent_whatsapp'), 'bad');

  form.sending = true;
  render();
  try {
    const result = await api.joinSubmit({
      t: form.key,
      name,
      grade: document.getElementById('j-grade').value,
      school: document.getElementById('j-school').value,
      area: document.getElementById('j-area').value,
      curriculum: form.curriculum,
      subjects: form.wanted,
      parent_name: document.getElementById('j-parent').value,
      parent_phone: phone,
    });
    form.teacher = result.teacher || form.teacher;
    form.done = true;
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    form.sending = false;
    render();
  }
}

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-a]');
  if (!el) return;
  event.preventDefault();
  const action = el.dataset.a;
  const arg = el.dataset.i;

  if (action === 'curriculum') {
    form.curriculum = arg;
    render();
  } else if (action === 'subject') {
    const at = form.wanted.indexOf(arg);
    if (at >= 0) form.wanted.splice(at, 1);
    else form.wanted.push(arg);
    render();
  } else if (action === 'submit') {
    submit();
  }
});

async function boot() {
  applyPrefs();
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
    form.curriculum = config.curricula[0] || 'Local';
  } catch (err) {
    form.error = err.message;
  }
  render();
}

boot();
