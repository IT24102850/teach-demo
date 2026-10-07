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
