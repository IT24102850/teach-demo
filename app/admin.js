/**
 * The owner's dashboard - /admin.
 *
 * A page of its own: it shares nothing with the teacher app but the QR
 * encoder, it is not part of the installed app, and the service worker never
 * caches it. The session is an HttpOnly cookie the page cannot read; nothing
 * is kept in localStorage or sessionStorage.
 *
 * Every value that reaches the page goes through esc(). The audit log in
 * particular shows text an attacker typed (a failed sign-in records the email
 * they tried), so this is not a formality.
 */

import { qrSvg } from './qr.js';

/* ------------------------------------------------------------- helpers --- */

function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const app = document.getElementById('app');
const dlg = document.getElementById('dlg');
const tip = document.getElementById('tip');

const num = new Intl.NumberFormat('en-LK');
const fmt = (n) => num.format(Math.round(Number(n) || 0));
const money = (n) => `LKR ${fmt(n)}`;

/** 1,284 / 12.9K / 4.2M */
function compact(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '')}K`;
  return fmt(v);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym) => {
  const [y, m] = String(ym).split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
};

function when(iso) {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return esc(iso);
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} days ago`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
const exact = (iso) => (iso ? new Date(iso).toLocaleString('en-GB') : '');
const whenHtml = (iso) => `<time datetime="${esc(iso || '')}" title="${esc(exact(iso))}">${esc(when(iso))}</time>`;

function device(ua) {
  const s = String(ua || '');
  const os = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iOS' : /Mac OS/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : '';
  const br = /Edg\//.test(s) ? 'Edge' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : '';
  return [br, os].filter(Boolean).join(' on ') || s.slice(0, 40) || 'Unknown';
}

/* ----------------------------------------------------------------- api --- */

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function call(r, { body, params = '' } = {}) {
  let res;
  try {
    res = await fetch(`/api/admin?r=${encodeURIComponent(r)}${params}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Plus-Admin': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('No connection. Check your internet and try again.', 0);
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (res.status === 401 && S.admin && r !== 'login') {
    signedOut('Your session ended. Please sign in again.');
    throw new ApiError('Signed out', 401);
  }
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  return data;
}

/* --------------------------------------------------------------- state --- */

const S = {
  admin: null,
  idleMinutes: 30,
  view: 'overview',
  overview: null,
  teachers: null,
  teacherId: null,
  teacher: null,
  security: null,
  audit: [],
  auditMore: false,
  filter: '',
  notice: null,
  setup: null,
  tables: {},
};

function signedOut(message) {
  S.admin = null;
  S.overview = S.teachers = S.teacher = S.security = null;
  S.audit = [];
  S.notice = message ? { tone: 'warn', text: message } : null;
  if (dlg.open) dlg.close();
  render();
}

/* ---------------------------------------------------------------- views --- */

const field = (name, label, { type = 'text', auto = 'off', extra = '', hint = '' } = {}) => `
  <label class="fld">
    <span>${esc(label)}</span>
    <input name="${name}" type="${type}" autocomplete="${auto}" ${extra} />
    ${hint ? `<small>${esc(hint)}</small>` : ''}
  </label>`;

const codeField = (label = 'Authenticator code') =>
  field('code', label, {
    auto: 'one-time-code',
    extra: 'inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required',
    hint: 'The 6 digits in your authenticator app right now.',
  });

const notice = () =>
  S.notice ? `<div class="notice ${esc(S.notice.tone)}" role="status">${esc(S.notice.text)}</div>` : '';

function loginView() {
  return `
  <main class="auth">
    <form class="card auth-card" data-form="login">
      <div class="brand"><img src="/assets/icon-192.png" alt="" /><div><b>Plus Admin</b><small>Owner sign-in</small></div></div>
      ${notice()}
      ${field('email', 'Email', { type: 'email', auto: 'username', extra: 'required' })}
      ${field('password', 'Password', { type: 'password', auto: 'current-password', extra: 'required' })}
      <div data-code-slot>${codeField()}</div>
      <button class="btn primary" type="submit">Sign in</button>
      <button class="link" type="button" data-a="recovery">Lost your phone? Use a recovery code</button>
      <p class="fine">Every sign-in, success or not, is recorded with its address.</p>
    </form>
  </main>`;
}

function setupView() {
  const st = S.setup;
  if (st.done) {
    return `
    <main class="auth">
      <div class="card auth-card wide">
        <h1>Save your recovery codes</h1>
        <p>If you lose your phone, each of these signs you in once instead of the 6-digit code. They are shown <b>only now</b>.</p>
        <ol class="codes">${st.codes.map((c) => `<li><code>${esc(c)}</code></li>`).join('')}</ol>
        <div class="row">
          <button class="btn" type="button" data-a="codes.download">Download as a text file</button>
          <button class="btn" type="button" data-a="codes.copy">Copy</button>
        </div>
        <p class="fine">Keep them somewhere other than this computer and your phone - printed, or in a password manager.</p>
        <button class="btn primary" type="button" data-a="setup.done">I have saved them - sign in</button>
      </div>
    </main>`;
  }
  if (!st.secret) {
    return `<main class="auth"><div class="card auth-card">${notice()}<p>${st.error ? '' : 'Opening your setup link…'}</p></div></main>`;
  }
  const grouped = st.secret.match(/.{1,4}/g).join(' ');
  return `
  <main class="auth">
    <form class="card auth-card wide" data-form="setup">
      <h1>Set up ${esc(st.email)}</h1>
      ${notice()}
      <h2>1. Add Plus Admin to your authenticator</h2>
      <p>Open Google Authenticator, Microsoft Authenticator or Authy and scan this.</p>
      <div class="qr">${qrSvg(st.uri, { size: 200 })}</div>
      <p class="fine">Can't scan? Enter this key by hand: <code class="secret">${esc(grouped)}</code></p>
      <h2>2. Choose a password</h2>
      ${field('password', 'Password', { type: 'password', auto: 'new-password', extra: 'required minlength="12"', hint: 'At least 12 characters. A short sentence works well.' })}
      ${field('confirm', 'Type it again', { type: 'password', auto: 'new-password', extra: 'required minlength="12"' })}
      <h2>3. Prove the authenticator works</h2>
      ${codeField('The 6-digit code it shows')}
      <button class="btn primary" type="submit">Finish setup</button>
    </form>
  </main>`;
}

const NAV = [
  ['overview', 'Overview'],
  ['teachers', 'Teachers'],
  ['security', 'Security'],
  ['account', 'Account'],
];

function shell(inner) {
  return `
  <header class="top">
    <div class="brand"><img src="/assets/icon-192.png" alt="" /><b>Plus Admin</b></div>
    <nav>${NAV.map(([k, label]) => `<button type="button" class="tab${S.view === k ? ' on' : ''}" data-a="nav" data-i="${k}" ${S.view === k ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav>
    <div class="who">
      <span>${esc(S.admin.email)}${S.admin.role === 'viewer' ? ' <em>view only</em>' : ''}</span>
      <button type="button" class="btn small" data-a="logout">Sign out</button>
    </div>
  </header>
  <main class="page">${notice()}${inner}</main>`;
}

const tile = (label, value, sub = '') => `
  <div class="tile">
    <div class="tile-label">${esc(label)}</div>
    <div class="tile-value">${esc(value)}</div>
    ${sub ? `<div class="tile-sub">${sub}</div>` : ''}
  </div>`;

/* ----------------------------------------------------------------- chart --- */

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const barPath = (x, y, w, h) => {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

/**
 * One series of monthly bars. No legend - the title names the series. The
 * newest month carries a direct label; every bar has a hover tooltip; the
 * same numbers are one click away as a table.
 */
function barChart(key, title, rows, valueOf, format) {
  const showTable = S.tables[key];
  const head = `
    <div class="chart-head">
      <h3>${esc(title)}</h3>
      <button type="button" class="link" data-a="table" data-i="${esc(key)}">${showTable ? 'Show chart' : 'Show table'}</button>
    </div>`;
  if (showTable) {
    return `<figure class="card chart">${head}
      <table class="tbl"><thead><tr><th>Month</th><th class="r">${esc(title)}</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(monthLabel(r.month))}</td><td class="r">${esc(format(valueOf(r)))}</td></tr>`).join('')}
      </tbody></table></figure>`;
  }

  const vals = rows.map((r) => Number(valueOf(r)) || 0);
  if (!vals.some((v) => v > 0)) {
    return `<figure class="card chart">${head}<p class="mu empty">Nothing in the last 12 months yet.</p></figure>`;
  }

  const W = 640;
  const H = 210;
  const L = 48;
  const R = 8;
  const T = 22;
  const B = 26;
  const max = niceMax(Math.max(...vals, 0));
  const band = (W - L - R) / Math.max(rows.length, 1);
  const bw = Math.min(24, band * 0.62);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  // A half-way line only where it lands on a whole number worth reading.
  const ticks = max >= 4 && Number.isInteger(max / 2) ? [0, max / 2, max] : [0, max];
  const tickLabel = (v) => (Number.isInteger(v) ? compact(v) : String(v));

  const grid = ticks
    .map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 8}" y="${y(v) + 4}" class="axis" text-anchor="end">${esc(tickLabel(v))}</text>`)
    .join('');

  const bars = rows
    .map((r, i) => {
      const v = vals[i];
      const x = L + band * i + (band - bw) / 2;
      const top = y(v);
      const h = H - B - top;
      const last = i === rows.length - 1;
      const [yy, mm] = String(r.month).split('-');
      return `
        <g>
          ${v > 0 ? `<path d="${barPath(x, top, bw, h)}" class="bar${last ? ' now' : ''}"/>` : ''}
          ${last && v > 0 ? `<text x="${x + bw / 2}" y="${top - 6}" class="val" text-anchor="middle">${esc(compact(v))}</text>` : ''}
          <text x="${x + bw / 2}" y="${H - 8}" class="axis" text-anchor="middle">${esc(MONTHS[Number(mm) - 1])}${mm === '01' ? ` ${esc(yy.slice(2))}` : ''}</text>
          <rect x="${L + band * i}" y="${T}" width="${band}" height="${H - T - B}" class="hit" data-tip="${esc(`${monthLabel(r.month)}: ${format(v)}`)}"/>
        </g>`;
    })
    .join('');

  const latest = rows.length ? `${monthLabel(rows[rows.length - 1].month)}: ${format(vals[vals.length - 1])}` : 'no data';
  return `<figure class="card chart">${head}
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${title}, last 12 months. ${latest}.`)}">
      ${grid}<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="base"/>${bars}
    </svg></figure>`;
}

/* ------------------------------------------------------------- overview --- */

function overviewView() {
  const o = S.overview;
  if (!o) return '<p class="mu">Loading the figures…</p>';
  const months = o.months || [];
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
  return `
  <h1>Overview <small>as of ${esc(o.today)}</small></h1>
  <section class="tiles">
    ${tile('Teachers', fmt(o.teachers.total), `${fmt(o.teachers.teaching_30d)} taught a class in 30 days · ${fmt(o.teachers.new_30d)} new${o.teachers.suspended ? ` · <b class="warn-t">${fmt(o.teachers.suspended)} paused</b>` : ''}`)}
    ${tile('Active students', fmt(o.students.active), `${fmt(o.students.pending)} waiting to be accepted · ${fmt(o.students.new_30d)} joined in 30 days`)}
    ${tile('Families on Plus', fmt(o.plus.active), `${pct(o.plus.active, o.students.active)} of active students`)}
    ${tile('Plus revenue / month', money(o.plus.gross), `Plus keeps ${money(o.plus.company_share)} · teachers ${money(o.plus.teachers_share)}`)}
    ${tile('Classes in 30 days', fmt(o.teaching.sessions_30d), `${fmt(o.teaching.hours_30d)} hours · attendance ${o.teaching.attendance_pct === null ? '-' : `${o.teaching.attendance_pct}%`}`)}
    ${tile('Fees owed to teachers', money(o.tuition.outstanding), `Collected this month ${money(o.tuition.collected_month)}`)}
    ${tile('AI reviews in 30 days', fmt(o.ai.reviews_30d), `${fmt(o.ai.fallback_30d)} on the back-up model · ${fmt(o.ai.failed_30d)} failed${o.ai.avg_ms ? ` · ${(o.ai.avg_ms / 1000).toFixed(0)} s average` : ''}`)}
    ${tile('Parent messages in 30 days', fmt(o.messages.whatsapp_30d), `${fmt(o.messages.sent_30d)} sent automatically · ${fmt(o.messages.manual_30d)} sent by hand${o.messages.failed_30d ? ` · <b class="warn-t">${fmt(o.messages.failed_30d)} failed</b>` : ''}`)}
    ${tile('Failed sign-ins in 24 h', fmt(o.security.failed_logins_24h), o.security.admin_failed_24h ? `<b class="warn-t">${fmt(o.security.admin_failed_24h)} against this dashboard</b>` : 'none against this dashboard')}
  </section>
  <section class="charts">
    ${barChart('plus', 'Families on Plus', months, (m) => m.plus, fmt)}
    ${barChart('gross', 'Plus revenue (LKR)', months, (m) => m.plus_gross, money)}
    ${barChart('collected', 'Fees teachers recorded as paid (LKR)', months, (m) => m.collected, money)}
    ${barChart('ai', 'AI paper reviews', months, (m) => m.ai_reviews, fmt)}
  </section>`;
}

/* ------------------------------------------------------------- teachers --- */

const status = (t) =>
  t.suspended_at ? '<span class="pill bad">Paused</span>' : t.sessions_30d > 0 ? '<span class="pill ok">Teaching</span>' : '<span class="pill">Quiet</span>';

const teacherName = (t) => `${t.title ? `${t.title} ` : ''}${t.name}`;

function teachersView() {
  if (!S.teachers) return '<p class="mu">Loading teachers…</p>';
  const q = S.filter.trim().toLowerCase();
  const list = S.teachers.filter((t) =>
    !q || [t.name, t.email, t.phone, t.area, (t.subjects || []).join(' ')].join(' ').toLowerCase().includes(q),
  );
  return `
  <div class="bar-row">
    <h1>Teachers <small>${fmt(S.teachers.length)}</small></h1>
    <input class="search" type="search" placeholder="Search name, phone, email, area, subject" value="${esc(S.filter)}" data-input="filter" aria-label="Search teachers" />
  </div>
  <div class="card scroll">
  <table class="tbl hover">
    <thead><tr><th>Teacher</th><th>Contact</th><th class="r">Students</th><th class="r">On Plus</th><th class="r">Classes</th><th class="r">Fees, 30 d</th><th>Last class</th><th>Last sign-in</th><th>Status</th></tr></thead>
    <tbody>
    ${list.map((t) => `
      <tr data-a="teacher" data-i="${esc(t.id)}" tabindex="0">
        <td><b>${esc(teacherName(t))}</b><div class="mu">${esc((t.subjects || []).join(', '))}${t.area ? ` · ${esc(t.area)}` : ''}</div></td>
        <td>${esc(t.phone || '')}<div class="mu">${esc(t.email || '')}</div></td>
        <td class="r">${fmt(t.students)}${t.pending ? `<div class="mu">+${fmt(t.pending)} waiting</div>` : ''}</td>
        <td class="r">${fmt(t.plus_active)}</td>
        <td class="r">${fmt(t.classes)}</td>
        <td class="r">${compact(t.collected_30d)}</td>
        <td>${t.last_class ? esc(t.last_class) : '<span class="mu">none</span>'}</td>
        <td>${whenHtml(t.last_login_at)}</td>
        <td>${status(t)}</td>
      </tr>`).join('') || '<tr><td colspan="9" class="mu">No teacher matches that.</td></tr>'}
    </tbody>
  </table></div>`;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function teacherView() {
  const d = S.teacher;
  if (!d) return '<p class="mu">Loading…</p>';
  const t = d.teacher;
  const owner = S.admin.role === 'owner';
  return `
  <button type="button" class="link back" data-a="nav" data-i="teachers">← All teachers</button>
  <div class="bar-row">
    <h1>${esc(teacherName(t))} ${status(t)}</h1>
    ${owner ? `<div class="row">
      ${t.suspended_at
        ? '<button type="button" class="btn" data-a="t.restore">Restore access</button>'
        : '<button type="button" class="btn danger" data-a="t.suspend">Pause account</button>'}
      <button type="button" class="btn" data-a="t.plus">Plus price</button>
      <button type="button" class="btn" data-a="t.code">New login code</button>
    </div>` : ''}
  </div>
  ${t.suspended_at ? `<div class="notice warn">Paused ${whenHtml(t.suspended_at)}: ${esc(t.suspended_reason || '')}. They cannot sign in; their families still can.</div>` : ''}
  <section class="tiles">
    ${tile('Students', fmt(t.students), `${fmt(t.pending)} waiting`)}
    ${tile('On Plus', fmt(t.plus_active), `LKR ${fmt(t.plus_price)} a month, teacher keeps ${Math.round(Number(t.plus_share) * 100)}%`)}
    ${tile('Classes in 30 days', fmt(t.sessions_30d), `${fmt(t.classes)} active classes`)}
    ${tile('AI reviews in 30 days', fmt(t.ai_30d))}
  </section>
  <section class="cols">
    <div class="card">
      <h3>Details</h3>
      <dl class="dl">
        <dt>Phone</dt><dd>${esc(t.phone || '-')}</dd>
        <dt>Email</dt><dd>${esc(t.email || '-')}</dd>
        <dt>Area</dt><dd>${esc(t.area || '-')}</dd>
        <dt>School</dt><dd>${esc(t.school || '-')}</dd>
        <dt>Subjects</dt><dd>${esc((t.subjects || []).join(', ') || '-')}</dd>
        <dt>Joined</dt><dd>${whenHtml(t.created_at)}</dd>
        <dt>Last sign-in</dt><dd>${whenHtml(t.last_login_at)}</dd>
        <dt>Signs in with</dt><dd>${[t.has_password ? 'email + password' : '', t.has_code ? 'login code' : ''].filter(Boolean).join(' or ') || 'nothing set'}</dd>
        <dt>Sign-up link</dt><dd><code>/join/${esc(t.join_key)}</code></dd>
      </dl>
    </div>
    ${barChart(`t-col-${t.id}`, 'Fees recorded as paid (LKR)', d.months || [], (m) => m.collected, money)}
  </section>
  <div class="card scroll">
    <h3>Classes <small class="mu">no student names are shown here</small></h3>
    <table class="tbl"><thead><tr><th>Class</th><th>Days</th><th>Time</th><th>Where</th><th class="r">Students</th><th>State</th></tr></thead><tbody>
    ${(d.classes || []).map((c) => `<tr>
      <td>${esc(c.title)}</td>
      <td>${c.once_date ? `Once, ${esc(c.once_date)}` : esc((c.days || []).map((x) => DAYS[x]).join(' '))}</td>
      <td>${esc(String(c.start_time || '').slice(0, 5))}${c.duration_hours ? ` · ${esc(c.duration_hours)} h` : ''}</td>
      <td>${esc(c.area || c.venue_type || '')}</td>
      <td class="r">${fmt(c.students)}</td>
      <td>${!c.active ? '<span class="pill">Ended</span>' : c.setup_pending ? '<span class="pill warn">Needs a time</span>' : '<span class="pill ok">Running</span>'}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="mu">No classes yet.</td></tr>'}
    </tbody></table>
  </div>`;
}

/* ------------------------------------------------------------- security --- */

const ACTIONS = {
  'login.ok': 'Signed in',
  'login.failed': 'Failed sign-in',
  'login.blocked': 'Sign-in blocked (too many tries)',
  logout: 'Signed out',
  'setup.started': 'Opened setup link',
  'setup.failed': 'Bad setup link',
  'setup.done': 'Finished setup',
  'stepup.failed': 'Wrong code for an action',
  'password.changed': 'Changed password',
  'password.failed': 'Wrong current password',
  'recovery.regen': 'New recovery codes',
  'session.revoke': 'Ended a session',
  'sessions.revoke_others': 'Ended all other sessions',
  'teacher.suspend': 'Paused a teacher',
  'teacher.restore': 'Restored a teacher',
  'teacher.plus': 'Changed Plus price',
  'teacher.code': 'Issued a teacher login code',
  'invite.issued': 'Admin invited (command line)',
  'invite.reissued': 'New setup link (command line)',
  'admin.disable': 'Admin disabled (command line)',
  'admin.enable': 'Admin enabled (command line)',
};

function securityView() {
  const s = S.security;
  if (!s) return '<p class="mu">Loading…</p>';
  const byIp = {};
  for (const f of s.failed_logins) byIp[f.ip] = (byIp[f.ip] || 0) + 1;
  const noisy = Object.entries(byIp).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return `
  <h1>Security</h1>
  <section class="cols">
    <div class="card">
      <div class="chart-head"><h3>Signed in now</h3>${s.sessions.length > 1 ? '<button type="button" class="btn small" data-a="s.others">Sign out everywhere else</button>' : ''}</div>
      <table class="tbl"><tbody>
      ${s.sessions.map((x) => `<tr>
        <td><b>${esc(device(x.user_agent))}</b>${x.current ? ' <span class="pill ok">This one</span>' : ''}<div class="mu">${esc(x.ip)} · since ${whenHtml(x.created_at)}</div></td>
        <td class="r">${x.current ? '' : `<button type="button" class="btn small" data-a="s.revoke" data-i="${esc(x.id)}">Sign out</button>`}</td>
      </tr>`).join('')}
      </tbody></table>
      <p class="fine">Sessions end after ${esc(S.idleMinutes)} idle minutes, and after 12 hours in any case.</p>
    </div>
    <div class="card">
      <h3>Failed sign-ins, last 7 days <small class="mu">all of Plus</small></h3>
      ${noisy.length ? `<table class="tbl"><thead><tr><th>Address</th><th class="r">Failures</th></tr></thead><tbody>
        ${noisy.map(([ip, n]) => `<tr><td><code>${esc(ip)}</code></td><td class="r">${fmt(n)}</td></tr>`).join('')}
      </tbody></table>` : '<p class="mu">None.</p>'}
      <p class="fine">Five wrong tries from one address lock it out for 15 minutes.</p>
    </div>
  </section>
  <div class="card scroll">
    <h3>Audit log <small class="mu">append-only: the database refuses to change or delete it</small></h3>
    <table class="tbl"><thead><tr><th>When</th><th>Who</th><th>What</th><th>About</th><th>From</th></tr></thead><tbody>
    ${S.audit.map((a) => `<tr class="${a.ok ? '' : 'failed'}">
      <td>${whenHtml(a.created_at)}</td>
      <td>${esc(a.email || '-')}</td>
      <td>${a.ok ? '' : '<span class="pill bad">failed</span> '}${esc(ACTIONS[a.action] || a.action)}${a.detail ? `<div class="mu">${esc(Object.entries(a.detail).map(([k, v]) => `${k}: ${v}`).join(', '))}</div>` : ''}</td>
      <td>${esc(a.target || '')}</td>
      <td><code>${esc(a.ip || '')}</code><div class="mu">${esc(device(a.user_agent))}</div></td>
    </tr>`).join('') || '<tr><td colspan="5" class="mu">Nothing yet.</td></tr>'}
    </tbody></table>
    ${S.auditMore ? '<button type="button" class="btn small" data-a="audit.more">Show older</button>' : ''}
  </div>`;
}

function accountView() {
  const left = S.security?.recovery_left;
  return `
  <h1>Account</h1>
  <section class="cols">
    <form class="card" data-form="password">
      <h3>Change password</h3>
      <input type="email" name="username" autocomplete="username" value="${esc(S.admin.email)}" hidden readonly />
      ${field('current', 'Current password', { type: 'password', auto: 'current-password', extra: 'required' })}
      ${field('next', 'New password', { type: 'password', auto: 'new-password', extra: 'required minlength="12"', hint: 'At least 12 characters.' })}
      ${field('confirm', 'New password again', { type: 'password', auto: 'new-password', extra: 'required minlength="12"' })}
      ${codeField()}
      <button class="btn primary" type="submit">Change password</button>
      <p class="fine">Every other session is signed out when it changes.</p>
    </form>
    <div class="card">
      <h3>Recovery codes</h3>
      <p>${left === undefined ? '' : `<b>${fmt(left)} of 10</b> left. `}Each one signs you in once without your phone.</p>
      ${left !== undefined && left <= 3 ? '<div class="notice warn">You are running low. Make new ones.</div>' : ''}
      <button type="button" class="btn" data-a="recovery.regen">Make new recovery codes</button>
      <p class="fine">Making new ones cancels every old one.</p>
      <h3>Lost your phone?</h3>
      <p class="fine">Sign in with a recovery code, then make new codes. If you have none left, your developer can send a new setup link (<code>npm run admin -- invite ${esc(S.admin.email)}</code>).</p>
    </div>
  </section>`;
}

/* --------------------------------------------------------------- render --- */

function render() {
  if (S.setup) app.innerHTML = setupView();
  else if (!S.admin) app.innerHTML = loginView();
  else {
    const views = { overview: overviewView, teachers: teachersView, teacher: teacherView, security: securityView, account: accountView };
    app.innerHTML = shell((views[S.view] || overviewView)());
  }
  const first = app.querySelector('input:not([type=hidden])');
  if (first && !S.admin) first.focus();
}

async function load(view) {
  S.view = view;
  render();
  try {
    if (view === 'overview') S.overview = (await call('overview')).overview;
    if (view === 'teachers') S.teachers = (await call('teachers')).teachers;
    if (view === 'teacher') S.teacher = await call('teacher', { params: `&id=${encodeURIComponent(S.teacherId)}` });
    if (view === 'security' || view === 'account') {
      S.security = await call('security');
      if (view === 'security') {
        const a = await call('audit');
        S.audit = a.audit;
        S.auditMore = a.more;
      }
    }
  } catch (err) {
    if (err.status !== 401) S.notice = { tone: 'bad', text: err.message };
  }
  if (S.view === view) render();
}

/* --------------------------------------------------------------- dialog --- */

/**
 * Every change asks for a fresh authenticator code, so every change goes
 * through this one dialog.
 */
function confirmDialog({ title, body = '', fields = '', submit, tone = 'primary', run }) {
  dlg.innerHTML = `
    <form method="dialog" class="dlg" data-form="dialog">
      <h2>${esc(title)}</h2>
      ${body}
      ${fields}
      ${codeField()}
      <div class="dlg-error" role="alert"></div>
      <div class="row end">
        <button type="button" class="btn" data-a="dlg.close">Cancel</button>
        <button type="submit" class="btn ${tone}">${esc(submit)}</button>
      </div>
    </form>`;
  dlg.run = run;
  dlg.showModal();
  dlg.querySelector('input')?.focus();
}

function showOnce(title, html) {
  dlg.innerHTML = `<div class="dlg"><h2>${esc(title)}</h2>${html}<div class="row end"><button type="button" class="btn primary" data-a="dlg.close">Done</button></div></div>`;
  dlg.run = null;
  dlg.showModal();
}

/* -------------------------------------------------------------- actions --- */

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const codesText = (email, codes) =>
  `Plus Admin recovery codes for ${email}\nMade ${new Date().toLocaleString('en-GB')}\nEach code works once.\n\n${codes.join('\n')}\n`;

const ACT = {
  nav: (k) => {
    S.notice = null;
    load(k);
  },
  teacher: (id) => {
    S.teacherId = id;
    S.teacher = null;
    load('teacher');
  },
  table: (key) => {
    S.tables[key] = !S.tables[key];
    render();
  },
  recovery: () => {
    const slot = app.querySelector('[data-code-slot]');
    slot.innerHTML = field('code', 'Recovery code', { auto: 'off', extra: 'required maxlength="20" placeholder="XXXXX-XXXXX"', hint: 'Each recovery code works once.' });
    slot.querySelector('input').focus();
  },
  logout: async () => {
    try {
      await call('logout', { body: {} });
    } catch {
      /* signed out either way */
    }
    signedOut('You have signed out.');
  },
  'codes.download': () => download('plus-admin-recovery-codes.txt', codesText(S.setup.email, S.setup.codes)),
  'codes.copy': async () => {
    await navigator.clipboard.writeText(codesText(S.setup.email, S.setup.codes));
    const button = app.querySelector('[data-a="codes.copy"]');
    if (button) button.textContent = 'Copied';
  },
  'setup.done': () => {
    S.setup = null;
    S.notice = { tone: 'ok', text: 'Setup finished. Sign in with your new password and a fresh code.' };
    render();
  },
  'dlg.close': () => dlg.close(),
  'audit.more': async () => {
    const last = S.audit[S.audit.length - 1];
    const a = await call('audit', { params: `&before=${last.id}` });
    S.audit = S.audit.concat(a.audit);
    S.auditMore = a.more;
    render();
  },
  's.revoke': async (id) => {
    await call('session.revoke', { body: { id } });
    load('security');
  },
  's.others': async () => {
    await call('sessions.revoke_others', { body: {} });
    load('security');
  },
  'recovery.regen': () =>
    confirmDialog({
      title: 'Make new recovery codes',
      body: '<p>Your old codes stop working the moment these are made.</p>',
      submit: 'Make new codes',
      run: async (form) => {
        const { recovery_codes: codes } = await call('recovery.regen', { body: { code: form.code.value } });
        S.security = await call('security');
        showOnce('Your new recovery codes', `<p>Shown only now. Save them somewhere safe.</p><ol class="codes">${codes.map((c) => `<li><code>${esc(c)}</code></li>`).join('')}</ol>`);
        download('plus-admin-recovery-codes.txt', codesText(S.admin.email, codes));
      },
    }),
  't.suspend': () => {
    const t = S.teacher.teacher;
    confirmDialog({
      title: `Pause ${teacherName(t)}?`,
      body: '<p>They are signed out within a minute and cannot sign in until you restore them. Their students, classes and fees are kept, and their families can still open the app.</p>',
      fields: field('reason', 'Why', { extra: 'required minlength="3" maxlength="300"', hint: 'Kept in the audit log.' }),
      submit: 'Pause account',
      tone: 'danger',
      run: async (form) => {
        await call('teacher.suspend', { body: { id: t.id, reason: form.reason.value, code: form.code.value } });
        dlg.close();
        S.teachers = null;
        load('teacher');
      },
    });
  },
  't.restore': () => {
    const t = S.teacher.teacher;
    confirmDialog({
      title: `Restore ${teacherName(t)}?`,
      body: '<p>They can sign in again straight away.</p>',
      submit: 'Restore access',
      run: async (form) => {
        await call('teacher.restore', { body: { id: t.id, code: form.code.value } });
        dlg.close();
        S.teachers = null;
        load('teacher');
      },
    });
  },
  't.plus': () => {
    const t = S.teacher.teacher;
    confirmDialog({
      title: `Plus price for ${teacherName(t)}`,
      body: '<p>Applies to families who subscribe from now on. Families already subscribed keep the price they agreed to.</p>',
      fields:
        field('price', 'Monthly price (LKR)', { type: 'number', extra: `required min="0" max="100000" step="1" value="${esc(Number(t.plus_price))}"` }) +
        field('share', "Teacher's share (%)", { type: 'number', extra: `required min="0" max="100" step="0.1" value="${esc(Math.round(Number(t.plus_share) * 1000) / 10)}"` }),
      submit: 'Save price',
      run: async (form) => {
        await call('teacher.plus', {
          body: { id: t.id, price: Number(form.price.value), share: Number(form.share.value) / 100, code: form.code.value },
        });
        dlg.close();
        load('teacher');
      },
    });
  },
  't.code': () => {
    const t = S.teacher.teacher;
    confirmDialog({
      title: `New login code for ${teacherName(t)}`,
      body: '<p>Their old code stops working. The new one is shown once - give it to them directly. Their email and password, if they have one, still work.</p>',
      submit: 'Make a new code',
      run: async (form) => {
        const { code } = await call('teacher.code', { body: { id: t.id, code: form.code.value } });
        showOnce('Their new login code', `<p class="big-code"><code>${esc(code)}</code></p><p class="fine">It is stored only as a hash. Once you close this, nobody can read it again.</p>`);
        load('teacher');
      },
    });
  },
};

/* ---------------------------------------------------------------- forms --- */

const FORMS = {
  login: async (form) => {
    const res = await call('login', {
      body: { email: form.email.value, password: form.password.value, code: form.code.value },
    });
    S.admin = res.admin;
    const prev = res.previous?.at ? `Last sign-in before this one: ${when(res.previous.at)} from ${res.previous.ip}.` : 'This is the first sign-in on this account.';
    const left = res.recovery_left !== undefined ? ` You used a recovery code - ${res.recovery_left} left. Make new ones under Account.` : '';
    S.notice = { tone: res.recovery_left !== undefined ? 'warn' : 'ok', text: prev + left };
    const me = await call('me');
    S.idleMinutes = me.idle_minutes || 30;
    load('overview');
  },
  setup: async (form) => {
    if (form.password.value !== form.confirm.value) throw new Error('The two passwords are not the same.');
    const res = await call('setup.finish', {
      body: { token: S.setup.token, password: form.password.value, code: form.code.value },
    });
    S.setup = { done: true, email: res.email, codes: res.recovery_codes };
    S.notice = null;
    render();
  },
  password: async (form) => {
    if (form.next.value !== form.confirm.value) throw new Error('The two new passwords are not the same.');
    await call('password', { body: { current: form.current.value, next: form.next.value, code: form.code.value } });
    form.reset();
    S.notice = { tone: 'ok', text: 'Password changed. Every other session has been signed out.' };
    render();
  },
  dialog: async (form) => {
    await dlg.run(form);
  },
};

/* --------------------------------------------------------------- events --- */

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const fn = ACT[el.dataset.a];
  if (fn) Promise.resolve(fn(el.dataset.i)).catch(showError);
});
dlg.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (el && ACT[el.dataset.a]) ACT[el.dataset.a](el.dataset.i);
});
app.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const row = e.target.closest('tr[data-a]');
  if (row) ACT[row.dataset.a](row.dataset.i);
});
app.addEventListener('input', (e) => {
  if (e.target.dataset.input !== 'filter') return;
  S.filter = e.target.value;
  const pos = e.target.selectionStart;
  render();
  const box = app.querySelector('[data-input="filter"]');
  box.focus();
  box.setSelectionRange(pos, pos);
});

async function onSubmit(e) {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const button = form.querySelector('[type=submit]');
  const errorBox = form.querySelector('.dlg-error');
  button.disabled = true;
  try {
    await FORMS[form.dataset.form](form);
  } catch (err) {
    if (err.status === 401 && form.dataset.form !== 'login') return;
    if (errorBox) errorBox.textContent = err.message;
    else {
      S.notice = { tone: 'bad', text: err.message };
      const keep = form.dataset.form === 'setup';
      render();
      if (keep) app.querySelector('[name=password]')?.focus();
    }
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}
app.addEventListener('submit', onSubmit);
dlg.addEventListener('submit', onSubmit);

function showError(err) {
  if (err?.status === 401) return;
  S.notice = { tone: 'bad', text: err?.message || 'Something went wrong' };
  render();
}

/* Tooltips for chart bars. */
app.addEventListener('pointermove', (e) => {
  const hit = e.target.closest('[data-tip]');
  if (!hit) {
    tip.hidden = true;
    return;
  }
  tip.textContent = hit.dataset.tip;
  tip.hidden = false;
  const x = Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 12);
  tip.style.transform = `translate(${x}px, ${e.clientY - 36}px)`;
});
app.addEventListener('pointerleave', () => {
  tip.hidden = true;
});

/*
 * Walk away from the desk and the page signs itself out, a little before the
 * server would. The server's own idle limit is what actually protects it.
 */
let lastActive = Date.now();
for (const type of ['pointerdown', 'keydown', 'wheel']) {
  window.addEventListener(type, () => (lastActive = Date.now()), { passive: true });
}
setInterval(() => {
  if (S.admin && Date.now() - lastActive > (S.idleMinutes - 1) * 60_000) {
    ACT.logout().then(() => {
      S.notice = { tone: 'warn', text: 'Signed out after a period of no activity.' };
      render();
    });
  }
}, 30_000);

/* ----------------------------------------------------------------- start --- */

async function start() {
  // A setup link carries its token in the #fragment, which never reaches a
  // server log. Take it, then wipe it from the address bar and history.
  const match = /[#&]setup=([A-Za-z0-9_-]{40,60})/.exec(location.hash);
  if (match) {
    history.replaceState(null, '', location.pathname);
    // A setup link is its own identity: whoever was signed in in this tab is
    // not the account being set up, and their requests must not interfere.
    S.admin = null;
    S.notice = null;
    if (dlg.open) dlg.close();
    S.setup = { token: match[1] };
    render();
    try {
      const res = await call('setup.start', { body: { token: match[1] } });
      S.setup = { ...S.setup, ...res };
    } catch (err) {
      S.setup = null;
      S.notice = { tone: 'bad', text: err.message };
    }
    render();
    return;
  }
  try {
    const me = await call('me');
    S.admin = me.admin;
    S.idleMinutes = me.idle_minutes || 30;
  } catch (err) {
    S.notice = { tone: 'bad', text: err.status === 404 ? 'The admin dashboard is not switched on for this server.' : err.message };
  }
  if (S.admin) load('overview');
  else render();
}

// A setup link pasted into a tab that already shows /admin changes only the
// fragment, which does not reload the page. Without this the link would sit
// in the address bar and nothing would happen.
window.addEventListener('hashchange', () => {
  if (/[#&]setup=/.test(location.hash)) start();
});

start();
