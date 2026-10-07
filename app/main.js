/**
 * The app shell: boot, routing, one render function, one click listener.
 *
 * The screen functions return HTML and the actions mutate state and ask for a
 * re-render, exactly as in the prototype - but the data behind them now comes
 * from the server, so three devices looking at the same class agree.
 */

import { api } from './api.js';
import { setLang, t } from './i18n.js';
import * as R from './rules.js';
import { S, applyTheme, loadPrefs, goBack } from './state.js';
import { button, closeSheet, emptyState, esc, sheetIsOpen, spinner, toast } from './ui.js';
import * as login from './screens/login.js';
import * as teacher from './screens/teacher.js';
import { indexMarks } from './screens/teacher-forms.js';
import * as family from './screens/family.js';

/* ------------------------------------------------------------- routing --- */

const ROLES = {
  teacher: {
    tabs: teacher.TABS,
    views: teacher.VIEWS,
    subs: teacher.SUBS,
    firstTab: 'today',
    after: teacher.after,
  },
  parent: {
    tabs: family.PARENT_TABS,
    views: family.PARENT_VIEWS,
    subs: family.SUBS,
    firstTab: 'home',
  },
  student: {
    tabs: family.STUDENT_TABS,
    views: family.STUDENT_VIEWS,
    subs: family.SUBS,
    firstTab: 'home',
  },
};

/**
 * Which actions are live depends on who is signed in, so `nav.tab` means the
 * teacher's tabs or the family's tabs without either knowing about the other.
 * Shell actions (back, log out, close a sheet) are always there.
 */
function actionsFor(role) {
  if (role === 'teacher') return { ...SHELL_ACTIONS, ...teacher.ACTIONS };
  if (role === 'parent' || role === 'student') return { ...SHELL_ACTIONS, ...family.ACTIONS };
  return { ...SHELL_ACTIONS, ...login.ACTIONS };
}

/* -------------------------------------------------------------- render --- */

const ctx = { render, onSignedIn, reload: reloadForRole };

function screenHtml() {
  if (!S.configured) return emptyState(t('not_configured'), '🔌');
  if (S.loading) return spinner();
  if (S.error) {
    return `${emptyState(S.error, '⚠️')}${button(t('retry'), { act: 'app.retry', cls: 'wide' })}`;
  }
  if (!S.role) return login.view();

  const role = ROLES[S.role];
  if (!S.data) return spinner();
  if (S.sub) {
    const sub = role.subs[S.sub.view];
    if (sub) return sub();
  }
  const view = role.views[S.tab] || role.views[role.firstTab];
  return view();
}

function navHtml() {
  if (!S.role || S.sub || S.loading || !S.data) return '';
  const role = ROLES[S.role];
  return role.tabs
    .map(
      (tab) =>
        `<button type="button" class="${S.tab === tab.key ? 'on' : ''}" data-a="nav.tab" data-i="${esc(
          tab.key,
        )}" aria-current="${S.tab === tab.key}">
          <span class="nav-ic" aria-hidden="true">${tab.glyph}</span><span>${esc(t(tab.label))}</span>
        </button>`,
    )
    .join('');
}

export function render() {
  applyTheme();
  setLang(S.lang);

  const screen = document.getElementById('scr');
  const nav = document.getElementById('nav');
  const tabs = navHtml();
  screen.innerHTML = screenHtml();
  nav.innerHTML = tabs;
  nav.style.display = tabs ? 'flex' : 'none';
  document.body.classList.toggle('busy', S.busy);

  const role = S.role && ROLES[S.role];
  if (role?.after) role.after(ctx);
}

/* ---------------------------------------------------------------- boot --- */

async function reloadForRole() {
  if (S.role === 'teacher') {
    S.data = await api.teacherBootstrap();
    S.teacher = S.data.teacher;
    indexMarks();
  } else if (S.role) {
    S.data = await api.familyBootstrap();
    S.teacher = S.data.teacher;
    S.children = S.data.children;
    S.childId = S.data.child_id;
  }
  if (S.data?.today) S.today = S.data.today;
}

async function onSignedIn(session) {
  S.role = session.role;
  S.teacher = session.teacher || null;
  S.children = session.children || [];
  S.childId = session.child_id || null;
  S.tab = ROLES[S.role]?.firstTab || 'home';
  S.sub = null;
  S.stack = [];
  S.loading = true;
  render();
  try {
    await reloadForRole();
    applyServerPrefs();
    S.error = null;
  } catch (err) {
    S.error = err.message;
  } finally {
    S.loading = false;
    render();
  }
}

/** The teacher's saved language and appearance follow them to a new device. */
function applyServerPrefs() {
  const saved = localStorage.getItem('plus.prefs');
  if (saved) return; // this device has its own choice
  if (S.teacher?.lang) S.lang = S.teacher.lang;
  if (S.teacher?.theme) S.theme = S.teacher.theme;
  setLang(S.lang);
  applyTheme();
}

async function boot() {
  loadPrefs();
  applyTheme();
  render();

  try {
    const config = await api.config();
    S.configured = config.configured;
    S.codeLength = config.code_length || 4;
    S.demoHint = Boolean(config.demo_hint);
    if (!S.configured) {
      S.loading = false;
      render();
      return;
    }

    const session = await api.me();
    if (session.role) {
      await onSignedIn(session);
      return;
    }
  } catch (err) {
    S.error = err.message;
  }
  S.loading = false;
  render();
}

/* ------------------------------------------------------- shell actions --- */

const SHELL_ACTIONS = {
  back: (_a, _el, c) => {
    goBack();
    c.render();
  },
  'sheet.close': () => closeSheet(),
  'app.retry': async (_a, _el, c) => {
    S.error = null;
    S.loading = true;
    c.render();
    try {
      await reloadForRole();
    } catch (err) {
      S.error = err.message;
    }
    S.loading = false;
    c.render();
  },
  'auth.logout': async (_a, _el, c) => {
    closeSheet();
    await api.logout().catch(() => {});
    login.resetLogin();
    S.role = null;
    S.data = null;
    S.teacher = null;
    S.children = [];
    S.childId = null;
    S.sub = null;
    S.stack = [];
    S.tab = 'today';
    c.render();
  },
  toast: (message) => toast(message),
};

/* ------------------------------------------------------------- wiring ---- */

async function dispatch(name, arg, el) {
  const action = actionsFor(S.role)[name];
  if (!action) return;
  try {
    await action(arg, el, ctx);
  } catch (err) {
    console.error('[action]', name, err);
    toast(err.message || 'Something went wrong', 'bad');
  }
}

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-a]');
  if (!el) return;
  if (el.tagName === 'A' && el.getAttribute('href')) {
    // Let the link open, then tidy up the sheet behind it.
    setTimeout(() => dispatch(el.dataset.a, el.dataset.i, el), 0);
    return;
  }
  event.preventDefault();
  dispatch(el.dataset.a, el.dataset.i, el);
});

/* Cards that act as buttons must also work from the keyboard. */
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const el = event.target.closest('[data-a][role="button"]');
  if (!el) return;
  event.preventDefault();
  dispatch(el.dataset.a, el.dataset.i, el);
});

/* Tapping the dim background, or Escape, closes a sheet. */
document.getElementById('sheet').addEventListener('click', (event) => {
  if (event.target.id === 'sheet') closeSheet();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && sheetIsOpen()) closeSheet();
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (S.theme === 'auto') render();
});

/* A new day while the app is open: move "today" on. */
setInterval(() => {
  const now = R.todayLocal();
  if (now !== S.today && S.role) {
    S.today = now;
    S.cal.date = now;
    reloadForRole().then(render).catch(() => {});
  }
}, 60_000);

window.addEventListener('online', () => {
  if (S.role) reloadForRole().then(render).catch(() => {});
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

boot();
