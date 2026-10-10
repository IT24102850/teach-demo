/**
 * Business rules that the server needs (section 7 of the build guide).
 *
 * The dated sessions of a class are never stored in advance: they are
 * generated from the class's weekdays, start date and skipped dates. The same
 * rules live in /app/rules.js for the browser, so both sides always agree.
 */

export const TZ = process.env.APP_TIMEZONE || 'Asia/Colombo';
export const HIST_WINDOW = 8; // "recent history" = the last 8 results

/** Today's date in the teacher's timezone, as YYYY-MM-DD. */
export function today(tz = TZ) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export const parseDate = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

export const fmtDate = (d) => d.toISOString().slice(0, 10);

export function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return fmtDate(d);
}

/** Monday = 0 … Sunday = 6 (rule 7.1.4: the week starts on Monday). */
export const weekday = (dateStr) => (parseDate(dateStr).getUTCDay() + 6) % 7;

export const startOfWeek = (dateStr) => addDays(dateStr, -weekday(dateStr));

export function monthRange(dateStr) {
  const d = parseDate(dateStr);
  const first = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const last = fmtDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
  return { first, last };
}

/** Day / week / month window used by the dashboard (rule 7.5.4). */
export function rangeDates(mode, anchor) {
  if (mode === 'day') return [anchor];
  if (mode === 'month') {
    const { first, last } = monthRange(anchor);
    const n = Number(last.slice(8)) ;
    return Array.from({ length: n }, (_, i) => addDays(first, i));
  }
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/**
 * Does this class meet on this date?
 * `skips` is a Set of "classId|date" strings.
 */
export function meetsOn(cls, dateStr, skips) {
  if (cls.active === false) return false;
  if (skips && skips.has(`${cls.id}|${dateStr}`)) return false;
  if (cls.once_date) return cls.once_date === dateStr;
  if (dateStr < cls.start_date) return false;
  return (cls.days || []).includes(weekday(dateStr));
}

/** Every session on one date, earliest first. */
export function sessionsOn(classes, dateStr, skips) {
  return classes
    .filter((c) => meetsOn(c, dateStr, skips))
    .map((c) => ({ class_id: c.id, cls: c, date: dateStr }))
    .sort((a, b) => String(a.cls.start_time).localeCompare(String(b.cls.start_time)));
}

/** Every session between two dates inclusive. */
export function sessionsBetween(classes, from, to, skips) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(...sessionsOn(classes, d, skips));
  return out;
}

export const hhmm = (t) => String(t).slice(0, 5);

export function endTime(startTime, hours) {
  const [h, m] = hhmm(startTime).split(':').map(Number);
  const total = h * 60 + m + Math.round(Number(hours) * 60);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Rule 6.2: the class type follows the number of students. */
export const classType = (n) => (n === 1 ? 'Individual' : n <= 5 ? 'Small group' : 'Group');

export function classTitle(grade, subject, count) {
  const suffix = count > 5 ? ' group' : count > 1 ? ' small group' : '';
  return `Grade ${grade} ${subject}${suffix}`;
}

/**
 * Rule 7.5.1: income for a session is the sum of the fees of the students who
 * were not marked absent. A session that has not been taught yet is valued at
 * everyone's fee.
 */
export function sessionIncome(studentIds, feeOf, absentIds) {
  const absent = new Set(absentIds || []);
  return studentIds.reduce((sum, id) => (absent.has(id) ? sum : sum + Number(feeOf(id) || 0)), 0);
}

/* ------------------------------------------------- attendance and marks --- */

export const attendancePct = (hist) =>
  hist ? Math.round(([...hist].filter((c) => c === 'P').length / hist.length) * 100) : 100;

export function streak(hist) {
  let n = 0;
  for (let i = (hist || '').length - 1; i >= 0 && hist[i] === 'P'; i -= 1) n += 1;
  return n;
}

/** Rule 7.3.2: two or more absences in the last four classes. */
export const atRisk = (hist) => [...(hist || '').slice(-4)].filter((c) => c === 'A').length >= 2;

export const markPct = (m) => (Number(m.score) / Number(m.max_score)) * 100;

/**
 * Rule 7.4.4/7.4.5: everyone who shares a class with this student, ranked, with
 * other children reduced to a first name and a surname initial BEFORE the rows
 * ever leave the server.
 */
export function maskName(name, isSelf) {
  if (isSelf) return name;
  const parts = String(name).trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || '';
  return `${parts[0]} ${parts[1][0]}.`;
}

export function rankPeers(rows, selfId, by) {
  const list = rows.filter((r) => by === 'attendance' || Number(r.mark_count) > 0);
  const score = (r) => (by === 'attendance' ? attendancePct(r.hist) : Number(r.avg_pct || 0));
  return list
    .sort(
      (a, b) =>
        score(b) - score(a) ||
        streak(b.hist) - streak(a.hist) ||
        String(a.name).localeCompare(String(b.name)),
    )
    .map((r, i) => ({
      rank: i + 1,
      id: r.id === selfId ? r.id : null,
      self: r.id === selfId,
      name: maskName(r.name, r.id === selfId),
      value: Math.round(score(r)),
      streak: streak(r.hist),
    }));
}

/* ===========================================================================
   Plus App v2 rules, server side.
   The same functions live in /app/rules.js for the browser. The browser's
   copy is there to keep the form helpful; this copy is the one that decides,
   because a request can always arrive without going through the form.
   =========================================================================== */

/* ------------------------------------- point 3 · Sri Lankan mobile number -- */

/** The national part of whatever was sent: no country code, no leading zero. */
export function lkMobileDigits(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.startsWith('0094')) d = d.slice(4);
  else if (d.startsWith('94') && d.length > 9) d = d.slice(2);
  return d.replace(/^0+/, '').slice(0, 9);
}

/** 947XXXXXXXX, or null when it is not a Sri Lankan mobile (point 3). */
export function toLkMobile(raw) {
  const d = lkMobileDigits(raw);
  return /^7\d{8}$/.test(d) ? `94${d}` : null;
}

export function formatLkMobile(stored) {
  const d = lkMobileDigits(stored);
  if (!/^7\d{8}$/.test(d)) return String(stored ?? '');
  return `+94 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`;
}

/* -------------------------------------------- point 13 · class time slots -- */

export const minutesOf = (t) => {
  const [h, m] = hhmm(t).split(':').map(Number);
  return (Number(h) || 0) * 60 + (Number(m) || 0);
};

export const classSpan = (cls) => {
  const start = minutesOf(cls.start_time);
  return { start, end: start + Math.round(Number(cls.duration_hours || 0) * 60) };
};

/** Touching is not overlapping (point 13). */
export const overlaps = (a, b) => a.start < b.end && b.start < a.end;

export function sharesDay(a, b) {
  if (a.once_date && b.once_date) return a.once_date === b.once_date;
  if (a.once_date || b.once_date) {
    const date = a.once_date || b.once_date;
    const repeating = a.once_date ? b : a;
    if ((repeating.skips || []).includes(date)) return false;
    if (repeating.start_date && date < repeating.start_date) return false;
    return (repeating.days || []).includes(weekday(date));
  }
  return (a.days || []).some((d) => (b.days || []).includes(d));
}

/** The first class the draft runs into, or null. Never compares with itself. */
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

/* ---------------------------------------- point 12 · individual or group -- */

export const CLASS_KINDS = ['individual', 'group'];
export const VENUE_TYPES = ['area', 'institute', 'own_place'];

export const classKind = (cls) =>
  cls?.kind === 'individual' || cls?.kind === 'group'
    ? cls.kind
    : (cls?.student_ids || []).length === 1
      ? 'individual'
      : 'group';

/**
 * Point 12's rule, as a message the API can return verbatim.
 * Returns an English sentence, or null when the draft is good.
 */
export function classDraftError(draft) {
  const count = (draft.student_ids || []).length;
  if (!count) return 'Pick at least one student';
  if (draft.kind === 'individual' && count !== 1) {
    return 'An individual class has exactly one student';
  }
  if (draft.kind === 'group' && count < 2) return 'A group class needs two or more students';
  if (draft.kind === 'group') {
    if (!VENUE_TYPES.includes(draft.venue_type)) return 'Say where the class is';
    if (draft.venue_type === 'institute' && !String(draft.venue_name || '').trim()) {
      return 'Enter the institute name';
    }
  }
  if (!String(draft.area || '').trim()) return 'Enter the area';
  if (!draft.once_date && !(draft.days || []).length) return 'Pick at least one day';
  if (!draft.start_time) return 'Pick a start time';
  if (!(Number(draft.duration_hours) > 0)) return 'Pick how long the class runs';
  return null;
}

/** "Bright Minds Institute · Nugegoda", "My home · Nugegoda", or "Nugegoda". */
export function venueLabel(cls, { ownPlaceName = 'My home' } = {}) {
  const area = cls?.area || cls?.place || '';
  if (cls?.venue_type === 'institute' && cls.venue_name) {
    return area ? `${cls.venue_name} · ${area}` : cls.venue_name;
  }
  if (cls?.venue_type === 'own_place') return area ? `${ownPlaceName} · ${area}` : ownPlaceName;
  return area;
}

/* ------------------------------------- point 10 · class start and end ----- */

/** Minutes actually taught, from the real timestamps, or null. */
export function taughtMinutes(session) {
  const from = Date.parse(session?.started_at || '');
  const to = Date.parse(session?.ended_at || '');
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  return Math.round((to - from) / 60000);
}

/* ------------------------------------------------ point 11 · part payment -- */

export function paymentOutcome(due, amount) {
  const owed = Math.max(0, Number(due) || 0);
  const paid = Math.min(Math.max(0, Number(amount) || 0), owed);
  return { paid, balance: Math.round((owed - paid) * 100) / 100, full: paid >= owed && owed > 0 };
}

export const receiptNo = (n) => `#${String(Number(n) || 0).padStart(4, '0')}`;

/* ===========================================================================
   Dragging a class to a new slot (point 9, phase 2).
   =========================================================================== */

export const SNAP_MINUTES = 15;
export const snapMinutes = (minutes) =>
  Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES));

/** "4:00 PM" - the clock the messages use. */
export function clock12(time) {
  const total = minutesOf(time);
  const h24 = Math.floor(total / 60) % 24;
  const h = h24 % 12 || 12;
  return `${h}:${String(total % 60).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** The same move the browser previewed, recomputed here before it is trusted. */
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
    return { ...base, id: scope === 'day' ? null : cls.id, days: [], once_date: toDate };
  }

  const was = weekday(fromDate);
  const now = weekday(toDate);
  const days = [...new Set((cls.days || []).map((d) => (d === was ? now : d)))].sort((a, b) => a - b);
  return { ...base, days, once_date: null };
}
