/**
 * Talking to /api. The session lives in an HttpOnly cookie, so there is no
 * token to keep here and nothing sensitive in localStorage.
 */

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
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data);
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
  switchRole: (role) => post('auth?r=role', { role }),

  /* teacher */
  teacherBootstrap: () => get('teacher?r=bootstrap'),
  teacherSessions: (from, to) => get(`teacher?r=sessions&from=${from}&to=${to}`),
  teacherInvite: () => get('teacher?r=invite'),
  plusInvite: (classId) =>
    get(`teacher?r=plus_invite${classId ? `&class_id=${encodeURIComponent(classId)}` : ''}`),
  teacherPreview: (kind, studentId) => get(`teacher?r=preview&kind=${kind}&student_id=${studentId}`),
  slipUrl: (studentId) => get(`teacher?r=slip&student_id=${studentId}`),
  teacherDo: (action, body) => post(`teacher?r=${action}`, body || {}),

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
