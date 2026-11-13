/**
 * Client state. Only two things are kept in the browser between visits: the
 * chosen language and the chosen appearance. Everything else comes from the
 * server on every load, so two devices never disagree.
 */

import { setLang } from './i18n.js';
import { fullName, todayLocal } from './rules.js';

const PREFS_KEY = 'plus.prefs';

export const S = {
  /* boot */
  ready: false,
  loading: true,
  error: null,
  configured: true,
  codeLength: 4,

  /* who */
  role: null, // null | 'teacher' | 'parent' | 'student'
  teacher: null,
  children: [],
  childId: null,

  /* navigation */
  tab: 'today',
  sub: null, // { view, ...params }
  stack: [],

  /* preferences */
  theme: 'night',
  lang: 'en',

  /* screen-local */
  today: todayLocal(),
  cal: { mode: 'day', date: todayLocal() },
  dash: { mode: 'week', date: todayLocal() },
  boardBy: 'marks',
  search: '',
  busy: false,

  /* server payload */
  data: null,
};

export function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    if (['night', 'day', 'auto'].includes(saved.theme)) S.theme = saved.theme;
    if (['en', 'si', 'ta'].includes(saved.lang)) S.lang = saved.lang;
  } catch {
    /* private browsing, blocked storage: the defaults are fine */
  }
  setLang(S.lang);
}

export function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: S.theme, lang: S.lang }));
  } catch {
    /* ignore */
  }
}

/** Night / Day / Auto (section 5.1). */
export function applyTheme() {
  const dark =
    S.theme === 'auto' ? window.matchMedia('(prefers-color-scheme: dark)').matches : S.theme !== 'day';
  const root = document.documentElement;
  root.dataset.mode = dark ? 'night' : 'day';
  root.dataset.lang = S.lang;
  const meta = document.querySelector('meta[name="theme-color"]');
  // The status bar matches the top of the backdrop in each theme.
  if (meta) meta.setAttribute('content', dark ? '#08262a' : '#e2f2f3');
}

/* ------------------------------------------------------------- lookups --- */

export const students = () => S.data?.students || [];
export const classes = () => S.data?.classes || [];
export const studentById = (id) => students().find((s) => s.id === id) || null;
export const classById = (id) => classes().find((c) => c.id === id) || null;
export const activeChild = () => S.data?.child || null;

export const teacherName = () =>
  S.teacher ? fullName(S.teacher) : '';

/* ---------------------------------------------------------- navigation --- */

export function goSub(view, params = {}) {
  if (S.sub) S.stack.push(S.sub);
  S.sub = { view, ...params };
}

export function goBack() {
  S.sub = S.stack.pop() || null;
}

export function goTab(tab) {
  S.tab = tab;
  S.sub = null;
  S.stack = [];
}
