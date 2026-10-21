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
import { lkMobileError } from '../rules.js';
import { S, savePrefs, applyTheme } from '../state.js';
import {
  actionButton,
  button,
  card,
  chip,
  esc,
  field,
  iconButton,
  label,
  muted,
  telField,
  telValue,
  toast,
  wireTelFields,
} from '../ui.js';

const L = {
  role: null, // 'teacher' | 'parent' | 'student'
  pin: '',
  checking: false,
  shake: false,
  wrong: 0, // wrong codes in a row
  lockedUntil: 0, // epoch ms; 0 when not locked out

  /*
   * How a teacher is signing in. Families only ever use a code - that is the
   * right trade for a parent on a shared phone. A teacher's account is their
   * livelihood, so it gets an email and a password.
   */
  how: 'password', // 'password' | 'code'
  mode: 'in', // 'in' = sign in, 'up' = make an account
  busy: false,
  error: null,
  signup: { title: 'Mr', name: '', email: '', phone: '', password: '', area: '', subjects: [] },
};

const SUBJECTS = ['Maths', 'Science', 'English', 'ICT', 'Commerce', 'Combined Maths'];
const TITLES = ['Mr', 'Mrs', 'Miss', 'Ms', 'Dr'];

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

/* ------------------------------------------------- the teacher's own way -- */

/** Read the boxes back before any redraw, so nothing typed is lost. */
function captureSignup() {
  const read = (id) => document.getElementById(id);
  const set = (key, id) => {
    const el = read(id);
    if (el) L.signup[key] = el.value;
  };
  set('name', 'su-name');
  set('email', 'su-email');
  set('password', 'su-pass');
  set('area', 'su-area');
  const title = read('su-title');
  if (title) L.signup.title = title.value;
  const tel = read('su-phone');
  if (tel) L.signup.phone = tel.value;
}

function captureSignin() {
  const email = document.getElementById('si-email');
  const pass = document.getElementById('si-pass');
  if (email) L.signup.email = email.value;
  if (pass) L.signup.password = pass.value;
}

const topBar = () => `
  <div class="row sp top-row">
    ${iconButton('←', { act: 'login.unrole', aria: t('back') })}
    ${iconButton(S.lang === 'en' ? 'த' : 'EN', { act: 'lang.toggle', aria: t('language') })}
  </div>`;

/** Sign in with an email and a password. */
function signInScreen() {
  return `
    ${topBar()}
    <h1 class="center mt">${esc(t('teacher_sign_in'))}</h1>
    ${L.error ? `<p class="fld-note no center">${esc(L.error)}</p>` : ''}

    ${field('si-email', t('email'), {
      type: 'email',
      value: L.signup.email,
      placeholder: 'you@example.com',
    })}
    ${field('si-pass', t('password'), { type: 'password', value: L.signup.password })}

    ${actionButton(t('sign_in'), {
      act: 'login.password',
      cls: 'wide',
      busy: L.busy,
      busyText: t('checking'),
    })}

    <p class="mu center mt">${esc(t('no_account'))}
      <button type="button" class="link-btn" data-a="login.tosignup">${esc(t('create_account'))}</button>
    </p>
    <p class="mu center">
      <button type="button" class="link-btn" data-a="login.tocode">${esc(t('use_code_instead'))}</button>
    </p>
  `;
}

/** Make a teacher account. Everything here is needed to use the app at all. */
function signUpScreen() {
  const su = L.signup;
  return `
    ${topBar()}
    <h1 class="center">${esc(t('create_account'))}</h1>
    <p class="mu center">${esc(t('signup_blurb'))}</p>
    ${L.error ? `<p class="fld-note no center">${esc(L.error)}</p>` : ''}

    ${label(t('full_name'))}
    <div class="row gap">
      <div style="flex:0 0 88px">
        <label class="fld"><select id="su-title">${TITLES.map(
          (x) => `<option value="${esc(x)}"${x === su.title ? ' selected' : ''}>${esc(x)}</option>`,
        ).join('')}</select></label>
      </div>
      <div class="g">${field('su-name', '', { value: su.name, placeholder: 'Shehan Asher' })}</div>
    </div>

    ${field('su-email', t('email'), {
      type: 'email',
      value: su.email,
      required: true,
      placeholder: 'you@example.com',
    })}
    ${telField('su-phone', t('whatsapp_number'), { value: su.phone })}
    ${field('su-pass', t('password'), { type: 'password', value: su.password })}
    <p class="fld-hint">${esc(t('password_rule'))}</p>

    ${label(t('subjects_you_teach'))}
    <div class="chips">${SUBJECTS.map((x) =>
      chip(x, { act: 'login.subject', arg: x, on: su.subjects.includes(x) }),
    ).join('')}</div>

    ${field('su-area', t('area'), { value: su.area, placeholder: 'Nugegoda' })}

    ${actionButton(t('create_account'), {
      act: 'login.signup',
      cls: 'gr wide',
      busy: L.busy,
      busyText: t('checking'),
    })}
    <p class="mu center">
      <button type="button" class="link-btn" data-a="login.tosignin">${esc(t('have_account'))}</button>
    </p>
  `;
}

export const view = () => {
  if (!L.role) return rolePicker();
  // Families only ever use a code; teachers choose.
  if (L.role !== 'teacher' || L.how === 'code') return lockScreen();
  return L.mode === 'up' ? signUpScreen() : signInScreen();
};

/* ------------------------------------------------------------- actions --- */

export const ACTIONS = {
  'login.role': (role, _el, { render }) => {
    L.role = role;
    L.pin = '';
    L.shake = false;
    L.error = null;
    // A teacher lands on email and password; a family lands on the keypad.
    L.how = role === 'teacher' ? 'password' : 'code';
    L.mode = 'in';
    render();
  },

  /* ---- the teacher's email and password ---- */
  'login.tocode': (_a, _el, { render }) => {
    L.how = 'code';
    L.error = null;
    render();
  },
  'login.tosignup': (_a, _el, { render }) => {
    captureSignin();
    L.mode = 'up';
    L.error = null;
    render();
  },
  'login.tosignin': (_a, _el, { render }) => {
    captureSignup();
    L.mode = 'in';
    L.error = null;
    render();
  },
  'login.subject': (name, _el, { render }) => {
    captureSignup();
    const at = L.signup.subjects.indexOf(name);
    if (at >= 0) L.signup.subjects.splice(at, 1);
    else L.signup.subjects.push(name);
    render();
  },

  'login.password': async (_a, _el, ctx) => {
    captureSignin();
    const { email, password } = L.signup;
    if (!email.trim() || !password) {
      L.error = t('enter_email_password');
      return ctx.render();
    }
    L.busy = true;
    L.error = null;
    ctx.render();
    try {
      const session = await api.login(null, null, { email: email.trim(), password });
      L.busy = false;
      resetLogin();
      await ctx.onSignedIn(session);
    } catch (err) {
      L.busy = false;
      L.error = err.message;
      ctx.render();
    }
  },

  'login.signup': async (_a, _el, ctx) => {
    captureSignup();
    const su = L.signup;

    // Checked here so the person is told which box is wrong, not just that
    // something is. The server checks all of it again regardless.
    const phone = telValue('su-phone');
    if (su.name.trim().length < 2) L.error = t('enter_name');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(su.email.trim())) L.error = t('enter_email');
    else if (lkMobileError(su.phone) || !phone) L.error = t('tel_nine');
    else if (su.password.length < 8) L.error = t('password_rule');
    else if (!su.subjects.length) L.error = t('pick_subject');
    else L.error = null;

    if (L.error) return ctx.render();

    L.busy = true;
    ctx.render();
    try {
      const session = await api.signup({
        title: su.title,
        name: su.name.trim(),
        email: su.email.trim(),
        phone,
        password: su.password,
        subjects: su.subjects,
        area: su.area.trim(),
        lang: S.lang,
      });
      L.busy = false;
      resetLogin();
      await ctx.onSignedIn(session);
    } catch (err) {
      L.busy = false;
      L.error = err.message;
      ctx.render();
    }
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
  L.how = 'password';
  L.mode = 'in';
  L.busy = false;
  L.error = null;
  // The password never outlives the attempt that used it.
  L.signup = { title: 'Mr', name: '', email: '', phone: '', password: '', area: '', subjects: [] };
}

/** The +94 boxes on the sign-up form need their live formatting. */
export function afterLogin() {
  wireTelFields(document.getElementById('scr'));
}
