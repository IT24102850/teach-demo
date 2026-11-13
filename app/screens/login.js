/**
 * Signing in, and every way back in (migration 008).
 *
 *   Teacher   email + password · make an account · "Forgot password?" sends
 *             a one-time link by email, which opens the reset screen here.
 *             A teacher set up by the Plus team may sign in with the login
 *             code they were given instead.
 *   Parent    mobile number + password · "I have an invite code" is the one
 *             flow for a first sign-in, another child, and a lost password:
 *             the code reached the parent's own WhatsApp, which is the proof.
 *   Student   username + password, made by their parent in the family app.
 *             A forgotten one is reset by the parent, not here.
 *
 * Every check that matters runs on the server. What is checked here is only
 * so the person is told which box is wrong before a round trip.
 */

import { api } from '../api.js';
import { t } from '../i18n.js';
import { lkMobileError } from '../rules.js';
import { S, savePrefs, applyTheme } from '../state.js';
import {
  actionButton,
  card,
  chip,
  esc,
  field,
  iconButton,
  label,
  langPicker,
  muted,
  telField,
  telValue,
  wireTelFields,
} from '../ui.js';

const blankSignup = () => ({ title: 'Mr', subjects: [] });

const L = {
  role: null, // 'teacher' | 'parent' | 'student'
  /*
   *   in      sign in                 (everyone)
   *   up      make a teacher account  (teacher)
   *   forgot  ask for a reset link    (teacher)
   *   sent    the link is on its way  (teacher)
   *   reset   choose a new password   (teacher, from the emailed link)
 *   code    a login code            (teacher, set up by the Plus team)
   *   invite  use an invite code      (parent)
   */
  mode: 'in',
  busy: false,
  error: null,
  /* What has been typed, read back before each redraw so nothing is lost. */
  form: {},
  signup: blankSignup(),
  resetToken: null,
};

const SUBJECTS = ['Maths', 'Science', 'English', 'ICT', 'Commerce', 'Combined Maths'];
const TITLES = ['Mr', 'Mrs', 'Miss', 'Ms', 'Dr', 'Rev'];

const ROLES = [
  { key: 'teacher', label: 'teacher', blurb: 'teacher_blurb', glyph: '🎓' },
  { key: 'parent', label: 'parent', blurb: 'parent_blurb', glyph: '👪' },
  { key: 'student', label: 'student', blurb: 'student_blurb', glyph: '🎒' },
];

/* Every box on these screens, so a redraw can put back what was typed. */
const FIELDS = [
  'si-email', 'si-pass', 'tc-code',
  'su-title', 'su-name', 'su-email', 'su-phone', 'su-pass', 'su-area',
  'fg-email', 'rs-pass', 'rs-again',
  'pi-phone', 'pi-pass',
  'iv-phone', 'iv-code', 'iv-name', 'iv-pass', 'iv-again',
  'st-user', 'st-pass',
];

/** Keep every box's value across a redraw. */
function capture() {
  for (const id of FIELDS) {
    const el = document.getElementById(id);
    if (el) L.form[id] = el.value;
  }
}

const v = (id) => L.form[id] ?? '';

/** The +94 box keeps its own formatting; read it as 947XXXXXXXX. */
const phoneOf = (id) => telValue(id) || null;

/* ------------------------------------------------------------- screens --- */

function rolePicker() {
  return `
    <div class="row sp top-row">
      ${langPicker('lang.set')}
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
  `;
}

const topBar = (back = 'login.unrole') => `
  <div class="row sp top-row">
    ${iconButton('←', { act: back, aria: t('back') })}
    ${langPicker('lang.set')}
  </div>`;

const errorLine = () => (L.error ? `<p class="fld-note no center" role="alert">${esc(L.error)}</p>` : '');

const submit = (text, act, cls = 'wide') =>
  actionButton(text, { act, cls, busy: L.busy, busyText: t('checking') });

const link = (text, act) =>
  `<button type="button" class="link-btn" data-a="${esc(act)}">${esc(text)}</button>`;

/* ---- teacher ---- */

function teacherSignIn() {
  return `
    ${topBar()}
    <h1 class="center mt">${esc(t('teacher_sign_in'))}</h1>
    ${errorLine()}
    ${field('si-email', t('email'), { type: 'email', value: v('si-email'), placeholder: 'you@example.com' })}
    ${field('si-pass', t('password'), { type: 'password', value: v('si-pass') })}
    ${submit(t('sign_in'), 'login.teacher')}
    <p class="mu center">${link(t('forgot_password'), 'login.toforgot')}</p>
    <p class="mu center mt">${esc(t('no_account'))} ${link(t('create_account'), 'login.tosignup')}</p>
    <p class="mu center">${link(t('use_code_instead'), 'login.tocode')}</p>
  `;
}

/** The login code the Plus team gives a teacher it sets up. */
function teacherCode() {
  return `
    ${topBar('login.tosignin')}
    <h1 class="center mt">${esc(t('teacher_sign_in'))}</h1>
    ${errorLine()}
    <label class="fld"><span class="lbl">${esc(t('login_code'))}</span>
      <input id="tc-code" type="password" inputmode="numeric" autocomplete="one-time-code"
        maxlength="${S.codeLength || 6}" value="${esc(v('tc-code'))}" placeholder="••••••"></label>
    ${submit(t('sign_in'), 'login.teachercode')}
  `;
}

function teacherSignUp() {
  const su = L.signup;
  return `
    ${topBar('login.tosignin')}
    <h1 class="center">${esc(t('create_account'))}</h1>
    <p class="mu center">${esc(t('signup_blurb'))}</p>
    ${errorLine()}

    ${label(t('full_name'))}
    <div class="row gap">
      <div style="flex:0 0 88px">
        <label class="fld"><select id="su-title" aria-label="${esc(t('title'))}">${TITLES.map(
          (x) => `<option value="${esc(x)}"${x === (v('su-title') || su.title) ? ' selected' : ''}>${esc(x)}</option>`,
        ).join('')}</select></label>
      </div>
      <div class="g">${field('su-name', '', { value: v('su-name'), placeholder: 'Shehan Asher' })}</div>
    </div>
    ${field('su-email', t('email'), { type: 'email', value: v('su-email'), required: true, placeholder: 'you@example.com' })}
    ${telField('su-phone', t('whatsapp_number'), { value: v('su-phone') })}
    ${field('su-pass', t('password'), { type: 'password', value: v('su-pass') })}
    <p class="fld-hint">${esc(t('password_rule'))}</p>

    ${label(t('subjects_you_teach'))}
    <div class="chips">${SUBJECTS.map((x) =>
      chip(x, { act: 'login.subject', arg: x, on: su.subjects.includes(x) }),
    ).join('')}</div>
    ${field('su-area', t('area'), { value: v('su-area'), placeholder: 'Nugegoda' })}

    ${submit(t('create_account'), 'login.signup', 'gr wide')}
    <p class="mu center">${link(t('have_account'), 'login.tosignin')}</p>
  `;
}

function teacherForgot() {
  return `
    ${topBar('login.tosignin')}
    <h1 class="center mt">${esc(t('forgot_title'))}</h1>
    <p class="mu center">${esc(t('forgot_blurb'))}</p>
    ${errorLine()}
    ${field('fg-email', t('email'), { type: 'email', value: v('fg-email'), placeholder: 'you@example.com' })}
    ${submit(t('send_reset_link'), 'login.forgot')}
  `;
}

function teacherSent() {
  return `
    ${topBar('login.tosignin')}
    <div class="ok-screen">
      <div class="ok-tick" aria-hidden="true">✉</div>
      <h1>${esc(t('reset_sent_title'))}</h1>
      <p class="mu">${esc(t('reset_sent', { email: v('fg-email') }))}</p>
    </div>
    ${actionButton(t('back_to_sign_in'), { act: 'login.tosignin', cls: 'o wide' })}
  `;
}

function teacherReset() {
  return `
    <div class="row sp top-row"><span></span>${langPicker('lang.set')}</div>
    <h1 class="center mt">${esc(t('reset_title'))}</h1>
    ${errorLine()}
    ${field('rs-pass', t('new_password'), { type: 'password', value: v('rs-pass') })}
    ${field('rs-again', t('new_password_again'), { type: 'password', value: v('rs-again') })}
    <p class="fld-hint">${esc(t('password_rule'))} ${esc(t('password_signs_out'))}</p>
    ${submit(t('save_password'), 'login.reset')}
  `;
}

/* ---- parent ---- */

function parentSignIn() {
  return `
    ${topBar()}
    <h1 class="center mt">${esc(t('parent_sign_in'))}</h1>
    ${errorLine()}
    ${telField('pi-phone', t('mobile_number'), { value: v('pi-phone'), hint: false })}
    ${field('pi-pass', t('password'), { type: 'password', value: v('pi-pass') })}
    ${submit(t('sign_in'), 'login.parent')}
    ${card(
      `<b>${esc(t('first_time_here'))}</b>${muted(t('invite_explain'))}
       ${actionButton(t('have_invite'), { act: 'login.toinvite', cls: 'o wide mt-s' })}`,
    )}
    <p class="mu center">${link(t('forgot_password'), 'login.toinvite')}</p>
  `;
}

function parentInvite() {
  return `
    ${topBar('login.tosignin')}
    <h1 class="center mt">${esc(t('invite_title'))}</h1>
    <p class="mu center">${esc(t('invite_blurb'))}</p>
    ${errorLine()}
    ${telField('iv-phone', t('mobile_number'), { value: v('iv-phone'), hint: false })}
    ${field('iv-code', t('invite_code'), { value: v('iv-code'), inputmode: 'numeric', placeholder: '123456' })}
    ${field('iv-name', t('your_name'), { value: v('iv-name'), placeholder: 'Nadeesha Perera' })}
    ${field('iv-pass', t('choose_password'), { type: 'password', value: v('iv-pass') })}
    ${field('iv-again', t('new_password_again'), { type: 'password', value: v('iv-again') })}
    <p class="fld-hint">${esc(t('password_rule'))}</p>
    ${submit(t('continue'), 'login.activate', 'gr wide')}
    <p class="mu center">${esc(t('invite_forgot_note'))}</p>
  `;
}

/* ---- student ---- */

function studentSignIn() {
  return `
    ${topBar()}
    <h1 class="center mt">${esc(t('student_sign_in'))}</h1>
    ${errorLine()}
    ${field('st-user', t('username'), { value: v('st-user'), placeholder: 'kasun.p' })}
    ${field('st-pass', t('password'), { type: 'password', value: v('st-pass') })}
    ${submit(t('sign_in'), 'login.student')}
    ${card(muted(t('student_login_help')))}
  `;
}

export const view = () => {
  if (L.resetToken) return teacherReset();
  if (!L.role) return rolePicker();
  if (L.role === 'teacher') {
    if (L.mode === 'up') return teacherSignUp();
    if (L.mode === 'forgot') return teacherForgot();
    if (L.mode === 'sent') return teacherSent();
    if (L.mode === 'code') return teacherCode();
    return teacherSignIn();
  }
  if (L.role === 'parent') return L.mode === 'invite' ? parentInvite() : parentSignIn();
  return studentSignIn();
};

/* ------------------------------------------------------------- actions --- */

/** Show a problem from the server, or the one found here, above the boxes. */
function showError(ctx, message) {
  L.busy = false;
  L.error = message;
  ctx.render();
  document.getElementById('scr')?.scrollTo?.({ top: 0, behavior: 'smooth' });
}

/** Run a sign-in request with the button busy, then hand over to the app. */
async function attempt(ctx, request) {
  L.busy = true;
  L.error = null;
  ctx.render();
  try {
    const session = await request();
    resetLogin();
    await ctx.onSignedIn(session);
  } catch (err) {
    showError(ctx, err.message);
  }
}

const go = (mode) => (_a, _el, { render }) => {
  capture();
  L.mode = mode;
  L.error = null;
  render();
};

export const ACTIONS = {
  'login.role': (role, _el, { render }) => {
    L.role = role;
    L.mode = 'in';
    L.error = null;
    render();
  },
  'login.unrole': (_a, _el, { render }) => {
    resetLogin();
    render();
  },
  'login.tosignup': go('up'),
  'login.tosignin': go('in'),
  'login.toforgot': go('forgot'),
  'login.toinvite': go('invite'),
  'login.tocode': go('code'),

  'login.teachercode': async (_a, _el, ctx) => {
    capture();
    const code = v('tc-code').replace(/D/g, '');
    if (code.length < 3) return showError(ctx, t('enter_code'));
    await attempt(ctx, () => api.login('teacher', code));
  },

  'login.subject': (name, _el, { render }) => {
    capture();
    const at = L.signup.subjects.indexOf(name);
    if (at >= 0) L.signup.subjects.splice(at, 1);
    else L.signup.subjects.push(name);
    render();
  },

  'login.teacher': async (_a, _el, ctx) => {
    capture();
    const email = v('si-email').trim();
    const password = v('si-pass');
    if (!email || !password) return showError(ctx, t('enter_email_password'));
    await attempt(ctx, () => api.login(null, null, { email, password }));
  },

  'login.signup': async (_a, _el, ctx) => {
    capture();
    const su = L.signup;
    const phone = phoneOf('su-phone');
    const name = v('su-name').trim();
    const email = v('su-email').trim();
    const password = v('su-pass');
    const problem =
      name.length < 2
        ? t('enter_name')
        : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
          ? t('enter_email')
          : lkMobileError(v('su-phone')) || !phone
            ? t('tel_nine')
            : password.length < 8
              ? t('password_short')
              : !su.subjects.length
                ? t('pick_subject')
                : null;
    if (problem) return showError(ctx, problem);
    await attempt(ctx, () =>
      api.signup({
        title: v('su-title') || su.title,
        name,
        email,
        phone,
        password,
        subjects: su.subjects,
        area: v('su-area').trim(),
        lang: S.lang,
      }),
    );
  },

  'login.forgot': async (_a, _el, ctx) => {
    capture();
    const email = v('fg-email').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showError(ctx, t('enter_email'));
    L.busy = true;
    L.error = null;
    ctx.render();
    try {
      await api.forgotPassword(email);
      L.busy = false;
      L.mode = 'sent';
      ctx.render();
    } catch (err) {
      showError(ctx, err.message);
    }
  },

  'login.reset': async (_a, _el, ctx) => {
    capture();
    const password = v('rs-pass');
    if (password !== v('rs-again')) return showError(ctx, t('passwords_differ'));
    if (password.length < 8) return showError(ctx, t('password_short'));
    const token = L.resetToken;
    await attempt(ctx, async () => {
      await api.resetPassword(token, password);
      // The link must not work twice, nor sit in the address bar.
      history.replaceState(null, '', '/');
      return api.me();
    });
  },

  'login.parent': async (_a, _el, ctx) => {
    capture();
    const phone = phoneOf('pi-phone');
    const password = v('pi-pass');
    if (!phone || !password) return showError(ctx, t('enter_phone_password'));
    await attempt(ctx, () => api.familyLogin({ who: 'parent', phone, password }));
  },

  'login.activate': async (_a, _el, ctx) => {
    capture();
    const phone = phoneOf('iv-phone');
    const code = v('iv-code').replace(/\D/g, '');
    const password = v('iv-pass');
    const problem = !phone
      ? t('tel_nine')
      : code.length !== 6
        ? t('invite_six_digits')
        : password.length < 8
          ? t('password_short')
          : password !== v('iv-again')
            ? t('passwords_differ')
            : null;
    if (problem) return showError(ctx, problem);
    await attempt(ctx, () =>
      api.activate({ phone, code, password, name: v('iv-name').trim(), lang: S.lang }),
    );
  },

  'login.student': async (_a, _el, ctx) => {
    capture();
    const username = v('st-user').trim();
    const password = v('st-pass');
    if (!username || !password) return showError(ctx, t('enter_username_password'));
    await attempt(ctx, () => api.familyLogin({ who: 'student', username, password }));
  },

  'lang.set': (lang, _el, { render }) => {
    capture();
    S.lang = ['en', 'si', 'ta'].includes(lang) ? lang : 'en';
    savePrefs();
    render();
  },

  'theme.toggle': (_arg, _el, { render }) => {
    S.theme = S.theme === 'day' ? 'night' : 'day';
    savePrefs();
    applyTheme();
    render();
  },
};

/** Opened from the emailed link: /?reset=<token>. */
export function startReset(token) {
  resetLogin();
  L.resetToken = token;
}

/** Used by "Log out" so the next sign-in starts at the role picker. */
export function resetLogin() {
  L.role = null;
  L.mode = 'in';
  L.busy = false;
  L.error = null;
  // Passwords never outlive the attempt that used them.
  L.form = {};
  L.signup = blankSignup();
  L.resetToken = null;
}

/** The +94 boxes need their live formatting after each draw. */
export function afterLogin() {
  wireTelFields(document.getElementById('scr'));
}
