/**
 * Role picker and PIN pad (section 3.1).
 *
 * The code is only ever checked on the server: this screen collects digits and
 * posts them. A wrong code shakes the dots, and after too many tries the
 * server itself refuses for a while.
 */

import { api } from '../api.js';
import { t } from '../i18n.js';
import { S, savePrefs, applyTheme } from '../state.js';
import { card, esc, iconButton, muted, pill, toast } from '../ui.js';

const L = {
  role: null, // 'Teacher' | 'Parent' | 'Student'
  pin: '',
  checking: false,
  shake: false,
};

const ROLES = [
  { key: 'teacher', label: 'teacher', blurb: 'teacher_blurb', glyph: '🎓' },
  { key: 'parent', label: 'parent', blurb: 'parent_blurb', glyph: '👪' },
  { key: 'student', label: 'student', blurb: 'student_blurb', glyph: '🎒' },
];

const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

function rolePicker() {
  return `
    <div class="row sp top-row">
      ${iconButton(S.lang === 'en' ? 'த' : 'EN', { act: 'lang.toggle', aria: t('language') })}
      ${iconButton('◐', { act: 'theme.toggle', aria: t('appearance') })}
    </div>
    <div class="brand"><img class="logo" src="/assets/logo.png" alt="Plus" width="140" height="70"></div>
    <h1 class="center">${esc(t('who_are_you'))}</h1>
    ${ROLES.map((r) =>
      card(
        `<div class="row"><span class="role-ic" aria-hidden="true">${r.glyph}</span>
          <div class="g"><b class="role-n">${esc(t(r.label))}</b>${muted(t(r.blurb))}</div>
          <span class="mu" aria-hidden="true">›</span></div>`,
        { act: 'login.role', arg: r.key, cls: 'tap' },
      ),
    ).join('')}
    ${S.demoHint ? `<p class="mu center">Demo codes: Teacher 1234 · Parent/Student 3333, 4444</p>` : ''}
  `;
}

function pinPad() {
  const dots = Array.from({ length: S.codeLength }, (_, i) =>
    `<i class="${i < L.pin.length ? 'f' : ''}"></i>`,
  ).join('');

  return `
    <div class="row sp top-row">
      ${iconButton('←', { act: 'login.unrole', aria: t('back') })}
      ${pill(t(L.role), 't')}
      <span class="spacer"></span>
    </div>
    <h1 class="center mt">${esc(t('enter_code'))}</h1>
    <div class="pin${L.shake ? ' shake' : ''}" id="pin" aria-label="${esc(t('enter_code'))}">${dots}</div>
    <p class="mu center pin-note">${L.checking ? esc(t('checking')) : '&nbsp;'}</p>
    <div class="pad">
      ${PAD.map((k) =>
        k === ''
          ? '<span></span>'
          : `<button type="button" data-a="login.key" data-i="${esc(k)}" aria-label="${esc(k)}">${esc(k)}</button>`,
      ).join('')}
    </div>
    ${S.demoHint ? `<p class="mu center mt">Demo: Teacher 1234 · Parent/Student 3333, 4444</p>` : ''}
  `;
}

export const view = () => (L.role ? pinPad() : rolePicker());

export const ACTIONS = {
  'login.role': (role, _el, { render }) => {
    L.role = role;
    L.pin = '';
    render();
  },

  'login.unrole': (_arg, _el, { render }) => {
    L.role = null;
    L.pin = '';
    L.shake = false;
    render();
  },

  'lang.toggle': (_arg, _el, { render }) => {
    S.lang = S.lang === 'en' ? 'ta' : 'en';
    savePrefs();
    render();
  },

  'theme.toggle': (_arg, _el, { render }) => {
    S.theme = S.theme === 'day' ? 'night' : 'day';
    savePrefs();
    applyTheme();
    render();
  },

  'login.key': async (key, _el, ctx) => {
    if (L.checking) return;
    if (key === '⌫') {
      L.pin = L.pin.slice(0, -1);
      L.shake = false;
      ctx.render();
      return;
    }
    if (L.pin.length >= S.codeLength) return;
    L.pin += key;
    L.shake = false;
    ctx.render();
    if (L.pin.length === S.codeLength) await submit(ctx);
  },
};

async function submit(ctx) {
  L.checking = true;
  ctx.render();
  try {
    const session = await api.login(L.role, L.pin);
    L.pin = '';
    L.checking = false;
    L.role = null;
    await ctx.onSignedIn(session);
  } catch (err) {
    L.checking = false;
    L.pin = '';
    L.shake = true;
    ctx.render();
    toast(err.message || t('wrong_code'), 'bad');
    setTimeout(() => {
      L.shake = false;
      if (!S.role) ctx.render();
    }, 500);
  }
}

/** Used by "Log out" so the next login starts at the role picker. */
export function resetLogin() {
  L.role = null;
  L.pin = '';
  L.checking = false;
  L.shake = false;
}
