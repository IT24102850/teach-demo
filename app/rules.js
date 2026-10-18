/**
 * The business rules of section 7, for the browser.
 *
 * These are pure functions over the data the server sent. They mirror
 * /api/_lib/rules.js, so the number on screen is always the number the server
 * would calculate. Anything that writes goes through /api - never from here.
 */

export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const SUBJECT_COLOUR = {
  Maths: 'var(--teal)',
  Science: 'var(--green)',
  English: 'var(--pink)',
};
export const subjectColour = (s) => SUBJECT_COLOUR[s] || 'var(--teal)';

const pad = (n) => String(n).padStart(2, '0');

export const parseDate = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const fmtDate = (d) => d.toISOString().slice(0, 10);

/** Today in the device's own timezone. */
export function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return fmtDate(d);
}

export function addMonths(dateStr, n) {
  const d = parseDate(dateStr);
  d.setUTCMonth(d.getUTCMonth() + n);
  return fmtDate(d);
}

/** Monday = 0 … Sunday = 6. */
export const weekday = (dateStr) => (parseDate(dateStr).getUTCDay() + 6) % 7;
export const startOfWeek = (dateStr) => addDays(dateStr, -weekday(dateStr));
export const startOfMonth = (dateStr) => `${dateStr.slice(0, 7)}-01`;
export function daysInMonth(dateStr) {
  const d = parseDate(dateStr);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

export const monthTitle = (dateStr, lang = 'en') =>
  parseDate(dateStr).toLocaleDateString(lang === 'ta' ? 'ta-LK' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export const dateTitle = (dateStr, lang = 'en') =>
  parseDate(dateStr).toLocaleDateString(lang === 'ta' ? 'ta-LK' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/** Short weekday name in the chosen language, Monday first. */
export function dayShort(index, lang = 'en') {
  const monday = new Date(Date.UTC(2024, 0, 1 + index)); // 1 Jan 2024 was a Monday
  return monday.toLocaleDateString(lang === 'ta' ? 'ta-LK' : 'en-GB', {
    weekday: 'short',
    timeZone: 'UTC',
  });
}

export const hhmm = (t) => String(t || '').slice(0, 5);
export const minutesOf = (t) => {
  const [h, m] = hhmm(t).split(':').map(Number);
  return h * 60 + (m || 0);
};

export function endTime(startTime, hours) {
  const total = minutesOf(startTime) + Math.round(Number(hours) * 60);
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}
export const timeRange = (cls) => `${hhmm(cls.start_time)}–${endTime(cls.start_time, cls.duration_hours)}`;

export const money = (n) => `LKR ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
export const moneyShort = (n) => {
  const v = Math.round(Number(n) || 0);
  return v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}K` : String(v);
};

export const initials = (name) =>
  String(name || '?')
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** Rule 6.2 */
export const classType = (n) => (n === 1 ? 'Individual' : n <= 5 ? 'Small group' : 'Group');
export function classTitle(grade, subject, count) {
  const suffix = count > 5 ? ' group' : count > 1 ? ' small group' : '';
  return `Grade ${grade} ${subject}${suffix}`;
}

/* ----------------------------------------------------------- sessions ----- */

/** Set of "classId|date" strings for every cancelled day. */
export const skipSet = (classes) =>
  new Set(classes.flatMap((c) => (c.skips || []).map((d) => `${c.id}|${d}`)));

export function meetsOn(cls, dateStr, skips) {
  if (cls.active === false) return false;
  if (skips.has(`${cls.id}|${dateStr}`)) return false;
  if (cls.once_date) return cls.once_date === dateStr;
  if (dateStr < cls.start_date) return false;
  return (cls.days || []).includes(weekday(dateStr));
}

/**
 * Point 1: work out a date's sessions once and reuse the answer.
 *
 * The month grid asks for 42 dates and the week grid for 7, on every redraw,
 * and each answer has to walk every class. The cache is keyed on the data
 * object itself, so a reload - which replaces `S.data` - starts a fresh one
 * and no stale session can survive. `forgetSessions` is for the one case that
 * changes the data in place: loading more sessions for a month further out.
 */
const sessionCache = new WeakMap();

export function forgetSessions(data) {
  if (data) sessionCache.delete(data);
}

function cacheFor(data) {
  let map = sessionCache.get(data);
  if (!map) {
    map = new Map();
    sessionCache.set(data, map);
  }
  return map;
}

/**
 * Every session on one date, with the saved result attached if there is one.
 * Sessions are generated, never stored in advance (section 4).
 */
export function sessionsOn(data, dateStr) {
  const cache = cacheFor(data);
  const hit = cache.get(dateStr);
  if (hit) return hit;
  const built = buildSessionsOn(data, dateStr);
  cache.set(dateStr, built);
  return built;
}

function buildSessionsOn(data, dateStr) {
  const skips = data.skips || skipSet(data.classes);
  return data.classes
    .filter((c) => meetsOn(c, dateStr, skips))
    .map((cls) => {
      const saved = (data.sessions || []).find((s) => s.class_id === cls.id && s.date === dateStr);
      return {
        key: `${cls.id}|${dateStr}`,
        cls,
        date: dateStr,
        done: saved?.status === 'done',
        notified: Boolean(saved?.notified),
        absent: saved?.absent || [],
        // Point 10: Scheduled / In progress / Ended comes from these two.
        started_at: saved?.started_at || null,
        ended_at: saved?.ended_at || null,
        session_id: saved?.id || null,
        saved: saved || null,
      };
    })
    .sort((a, b) => minutesOf(a.cls.start_time) - minutesOf(b.cls.start_time));
}

export function sessionsBetween(data, from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(...sessionsOn(data, d));
  return out;
}

/** The label on a session card (rule 7.1.3). */
export function sessionStatus(session, today) {
  if (session.done) return { label: 'Done', tone: 'g' };
  if (session.date < today) return { label: 'Not marked', tone: 'p' };
  if (session.notified) return { label: 'Parent reminded', tone: 't' };
  return { label: 'Not sent yet', tone: '' };
}

/**
 * Lay out one day's sessions on an hour grid, splitting the width into
 * columns wherever two classes overlap.
 */
export function layoutDay(sessions) {
  const blocks = sessions.map((s) => ({
    session: s,
    start: minutesOf(s.cls.start_time),
    end: minutesOf(s.cls.start_time) + Math.round(Number(s.cls.duration_hours) * 60),
  }));
  blocks.sort((a, b) => a.start - b.start || a.end - b.end);

  let group = [];
  let groupEnd = -1;
  const flush = () => {
    const columns = [];
    for (const block of group) {
      let placed = false;
      for (let i = 0; i < columns.length && !placed; i += 1) {
        if (columns[i][columns[i].length - 1].end <= block.start) {
          columns[i].push(block);
          block.column = i;
          placed = true;
        }
      }
      if (!placed) {
        block.column = columns.length;
        columns.push([block]);
      }
    }
    for (const block of group) block.columns = columns.length;
    group = [];
  };

  for (const block of blocks) {
    if (group.length && block.start >= groupEnd) flush();
    group.push(block);
    groupEnd = Math.max(groupEnd, block.end);
  }
  flush();
  return blocks;
}

/* --------------------------------------------------------------- money ---- */

const feeOf = (data, id) => Number(data.students.find((s) => s.id === id)?.fee_per_class || 0);

/** Rule 7.5.1: a session is worth the fees of the students who turned up. */
export function sessionIncome(data, session) {
  const ids = session.cls.student_ids || [];
  if (!session.done) return ids.reduce((sum, id) => sum + feeOf(data, id), 0);
  const absent = new Set(session.absent);
  return ids.reduce((sum, id) => (absent.has(id) ? sum : sum + feeOf(data, id)), 0);
}

/** Dates covered by the Day / Week / Month selector (rule 7.5.4). */
export function rangeDates(mode, anchor) {
  if (mode === 'day') return [anchor];
  if (mode === 'month') {
    const first = startOfMonth(anchor);
    return Array.from({ length: daysInMonth(anchor) }, (_, i) => addDays(first, i));
  }
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Everything the income dashboard shows for one range (rule 7.5). */
export function incomeSummary(data, mode, anchor, today) {
  const dates = rangeDates(mode, anchor);
  const perDay = dates.map((date) => {
    const sessions = sessionsOn(data, date);
    return {
      date,
      earned: sessions.filter((s) => s.done).reduce((sum, s) => sum + sessionIncome(data, s), 0),
      planned: sessions.filter((s) => !s.done).reduce((sum, s) => sum + sessionIncome(data, s), 0),
      sessions,
    };
  });

  const all = perDay.flatMap((d) => d.sessions);
  const done = all.filter((s) => s.done);
  let present = 0;
  let seats = 0;
  for (const s of done) {
    seats += (s.cls.student_ids || []).length;
    present += (s.cls.student_ids || []).length - s.absent.length;
  }

  const byClass = {};
  for (const s of done) {
    const row = (byClass[s.cls.id] = byClass[s.cls.id] || {
      cls: s.cls,
      sessions: 0,
      income: 0,
      present: 0,
      seats: 0,
    });
    row.sessions += 1;
    row.income += sessionIncome(data, s);
    row.seats += (s.cls.student_ids || []).length;
    row.present += (s.cls.student_ids || []).length - s.absent.length;
  }

  return {
    dates,
    perDay,
    earned: perDay.reduce((a, d) => a + d.earned, 0),
    planned: perDay.reduce((a, d) => a + d.planned, 0),
    classesDone: done.length,
    classesTotal: all.length,
    // Point 10: the hours really taught, falling back to the scheduled length
    // for a class that was marked before Start / End existed.
    hours: done.reduce((a, s) => {
      const real = taughtMinutes(s);
      return a + (real === null ? Number(s.cls.duration_hours) : real / 60);
    }, 0),
    attendancePct: seats ? Math.round((present / seats) * 100) : 0,
    byClass: Object.values(byClass).sort((a, b) => b.income - a.income),
    today,
  };
}

/* ---------------------------------------------------- attendance & marks -- */

export const attendancePct = (hist) =>
  hist ? Math.round(([...hist].filter((c) => c === 'P').length / hist.length) * 100) : 100;

export function streak(hist) {
  let n = 0;
  for (let i = (hist || '').length - 1; i >= 0 && hist[i] === 'P'; i -= 1) n += 1;
  return n;
}

export const atRisk = (hist) => [...(hist || '').slice(-4)].filter((c) => c === 'A').length >= 2;

export const markPct = (m) => (Number(m.score) / Number(m.max_score)) * 100;

/** Rule 7.4.2 */
export const markColour = (p) => (p >= 75 ? 'var(--green)' : p >= 50 ? 'var(--teal)' : 'var(--pink)');
export const markTextColour = (p) => (p >= 75 ? 'var(--gt)' : p >= 50 ? 'var(--tt)' : 'var(--pt)');

/** Rule 7.4.3: progress is the latest percentage minus the first. */
export const progress = (marks) =>
  marks.length < 2 ? 0 : Math.round(markPct(marks[marks.length - 1]) - markPct(marks[0]));

export const ATTENDANCE_GOAL = 90;

/**
 * The next class that has not happened yet, looking up to a fortnight ahead.
 * In the family views `data.classes` already holds only this child's classes.
 */
export function nextSession(data, today) {
  for (let i = 0; i < 14; i += 1) {
    const found = sessionsOn(data, addDays(today, i)).find((s) => !s.done);
    if (found) return found;
  }
  return null;
}

/** This week's sessions, Monday to Sunday. */
export function weekSessions(data, today) {
  const start = startOfWeek(today);
  return sessionsBetween(data, start, addDays(start, 6));
}

/* ===========================================================================
   Plus App v2 rules.
   These are the only place the new behaviour is defined. The server mirrors
   them in api/_lib/rules.js, so the browser and the database never disagree.
   =========================================================================== */

/* ------------------------------------- point 3 · Sri Lankan mobile number -- */

/**
 * Turn anything a person can type into the one stored form, 947XXXXXXXX.
 *
 *   "077 123 4567"   -> "94771234567"   (the leading 0 is dropped)
 *   "+94 77 123 4567"-> "94771234567"
 *   "94771234567"    -> "94771234567"
 *   "12345"          -> null            (not a Sri Lankan mobile)
 *
 * Nine digits starting with 7 is the whole rule: every Sri Lankan mobile
 * prefix (70, 71, 72, 74, 75, 76, 77, 78) begins with one.
 */
export function toLkMobile(raw) {
  const d = lkMobileDigits(raw);
  return /^7\d{8}$/.test(d) ? `94${d}` : null;
}

/** The national part of whatever was typed: no country code, no leading 0. */
export function lkMobileDigits(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.startsWith('0094')) d = d.slice(4);
  else if (d.startsWith('94') && d.length > 9) d = d.slice(2);
  return d.replace(/^0+/, '').slice(0, 9);
}

/** Shown to people: +94 77 123 4567. Anything unrecognised is passed through. */
export function formatLkMobile(stored) {
  const d = lkMobileDigits(stored);
  if (!/^7\d{8}$/.test(d)) return String(stored ?? '');
  return `+94 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`;
}

/** Spaced for the input box while typing: 77 123 4567. */
export function groupLkMobile(raw) {
  const d = lkMobileDigits(raw);
  return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 9)].filter(Boolean).join(' ');
}

/**
 * Why the number is not acceptable yet, as an i18n key, or null when it is.
 * `empty` is separated out so a field the person has not reached yet can stay
 * quiet instead of shouting at them.
 */
export function lkMobileError(raw) {
  const d = lkMobileDigits(raw);
  if (!d) return 'empty';
  if (!d.startsWith('7')) return 'tel_start7';
  if (d.length !== 9) return 'tel_nine';
  return null;
}

export const isLkMobile = (raw) => toLkMobile(raw) !== null;

/* -------------------------------------------- point 13 · class time slots -- */

/** Start chips: every half hour from 06:00 to 21:00. */
export function startChoices(from = 6, to = 21) {
  const out = [];
  for (let m = from * 60; m <= to * 60; m += 30) out.push(fromMinutes(m));
  return out;
}

export const DURATION_CHOICES = [1, 1.5, 2, 2.5, 3];

export const fromMinutes = (total) => {
  const m = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};

/** "4:00 PM" - the 12 hour clock the mock-ups use. */
export function clock12(time) {
  const total = minutesOf(time);
  const h24 = Math.floor(total / 60) % 24;
  const h = h24 % 12 || 12;
  return `${h}:${pad(total % 60)} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** "2 h 30 m", or "2 h" when it is a whole number of hours. */
export function durationLabel(hours) {
  const total = Math.round(Number(hours) * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} m`;
  return m ? `${h} h ${m} m` : `${h} h`;
}

/** "4:00 PM – 6:30 PM" worked out from the start and the length. */
export const slotLabel = (start, hours) =>
  `${clock12(start)} – ${clock12(endTime(start, hours))}`;

/** Start and end of a class in minutes from midnight. */
export const classSpan = (cls) => {
  const start = minutesOf(cls.start_time);
  return { start, end: start + Math.round(Number(cls.duration_hours || 0) * 60) };
};

/**
 * Touching is not overlapping: a class 6:30–7:30 does not clash with one that
 * ends at 6:30.
 */
export const overlaps = (a, b) => a.start < b.end && b.start < a.end;

/**
 * Can these two ever fall on the same calendar day?
 * `a` is the class being edited, as { days, once_date, start_date }.
 */
export function sharesDay(a, b) {
  const aDays = a.once_date ? [weekday(a.once_date)] : a.days || [];
  const bDays = b.once_date ? [weekday(b.once_date)] : b.days || [];

  if (a.once_date && b.once_date) return a.once_date === b.once_date;

  if (a.once_date || b.once_date) {
    const date = a.once_date || b.once_date;
    const repeating = a.once_date ? b : a;
    if ((repeating.skips || []).includes(date)) return false;
    if (repeating.start_date && date < repeating.start_date) return false;
    return (repeating.days || []).includes(weekday(date));
  }

  return aDays.some((d) => bDays.includes(d));
}

/**
 * The first class the draft would run into, or null.
 * `draft` is { days, once_date, start_date, start_time, duration_hours, id }.
 * A class is never compared with itself, so editing a class in place is safe.
 */
export function findClash(existing, draft) {
  const span = classSpan(draft);
  if (!Number.isFinite(span.start) || span.end <= span.start) return null;
  return (
    (existing || []).find(
      (c) =>
        c.id !== draft.id &&
        c.active !== false &&
        sharesDay(draft, c) &&
        overlaps(span, classSpan(c)),
    ) || null
  );
}

/** The day a clash happens on, for the warning line. */
export function clashDay(draft, cls, lang = 'en') {
  if (draft.once_date) return dateTitle(draft.once_date, lang);
  if (cls.once_date) return dateTitle(cls.once_date, lang);
  const shared = (draft.days || []).find((d) => (cls.days || []).includes(d));
  return shared === undefined ? '' : DAY_LONG[shared];
}

/** A one-off class may not be put in the past (point 13). */
export const slotInPast = (draft, today, nowMinutes) => {
  if (!draft.once_date) return false;
  if (draft.once_date < today) return true;
  if (draft.once_date > today) return false;
  return minutesOf(draft.start_time) < Number(nowMinutes ?? 0);
};

/** Travel warning: two classes in different areas less than 30 minutes apart. */
export const TRAVEL_GAP = 30;
export function travelWarning(existing, draft) {
  const span = classSpan(draft);
  const area = String(draft.area || draft.place || '').trim().toLowerCase();
  if (!area) return null;
  return (
    (existing || []).find((c) => {
      if (c.id === draft.id || c.active === false || !sharesDay(draft, c)) return false;
      const other = String(c.area || c.place || '').trim().toLowerCase();
      if (!other || other === area) return false;
      const b = classSpan(c);
      const gap = span.start >= b.end ? span.start - b.end : b.start - span.end;
      return gap >= 0 && gap < TRAVEL_GAP;
    }) || null
  );
}

/* ---------------------------------------- point 12 · individual or group -- */

export const CLASS_KINDS = ['individual', 'group'];
export const VENUE_TYPES = ['area', 'institute', 'own_place'];

/**
 * The stored kind wins. Classes created before this release have no `kind`,
 * so they fall back to the old rule 6.2 guess from the student count - that
 * way an old class still reads correctly instead of showing a blank.
 */
export const classKind = (cls) =>
  cls?.kind === 'individual' || cls?.kind === 'group'
    ? cls.kind
    : (cls?.student_ids || []).length === 1
      ? 'individual'
      : 'group';

/** "Bright Minds Institute · Nugegoda", "My home · Nugegoda", or "Nugegoda". */
export function venueLabel(cls, { ownPlaceName = 'My home' } = {}) {
  const area = cls?.area || cls?.place || '';
  if (cls?.venue_type === 'institute' && cls.venue_name) {
    return area ? `${cls.venue_name} · ${area}` : cls.venue_name;
  }
  if (cls?.venue_type === 'own_place') return area ? `${ownPlaceName} · ${area}` : ownPlaceName;
  return area;
}

/**
 * Point 12's "Done when": an individual class cannot hold two students, and a
 * group class cannot hold one, or be saved without somewhere to be.
 * Returns an i18n key, or null when the draft is good.
 */
export function classDraftError(draft) {
  const count = (draft.student_ids || []).length;
  if (!count) return 'pick_students';
  if (draft.kind === 'individual' && count !== 1) return 'individual_one_student';
  if (draft.kind === 'group' && count < 2) return 'group_two_students';

  if (draft.kind === 'group') {
    if (!VENUE_TYPES.includes(draft.venue_type)) return 'pick_venue';
    if (draft.venue_type === 'institute' && !String(draft.venue_name || '').trim()) {
      return 'enter_institute';
    }
    if (!String(draft.area || '').trim()) return 'enter_area';
  } else if (!String(draft.area || '').trim()) {
    return 'enter_area';
  }

  if (!draft.once_date && !(draft.days || []).length) return 'pick_days';
  if (!draft.start_time) return 'pick_time';
  if (!(Number(draft.duration_hours) > 0)) return 'pick_time';
  return null;
}

/* ------------------------------------- point 10 · class start and end ----- */

/** Scheduled -> In progress -> Ended (or Cancelled by "Skip this day"). */
export function sessionState(session) {
  if (!session) return 'scheduled';
  if (session.cancelled) return 'cancelled';
  if (session.done) return 'ended';
  if (session.started_at && !session.ended_at) return 'running';
  return 'scheduled';
}

/** 00:42:18 - how long the class has been running, or how long it ran. */
export function elapsed(fromIso, toIso) {
  const from = Date.parse(fromIso || '');
  if (!Number.isFinite(from)) return '00:00:00';
  const to = toIso ? Date.parse(toIso) : Date.now();
  const s = Math.max(0, Math.floor((to - from) / 1000));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(pad).join(':');
}

/** The minutes actually taught, used for "hours taught" on the dashboard. */
export function taughtMinutes(session) {
  const from = Date.parse(session?.started_at || '');
  const to = Date.parse(session?.ended_at || '');
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  return Math.round((to - from) / 60000);
}

/** "4:02 – 6:31 PM" from the real timestamps. */
export function realRange(session) {
  if (!session?.started_at || !session?.ended_at) return '';
  const f = (iso) => {
    const d = new Date(iso);
    return `${d.getHours() % 12 || 12}:${pad(d.getMinutes())}`;
  };
  const end = new Date(session.ended_at);
  return `${f(session.started_at)} – ${f(session.ended_at)} ${end.getHours() < 12 ? 'AM' : 'PM'}`;
}

/* ------------------------------------------------ point 11 · part payment -- */

/**
 * What a payment leaves behind. `amount` is clamped to what is owed, so a
 * mistyped 60000 on a 6000 bill can never create a credit.
 */
export function paymentOutcome(due, amount) {
  const owed = Math.max(0, Number(due) || 0);
  const paid = Math.min(Math.max(0, Number(amount) || 0), owed);
  return { paid, balance: Math.round((owed - paid) * 100) / 100, full: paid >= owed && owed > 0 };
}

/** The teacher may not confirm an amount of nothing (point 11). */
export function paymentError(due, amount) {
  const owed = Math.max(0, Number(due) || 0);
  if (owed <= 0) return 'nothing_owed';
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return 'enter_amount';
  return null;
}

/** #0012 - the receipt number the parent sees. */
export const receiptNo = (n) => `#${String(Number(n) || 0).padStart(4, '0')}`;

/* ===========================================================================
   Dragging a class to a new slot (point 9, phase 2).
   =========================================================================== */

/** Dropped times land on a quarter hour, so a drag cannot make 4:07 PM. */
export const SNAP_MINUTES = 15;
export const snapMinutes = (minutes) =>
  Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES));

/**
 * What a drag would change, as a draft `findClash` can read.
 *
 * `scope` is the same question point 9 asks when editing: moving one Wednesday
 * ("day") makes a one-off on the new date, while moving the class ("all")
 * swaps that weekday for the new one and leaves the rest alone.
 */
export function movedDraft(cls, { fromDate, toDate, startTime, scope }) {
  const base = {
    id: cls.id,
    kind: classKind(cls),
    student_ids: cls.student_ids || [],
    venue_type: cls.venue_type || 'area',
    venue_name: cls.venue_name,
    area: cls.area || cls.place || '',
    start_time: startTime,
    duration_hours: Number(cls.duration_hours) || 1,
    start_date: cls.start_date,
  };

  if (scope === 'day' || cls.once_date) {
    // A single moved session is a one-off on the day it was dropped.
    return { ...base, id: scope === 'day' ? null : cls.id, days: [], once_date: toDate };
  }

  // The whole class: the weekday it was dragged off is replaced by the new one.
  const was = weekday(fromDate);
  const now = weekday(toDate);
  const days = [...new Set((cls.days || []).map((d) => (d === was ? now : d)))].sort((a, b) => a - b);
  return { ...base, days, once_date: null };
}

/** Has anything actually changed? A drag that lands where it started is a tap. */
export const movedAnything = (cls, { fromDate, toDate, startTime }) =>
  toDate !== fromDate || hhmm(startTime) !== hhmm(cls.start_time);

/** "Thursday 19 Mar · 5:00 PM", the line the parent reads. */
export const whenLabel = (date, time, lang = 'en') =>
  `${dateTitle(date, lang)} · ${clock12(time)}`;

/* ===========================================================================
   Plus subscriptions and the Income tab (design handoff, screens 1-4).
   =========================================================================== */

/**
 * The goal ladder.
 *
 * The handoff says a goal is "the next step of 25% more subscribed students
 * (e.g. 24 -> 30)". Worked out from the *current* count that target would
 * move every time somebody joined, so the teacher could never close the gap
 * and the "4 of 6" ring could never fill. So the rungs are fixed in advance
 * and the teacher climbs them: each is 25% above the one below, rounded up.
 *
 *   5, 7, 9, 12, 15, 19, 24, 30, 38, 48, 60, 75, ...
 *
 * At 24 students the next rung is 30 - "add 6 more", exactly as the design
 * shows - and at 28 the ring reads 4 of 6 with "just 2 more to go".
 */
export const GOAL_STEP = 1.25;
export const FIRST_GOAL = 5;

export function goalLadder(upTo = 10_000) {
  const rungs = [FIRST_GOAL];
  while (rungs[rungs.length - 1] < upTo) {
    const next = Math.ceil(rungs[rungs.length - 1] * GOAL_STEP);
    rungs.push(next > rungs[rungs.length - 1] ? next : rungs[rungs.length - 1] + 1);
  }
  return rungs;
}

/**
 * Where the teacher is on the ladder.
 *
 * `from` is the rung already reached, `goal` the one being climbed to, and
 * `joined`/`need` fill the ring. `almost` is the handoff's "1-2 students away".
 */
export function plusGoal(students) {
  const count = Math.max(0, Number(students) || 0);
  const rungs = goalLadder(count * GOAL_STEP + FIRST_GOAL + 1);

  const goal = rungs.find((rung) => rung > count) ?? count + 1;
  const reached = [...rungs].reverse().find((rung) => rung <= count) ?? 0;

  const need = goal - reached;
  const joined = count - reached;
  const remaining = goal - count;

  return {
    students: count,
    goal,
    from: reached,
    need, // how many this rung asks for
    joined, // how many of those have joined
    remaining, // how many are left
    pct: need > 0 ? Math.round((joined / need) * 100) : 0,
    almost: remaining > 0 && remaining <= 2,
    /** The handoff's headline: a full rung is 25% more students. */
    uplift: Math.round((goal / Math.max(1, reached || count || 1) - 1) * 100),
  };
}

/**
 * "Plus is growing N× faster than tuition".
 *
 * Both sides are growth since the teacher joined Plus - last month against
 * the first - so a teacher with a big tuition book and a new Plus list is
 * compared fairly. Returns null when the claim cannot honestly be made:
 * fewer than two months either side, nothing to grow from, or tuition that
 * did not grow at all (dividing by that would print a nonsense multiple).
 */
export const MAX_MULTIPLE = 20;

export function growthMultiple(plusMonths, tuitionMonths) {
  const rate = (rows, key) => {
    const values = (rows || []).map((r) => Number(r[key]) || 0);
    if (values.length < 2) return null;
    const first = values.find((v) => v > 0);
    const last = values[values.length - 1];
    if (!first || first <= 0) return null;
    return (last - first) / first;
  };

  const plus = rate(plusMonths, 'teacher_income');
  const tuition = rate(tuitionMonths, 'charged');
  if (plus === null || tuition === null) return null;
  if (plus <= 0 || tuition <= 0) return null;

  /*
   * Plus starts from almost nothing, so its growth percentage dwarfs an
   * established tuition book and the raw ratio runs into the hundreds. A
   * headline of "300x faster" is true arithmetic and useless to a teacher,
   * so the claim is capped. Below 2x there is no claim worth making either.
   */
  const multiple = Math.min(MAX_MULTIPLE, Math.round(plus / tuition));
  return multiple >= 2 ? multiple : null;
}

/** The two lines on the graph, scaled 0-1 so they share one axis. */
export function growthSeries(plusMonths, tuitionMonths) {
  const months = (plusMonths || []).map((m) => m.month);
  const at = (rows, month, key) =>
    Number((rows || []).find((r) => r.month === month)?.[key] || 0);

  const plus = months.map((m) => at(plusMonths, m, 'teacher_income'));
  const tuition = months.map((m) => at(tuitionMonths, m, 'charged'));
  const scale = (values) => {
    const top = Math.max(...values, 1);
    return values.map((v) => v / top);
  };
  return { months, plus: scale(plus), tuition: scale(tuition), rawPlus: plus, rawTuition: tuition };
}

/**
 * Who is left to invite, class by class, fullest first.
 *
 * The handoff's README calls this "parents to subscribe" and the screen calls
 * it "not on Plus". They are the same number; the screen's wording is used,
 * because the teacher is looking at students, not at parents.
 */
export function classesToInvite(classes, students) {
  const onPlus = new Set(
    (students || []).filter((s) => s.on_plus).map((s) => s.id),
  );
  return (classes || [])
    .filter((c) => c.active !== false)
    .map((cls) => {
      const ids = cls.student_ids || [];
      const missing = ids.filter((id) => !onPlus.has(id));
      return {
        cls,
        total: ids.length,
        on: ids.length - missing.length,
        off: missing.length,
        missing,
      };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.off - a.off || String(a.cls.title).localeCompare(String(b.cls.title)));
}

/** Everything the Income tab needs, worked out in one place. */
export function incomeSummaryPlus(data) {
  const students = (data?.students || []).filter((s) => s.status !== 'archived');
  const on = students.filter((s) => s.on_plus);
  const plusMonths = data?.plus_months || [];
  const tuitionMonths = data?.tuition_months || [];

  return {
    students: on.length,
    goal: plusGoal(on.length),
    multiple: growthMultiple(plusMonths, tuitionMonths),
    series: growthSeries(plusMonths, tuitionMonths),
    byClass: classesToInvite(data?.classes || [], students),
    notOnPlus: students.length - on.length,
  };
}
