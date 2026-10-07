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
 * Every session on one date, with the saved result attached if there is one.
 * Sessions are generated, never stored in advance (section 4).
 */
export function sessionsOn(data, dateStr) {
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
    hours: done.reduce((a, s) => a + Number(s.cls.duration_hours), 0),
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
