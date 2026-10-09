/**
 * Role picker and the full-screen code entry (section 3.1, improvement plan
 * point 5).
 *
 * The code screen is now a lock screen: the whole display, a teal glow on
 * black, nothing else on it. Four dots fill as the digits are pressed and the
 * last digit checks the code straight away - there is no Enter button.
 *
 * The code itself is only ever checked on the server. The lock-out counted
 * here is a courtesy so the teacher sees why nothing is happening; the real
 * limit is in /api/auth and cannot be skipped by reloading the page.
 */

import { api } from '../api.js';
import { t } from '../i18n.js';
import { S, savePrefs, applyTheme } from '../state.js';
import { card, esc, iconButton, muted, toast } from '../ui.js';

const L = {
  role: null, // 'teacher' | 'parent' | 'student'
  pin: '',
  checking: false,
  shake: false,
  wrong: 0, // wrong codes in a row
  lockedUntil: 0, // epoch ms; 0 when not locked out
};

let lockTimer = null;

const ROLES = [
  { key: 'teacher', label: 'teacher', blurb: 'teacher_blurb', glyph: '🎓' },
  { key: 'parent', label: 'parent', blurb: 'parent_blurb', glyph: '👪' },
  { key: 'student', label: 'student', blurb: 'student_blurb', glyph: '🎒' },
];

/** The letters under each digit, exactly as a phone lock screen has them. */
const PAD = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
  null, // the empty bottom-left cell
  ['0', ''],
  ['⌫', ''],
];

/** Point 5: five wrong codes costs 30 seconds, then a minute, then two. */
const LOCK_AFTER = 5;
const lockSeconds = (strikes) => 30 * 2 ** Math.max(0, strikes - LOCK_AFTER);

const secondsLeft = () => Math.max(0, Math.ceil((L.lockedUntil - Date.now()) / 1000));
const isLocked = () => secondsLeft() > 0;

/* ------------------------------------------------------------- screens --- */

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

/** Point 5: the lock screen. Nothing else is visible while it is up. */
function lockScreen() {
  const locked = isLocked();
  const dots = Array.from(
    { length: S.codeLength },
    (_, i) => `<i class="${i < L.pin.length ? 'f' : ''}"></i>`,
  ).join('');

  const note = locked
    ? { text: t('too_many_tries', { n: secondsLeft() }), bad: true }
    : L.checking
      ? { text: t('checking'), bad: false }
      : L.shake
        ? { text: t('wrong_code'), bad: true }
        : { text: '', bad: false };

  return `
    <div class="lock">
      <span class="lock-role">${esc(t(L.role))}</span>
      <h1>${esc(t('enter_code'))}</h1>
      <div class="pin${L.shake ? ' shake' : ''}" id="pin" role="status"
        aria-label="${esc(t('enter_code'))}">${dots}</div>
      <p class="lock-note${note.bad ? ' no' : ''}">${esc(note.text) || '&nbsp;'}</p>

      <div class="pad">
        ${PAD.map((key) => {
          if (!key) return '<button type="button" class="blank" tabindex="-1" aria-hidden="true"></button>';
          const [digit, letters] = key;
          return `<button type="button" data-a="login.key" data-i="${esc(digit)}"
            aria-label="${esc(digit === '⌫' ? t('back') : digit)}"${locked ? ' disabled' : ''}>
            <span>${esc(digit)}</span>${letters ? `<em aria-hidden="true">${letters}</em>` : ''}
          </button>`;
        }).join('')}
      </div>

      <div class="lock-foot">
        <button type="button" data-a="login.forgot">${esc(t('forgot_code'))}</button>
        <button type="button" data-a="login.unrole">${esc(t('cancel'))}</button>
      </div>
      ${S.demoHint ? `<p class="lock-note">Demo: Teacher 1234 · Parent/Student 3333, 4444</p>` : ''}
    </div>
  `;
}

export const view = () => (L.role ? lockScreen() : rolePicker());

/* ------------------------------------------------------------- actions --- */

export const ACTIONS = {
  'login.role': (role, _el, { render }) => {
    L.role = role;
    L.pin = '';
    L.shake = false;
    render();
  },

  'login.unrole': (_arg, _el, { render }) => {
    resetLogin();
    render();
  },

  /**
   * Codes are stored hashed, so a lost one cannot be read back: the teacher
   * issues a new one from the student's screen and reads it out.
   */
  'login.forgot': () => {
    toast(t('code_hashed'), 'info');
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
    if (L.checking || isLocked()) return;
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
    // Point 5: the last digit checks the code at once, with no Enter button.
    if (L.pin.length === S.codeLength) await submit(ctx);
  },
};

async function submit(ctx) {
  L.checking = true;
  ctx.render();
  try {
    const session = await api.login(L.role, L.pin);
    stopLockTimer();
    L.pin = '';
    L.checking = false;
    L.role = null;
    L.wrong = 0;
    L.lockedUntil = 0;
    await ctx.onSignedIn(session);
  } catch (err) {
    L.checking = false;
    L.pin = '';
    L.shake = true;
    L.wrong += 1;

    // Point 5: the dots shake and clear, and the phone buzzes where it may.
    try {
      navigator.vibrate?.(120);
    } catch {
      /* vibration is not allowed on every device, and that is fine */
    }

    if (L.wrong >= LOCK_AFTER) {
      L.lockedUntil = Date.now() + lockSeconds(L.wrong) * 1000;
      startLockTimer(ctx);
    }
    ctx.render();
    if (!isLocked()) toast(err.message || t('wrong_code'), 'bad');

    setTimeout(() => {
      L.shake = false;
      if (!S.role) ctx.render();
    }, 500);
  }
}

/** Count the lock-out down on screen, so the wait never looks like a freeze. */
function startLockTimer(ctx) {
  stopLockTimer();
  lockTimer = setInterval(() => {
    if (!isLocked()) {
      stopLockTimer();
      L.lockedUntil = 0;
    }
    if (!S.role && L.role) ctx.render();
  }, 1000);
}

function stopLockTimer() {
  if (lockTimer) clearInterval(lockTimer);
  lockTimer = null;
}

/** Used by "Log out" so the next login starts at the role picker. */
export function resetLogin() {
  stopLockTimer();
  L.role = null;
  L.pin = '';
  L.checking = false;
  L.shake = false;
  L.wrong = 0;
  L.lockedUntil = 0;
}
