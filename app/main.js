/**
 * The app shell: boot, routing, one render function, one click listener.
 *
 * The screen functions return HTML and the actions mutate state and ask for a
 * re-render, exactly as in the prototype - but the data behind them now comes
 * from the server, so three devices looking at the same class agree.
 */

import { api } from './api.js';
import { loadFonts } from './fonts.js';
import { setLang, t } from './i18n.js';
import * as R from './rules.js';
import { S, applyTheme, loadPrefs, goBack } from './state.js';
import {
  button,
  closeSheet,
  emptyState,
  esc,
  sheetIsOpen,
  skeleton,
  toast,
  wireTelFields,
} from './ui.js';
import * as login from './screens/login.js';

/* ------------------------------------------------------------- routing --- */

/**
 * Point 1: only the login screen is in the first download.
 *
 * The teacher's four tabs and the family's screens are about two thirds of
 * the app's code, and nobody can see either until they have signed in. They
 * are fetched the moment a role is known - during the sign-in request, so by
 * the time the code is checked the screens are usually already there - and
 * kept for the rest of the session.
 */
let ROLES = {};
let teacherModule = null;
let familyModule = null;

async function loadRole(role) {
  if (role === 'teacher' && !teacherModule) {
    const [screens, forms] = await Promise.all([
      import('./screens/teacher.js'),
      import('./screens/teacher-forms.js'),
    ]);
    teacherModule = screens;
    indexMarks = forms.indexMarks;
    ROLES.teacher = {
      tabs: screens.TABS,
      views: screens.VIEWS,
      subs: screens.SUBS,
      firstTab: 'today',
      after: screens.after,
      overlay: screens.overlay,
    };
  }
  if ((role === 'parent' || role === 'student') && !familyModule) {
    familyModule = await import('./screens/family.js');
    ROLES.parent = {
      tabs: familyModule.PARENT_TABS,
      views: familyModule.PARENT_VIEWS,
      subs: familyModule.SUBS,
      firstTab: 'home',
      locked: familyModule.locked,
    };
    ROLES.student = {
      tabs: familyModule.STUDENT_TABS,
      views: familyModule.STUDENT_VIEWS,
      subs: familyModule.SUBS,
      firstTab: 'home',
      locked: familyModule.locked,
    };
  }
  return ROLES[role] || null;
}

/** Filled in by loadRole once the teacher's code is here. */
let indexMarks = () => {};

/**
 * Which actions are live depends on who is signed in, so `nav.tab` means the
 * teacher's tabs or the family's tabs without either knowing about the other.
 * Shell actions (back, log out, close a sheet) are always there.
 */
function actionsFor(role) {
  if (role === 'teacher' && teacherModule) return { ...SHELL_ACTIONS, ...teacherModule.ACTIONS };
  if ((role === 'parent' || role === 'student') && familyModule) {
    return { ...SHELL_ACTIONS, ...familyModule.ACTIONS };
  }
  return { ...SHELL_ACTIONS, ...login.ACTIONS };
}

/* -------------------------------------------------------------- render --- */

const ctx = { render, onSignedIn, reload: reloadForRole };

function screenHtml() {
  if (!S.configured) return emptyState(t('not_configured'), '🔌');
  // Point 1: grey placeholder boxes while the data arrives, so the app looks
  // alive from the first frame instead of showing a blank screen.
  if (S.loading) return skeleton();
  if (S.error) {
    return `${emptyState(S.error, '⚠️')}${button(t('retry'), { act: 'app.retry', cls: 'wide' })}`;
  }
  if (!S.role) return login.view();

  const role = ROLES[S.role];
  // The role's code is still arriving: the skeleton covers that too.
  if (!role || !S.data) return skeleton();

  /*
   * The family's Plus subscription is not active. The server sends a payload
   * with nothing in it but who this is and what Plus costs, so there is
   * nothing here to draw a timetable from - and nothing to leak either.
   */
  if (S.data.locked && role.locked) return role.locked();
  if (S.sub) {
    const sub = role.subs[S.sub.view];
    if (sub) return sub();
  }
  const view = role.views[S.tab] || role.views[role.firstTab];
  return view();
}

function navHtml() {
  if (!S.role || S.sub || S.loading || !S.data) return '';
  if (S.data.locked) return ''; // nothing to navigate to
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
  const over = document.getElementById('over');
  const tabs = navHtml();
  screen.innerHTML = screenHtml();
  nav.innerHTML = tabs;
  nav.style.display = tabs ? 'flex' : 'none';
  document.body.classList.toggle('busy', S.busy);

  const role = S.role && ROLES[S.role];
  // Floating controls live outside the scrolling area (point 9's "+").
  if (over) over.innerHTML = !S.loading && S.data && role?.overlay ? role.overlay() : '';
  // The sign-up form has a +94 box that needs its live formatting.
  if (!S.role) login.afterLogin();
  if (role?.after) role.after(ctx);

  // Point 3: every +94 box on the page gets its live formatting and check.
  wireTelFields(screen);
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

/**
 * The calendar and the dashboard are anchored on the device's date until the
 * server answers. The server counts the day in the teacher's own timezone
 * (APP_TIMEZONE), so on a phone set to another zone - or with a wrong clock -
 * the two would disagree and "Today" would land on a different square from
 * the Today tab. On sign-in, the server's date wins.
 */
function anchorOnToday() {
  S.cal.date = S.today;
  S.dash.date = S.today;
}

async function onSignedIn(session) {
  // Fetch the screens for this role before anything tries to draw them.
  await loadRole(session.role);
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
    anchorOnToday();
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
  // Point 1: the first screen is already on the page; now fetch the web fonts.
  loadFonts();

  // Point 1 again: the moment a role is chosen, start fetching its screens so
  // they are usually in hand before the fourth digit is pressed.
  document.addEventListener(
    'click',
    (event) => {
      const el = event.target.closest?.('[data-a="login.role"]');
      if (el?.dataset?.i) loadRole(el.dataset.i).catch(() => {});
    },
    true,
  );

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

/**
 * Points 2 and 7: one tap is one write.
 *
 * While an action is running its button is marked busy and shows "Saving…",
 * and a second tap on it is dropped - so double tapping can never create two
 * classes or two payments. The guard is on the element, not on the action
 * name, so two different buttons still work at the same time.
 */
async function dispatch(name, arg, el) {
  const action = actionsFor(S.role)[name];
  if (!action) return;
  if (el?.dataset?.busy) return;

  const label = el?.tagName === 'BUTTON' ? el.innerHTML : null;
  let slow = null;
  if (el?.dataset) {
    el.dataset.busy = '1';
    if (label !== null) {
      el.classList.add('is-busy');
      el.innerHTML = `<span class="spin-s" aria-hidden="true"></span>${esc(t('saving'))}`;
      // Point 7: a save that is taking a while says so rather than looking stuck.
      slow = setTimeout(() => {
        if (el.dataset.busy) el.innerHTML = esc(t('still_saving'));
      }, 3000);
    }
  }

  try {
    await action(arg, el, ctx);
  } catch (err) {
    console.error('[action]', name, err);
    toast(err.message || t('could_not_save'), 'bad');
  } finally {
    clearTimeout(slow);
    if (el?.dataset) {
      delete el.dataset.busy;
      // The screen is usually redrawn by now and this element is gone; when it
      // is not, put its label back.
      if (label !== null && el.isConnected) {
        el.classList.remove('is-busy');
        el.innerHTML = label;
      }
    }
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

/**
 * Point 10: "Forgot to press End?"
 *
 * A class that is still In progress past the time it was meant to finish gets
 * one nudge - once, not every minute, because the teacher may well be running
 * over on purpose. The class stays In progress until they end it; nothing is
 * closed on their behalf, because the times are what the hours are billed on.
 */
const nudged = new Set();

function remindToEnd() {
  if (S.role !== 'teacher' || !S.data) return;
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();

  for (const session of R.sessionsOn(S.data, S.today)) {
    if (R.sessionState(session) !== 'running') continue;
    const { end } = R.classSpan(session.cls);
    if (minutes < end || nudged.has(session.key)) continue;
    nudged.add(session.key);
    toast(t('still_running'), 'info');
  }
}

/* A new day while the app is open: move "today" on. */
setInterval(() => {
  const now = R.todayLocal();
  if (now !== S.today && S.role) {
    S.today = now;
    S.cal.date = now;
    nudged.clear();
    reloadForRole().then(render).catch(() => {});
    return;
  }
  remindToEnd();
}, 60_000);

window.addEventListener('online', () => {
  if (S.role) reloadForRole().then(render).catch(() => {});
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

boot();
