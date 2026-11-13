/**
 * Talking to /api. The session lives in an HttpOnly cookie, so there is no
 * token to keep here and nothing sensitive in localStorage.
 */

import { t } from './i18n.js';

/**
 * The server answers in English and, for sign-in, adds a `code`. When the
 * app has that code in the reader's language, the reader gets it there.
 */
const messageOf = (data, status) => {
  if (data.code) {
    const translated = t(data.code);
    if (translated !== data.code) return translated;
  }
  return data.error || `Request failed (${status})`;
};

class ApiError extends Error {
  /**
   * `data` is the whole body, not just the message. A 409 from a class move
   * names the class that is in the way, and the sheet needs that to show it.
   */
  constructor(message, status, data = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function call(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api/${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('No connection. Check your internet and try again.', 0);
  }
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok) throw new ApiError(messageOf(data, res.status), res.status, data);
  return data;
}

const get = (path) => call(path);
const post = (path, body) => call(path, { method: 'POST', body });

export const api = {
  ApiError,

  /* auth */
  config: () => get('auth?r=config'),
  me: () => get('auth?r=me'),
  /**
   * A family signs in with a role and a code; a teacher may instead send an
   * email and a password, which `extra` carries.
   */
  login: (role, code, extra) => post('auth?r=login', extra || { role, code }),
  signup: (body) => post('auth?r=signup', body),
  logout: () => post('auth?r=logout', {}),

  /* accounts: parents, students, passwords (migration 008) */
  activate: (body) => post('account?r=activate', body),
  familyLogin: (body) => post('account?r=login', body),
  addChild: (code) => post('account?r=add_child', { code }),
  familyLogins: () => get('account?r=logins'),
  studentLoginCreate: (body) => post('account?r=student.create', body),
  studentLoginPassword: (body) => post('account?r=student.password', body),
  studentLoginDelete: (studentId) => post('account?r=student.delete', { student_id: studentId }),
  changePassword: (current, next) => post('account?r=password', { current, next }),
  devices: () => get('account?r=sessions'),
  signOutOthers: () => post('account?r=sessions.revoke', {}),
  forgotPassword: (email) => post('account?r=forgot', { email }),
  resetPassword: (token, password) => post('account?r=reset', { token, password }),

  /* teacher */
  teacherBootstrap: () => get('teacher?r=bootstrap'),
  teacherSessions: (from, to) => get(`teacher?r=sessions&from=${from}&to=${to}`),
  teacherInvite: () => get('teacher?r=invite'),
  plusInvite: (classId) =>
    get(`teacher?r=plus_invite${classId ? `&class_id=${encodeURIComponent(classId)}` : ''}`),
  teacherPreview: (kind, studentId) => get(`teacher?r=preview&kind=${kind}&student_id=${studentId}`),
  slipUrl: (studentId) => get(`teacher?r=slip&student_id=${studentId}`),
  teacherDo: (action, body) => post(`teacher?r=${action}`, body || {}),
  /** Gemini's suggested marks for a photographed answer paper. Saves nothing. */
  reviewPaper: (body) => post('review', body),

  /* family */
  familyBootstrap: (childId) => get(`family?r=bootstrap${childId ? `&child_id=${childId}` : ''}`),
  familyDo: (action, body) => post(`family?r=${action}`, body || {}),

  /* the Plus team's onboarding wizard (gated by ONBOARD_KEY) */
  onboardConfig: (key) => get(`onboard?r=config&k=${encodeURIComponent(key)}`),
  onboardSubmit: (body) => post('onboard?r=submit', body),

  /* public */
  joinConfig: (key) => get(`join?r=config&t=${encodeURIComponent(key)}`),
  joinSubmit: (body) => post('join?r=submit', body),
};
