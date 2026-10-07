/**
 * The teacher's four tabs and their detail screens (section 8.1).
 *
 * Every screen is a function that returns HTML from the data the server sent.
 * Writes live in teacher-forms.js.
 */

import { t } from '../i18n.js';
import * as R from '../rules.js';
import { S, classById, classes, studentById, students } from '../state.js';
import {
  avatar,
  backButton,
  bar,
  barChart,
  big,
  button,
  card,
  dots,
  emptyState,
  esc,
  iconButton,
  label,
  muted,
  pill,
  segmented,
  stackChart,
  tiles,
} from '../ui.js';
import { ACTIONS as FORM_ACTIONS } from './teacher-forms.js';

/* ----------------------------------------------------------- shared bits -- */

const HOUR_PX = 56;

/** The hour window the timeline needs to show everything, with a little air. */
function hourWindow(sessions) {
  let from = 7;
  let to = 20;
  for (const s of sessions) {
    const start = Math.floor(R.minutesOf(s.cls.start_time) / 60);
    const end = Math.ceil((R.minutesOf(s.cls.start_time) + Number(s.cls.duration_hours) * 60) / 60);
    from = Math.min(from, start);
    to = Math.max(to, end);
  }
  return { from: Math.max(0, from - 1), to: Math.min(24, to + 1) };
}

/** Rule 7.1.3, as a translated pill. */
const STATUS_KEY = {
  Done: 'done',
  'Not marked': 'not_marked',
  'Parent reminded': 'reminded',
  'Not sent yet': 'not_sent',
};

function statusPill(session) {
  const status = R.sessionStatus(session, S.today);
  return pill(t(STATUS_KEY[status.label] || 'done'), status.tone);
}

const typeKey = (n) => R.classType(n).toLowerCase().replace(' ', '_');

export function sessionCard(session, { showDate = false } = {}) {
  const { cls } = session;
  const count = (cls.student_ids || []).length;
  const isFuture = session.date > S.today;

  // Today or earlier: take attendance. Later: remind the parents (rule 7.1.3).
  const footer = session.done
    ? ''
    : isFuture
      ? button(t('remind_parent'), { act: 'session.notify', arg: session.key, cls: 'sm o mt-s' })
      : button(t('mark_attendance'), { act: 'attend.open', arg: session.key, cls: 'sm mt-s' });

  return card(
    `<div class="row sp"><b>${esc(
      `${showDate ? `${R.dayShort(R.weekday(session.date), S.lang)} ` : ''}${R.timeRange(cls)}`,
    )}</b>${statusPill(session)}</div>
     <div data-a="${isFuture ? 'class.open' : 'attend.open'}" data-i="${esc(session.key)}" role="button" tabindex="0">
       <b class="sess-t">${esc(cls.title)}</b>
       ${muted(`${cls.curriculum} · ${t(typeKey(count))} · ${cls.place || ''}`)}
     </div>
     ${footer}`,
    {
      cls: 'sess',
      style: `border-left-color:${R.subjectColour(cls.subject)}`,
    },
  );
}

/* ------------------------------------------------------------- 1 · today -- */

export function today() {
  const data = S.data;
  const todaySessions = R.sessionsOn(data, S.today);
  const next = todaySessions.find((s) => !s.done);
  const doneCount = todaySessions.filter((s) => s.done).length;
  const pending = students().filter((s) => s.status === 'pending');
  const owed = students().reduce((a, s) => a + Number(s.amount_due), 0);

  const heroButton = button(t('mark_attendance'), {
    act: 'attend.open',
    arg: next?.key,
    cls: 'k',
  });

  return `
    <div class="row sp top-row">
      <div>
        ${muted(R.dateTitle(S.today, S.lang))}
        <h1>${esc(t('greeting', { name: S.teacher?.name || '' }))}</h1>
        ${muted(t('classes_today', { n: todaySessions.length, done: doneCount }))}
      </div>
      ${iconButton(esc((S.teacher?.name || '?')[0]), {
        act: 'settings.open',
        aria: t('settings'),
        cls: 'brandy',
      })}
    </div>

    ${button(t('income_and_classes'), { act: 'nav.dashboard', cls: 'o wide' })}

    ${
      next
        ? card(
            `${label(`${t('next_class')} · ${R.hhmm(next.cls.start_time)}`)}
             ${big(next.cls.title, 'margin:8px 0')}
             <div>${esc(`${(next.cls.student_ids || []).length} ${t('students').toLowerCase()} · ${next.cls.place || ''}`)}</div>
             ${heroButton}`,
            { cls: 'hero' },
          )
        : todaySessions.length
          ? emptyState(t('all_done_today'), '🎉')
          : emptyState(t('no_class_today'), '☕')
    }

    ${todaySessions.filter((s) => s !== next).map((s) => sessionCard(s)).join('')}

    ${
      pending.length
        ? card(
            `<div class="row">${pill(t('new_signup'), 't')}<b class="g">${esc(
              pending.map((p) => p.name).join(', '),
            )}</b><span class="mu">›</span></div>`,
            { act: 'nav.tab', arg: 'students', cls: 'tap' },
          )
        : ''
    }

    ${
      (data.reschedules || []).length
        ? card(
            `${label(t('ask_reschedule'))}${(data.reschedules || [])
              .map(
                (q) =>
                  `<div class="row sp mt-s"><span class="g">${esc(
                    studentById(q.student_id)?.name || '',
                  )}${q.session_date ? esc(` · ${q.session_date}`) : ''}</span>
                   <span class="row gap-s">${button('✓', {
                     act: 'reschedule.resolve',
                     arg: `${q.id}|accepted`,
                     cls: 'sm gr',
                   })}${button('✕', { act: 'reschedule.resolve', arg: `${q.id}|declined`, cls: 'sm gh' })}</span></div>`,
              )
              .join('')}`,
          )
        : ''
    }

    <div class="row sp mt">
      <b class="h3">${esc(t('fees'))}</b>
      ${button(t('see_who'), { act: 'nav.tab', arg: 'fees', cls: 'sm o' })}
    </div>
    ${card(`${label(t('not_paid_yet'))}${big(R.money(owed), 'color:var(--pt)')}`)}

    ${button(t('earn_more'), { act: 'nav.earn', cls: 'o wide' })}
  `;
}

/* --------------------------------------------------------- 2 · calendar -- */

function dateStrip() {
  const start = R.startOfWeek(S.cal.date);
  return `<div class="strip">${Array.from({ length: 7 }, (_, i) => {
    const date = R.addDays(start, i);
    const count = R.sessionsOn(S.data, date).length;
    const cls = [date === S.cal.date ? 'on' : '', date === S.today ? 'today' : ''].join(' ');
    return `<button type="button" class="strip-d ${cls}" data-a="cal.pick" data-i="${date}">
      <span class="strip-w">${esc(R.dayShort(i, S.lang))}</span>
      <span class="strip-n">${esc(Number(date.slice(8)))}</span>
      <span class="strip-dot" style="opacity:${count ? 1 : 0}"></span>
    </button>`;
  }).join('')}</div>`;
}

function hourColumn(from, to) {
  return `<div class="tl-hours">${Array.from({ length: to - from }, (_, i) =>
    `<div class="tl-h"><span>${String(from + i).padStart(2, '0')}:00</span></div>`,
  ).join('')}</div>`;
}

function nowLine(from, to) {
  const d = new Date();
  const minutes = d.getHours() * 60 + d.getMinutes();
  if (minutes < from * 60 || minutes > to * 60) return '';
  const top = ((minutes - from * 60) / 60) * HOUR_PX;
  return `<div class="now" style="top:${top}px" aria-hidden="true"></div>`;
}

function dayBlocks(date, { narrow = false, from, to } = {}) {
  return R.layoutDay(R.sessionsOn(S.data, date))
    .map((b) => {
      const { session } = b;
      const top = ((b.start - from * 60) / 60) * HOUR_PX;
      const height = Math.max(26, ((b.end - b.start) / 60) * HOUR_PX - 3);
      const width = 100 / (b.columns || 1);
      const left = width * (b.column || 0);
      const colour = R.subjectColour(session.cls.subject);
      const act = session.date === S.today || session.date < S.today ? 'attend.open' : 'class.open';
      return `<button type="button" class="blk${session.done ? ' is-done' : ''}" data-a="${act}" data-i="${
        session.key
      }" style="top:${top}px;height:${height}px;left:${left}%;width:calc(${width}% - 4px);background:${colour}">
        <b>${esc(R.hhmm(session.cls.start_time))}</b>
        <span>${esc(narrow ? session.cls.subject : session.cls.title)}</span>
        ${narrow ? '' : `<i>${esc(session.cls.place || '')}</i>`}
      </button>`;
    })
    .join('');
}

function calendarDay() {
  const sessions = R.sessionsOn(S.data, S.cal.date);
  const { from, to } = hourWindow(sessions);
  if (!sessions.length) return emptyState(t('no_classes_day'), '📅');
  return `<div class="tl">${hourColumn(from, to)}
    <div class="tl-grid" style="height:${(to - from) * HOUR_PX}px">
      ${Array.from({ length: to - from }, (_, i) => `<div class="tl-line" style="top:${i * HOUR_PX}px"></div>`).join('')}
      ${dayBlocks(S.cal.date, { from, to })}
      ${S.cal.date === S.today ? nowLine(from, to) : ''}
    </div></div>`;
}

function calendarWeek() {
  const start = R.startOfWeek(S.cal.date);
  const dates = Array.from({ length: 7 }, (_, i) => R.addDays(start, i));
  const all = dates.flatMap((d) => R.sessionsOn(S.data, d));
  const { from, to } = hourWindow(all);
  return `
    <div class="wk-head">${dates
      .map(
        (d, i) =>
          `<button type="button" class="wk-h${d === S.today ? ' today' : ''}" data-a="cal.day" data-i="${d}">
            <span>${esc(R.dayShort(i, S.lang))}</span><b>${esc(Number(d.slice(8)))}</b></button>`,
      )
      .join('')}</div>
    <div class="tl">${hourColumn(from, to)}
      <div class="wk-cols" style="height:${(to - from) * HOUR_PX}px">
        ${Array.from({ length: to - from }, (_, i) => `<div class="tl-line" style="top:${i * HOUR_PX}px"></div>`).join('')}
        ${dates
          .map(
            (d) =>
              `<div class="wk-col${d === S.today ? ' today' : ''}">${dayBlocks(d, {
                narrow: true,
                from,
                to,
              })}</div>`,
          )
          .join('')}
        ${dates.includes(S.today) ? nowLine(from, to) : ''}
      </div></div>`;
}

function calendarMonth() {
  const first = R.startOfMonth(S.cal.date);
  const gridStart = R.addDays(first, -R.weekday(first));
  const month = S.cal.date.slice(0, 7);
  return `
    <div class="mon">
      ${R.DAY_SHORT.map((_, i) => `<span class="lbl center">${esc(R.dayShort(i, S.lang)[0])}</span>`).join('')}
      ${Array.from({ length: 42 }, (_, i) => {
        const date = R.addDays(gridStart, i);
        const sessions = R.sessionsOn(S.data, date);
        const outside = date.slice(0, 7) !== month;
        return `<button type="button" class="mon-d${outside ? ' x' : ''}${date === S.today ? ' today' : ''}" data-a="cal.day" data-i="${date}">
          <span class="mon-n">${esc(Number(date.slice(8)))}</span>
          ${sessions
            .slice(0, 3)
            .map(
              (s) =>
                `<i style="background:${R.subjectColour(s.cls.subject)};opacity:${s.done ? 0.45 : 1}"></i>`,
            )
            .join('')}
          ${sessions.length > 3 ? `<em>+${sessions.length - 3}</em>` : ''}
        </button>`;
      }).join('')}
    </div>
    <p class="legend">${(S.teacher?.subjects?.length ? S.teacher.subjects : Object.keys(R.SUBJECT_COLOUR))
      .map((s) => `<span><i style="background:${R.subjectColour(s)}"></i>${esc(s)}</span>`)
      .join('')}</p>`;
}

export function calendar() {
  const mode = S.cal.mode;
  const body = mode === 'day' ? calendarDay() : mode === 'week' ? calendarWeek() : calendarMonth();
  const title = mode === 'day' ? R.dateTitle(S.cal.date, S.lang) : R.monthTitle(S.cal.date, S.lang);

  return `
    <div class="row sp top-row">
      <h1 class="cal-h">${esc(title)}</h1>
      <div class="row gap-s">
        ${button(t('today'), { act: 'cal.day', arg: S.today, cls: 'sm o' })}
        ${iconButton('+', { act: 'class.add', aria: t('add_class'), cls: 'brandy' })}
      </div>
    </div>
    ${segmented(
      [
        { value: 'day', label: t('day') },
        { value: 'week', label: t('week') },
        { value: 'month', label: t('month') },
      ],
      mode,
      'cal.mode',
    )}
    <div class="row sp nav-row">
      ${iconButton('‹', { act: 'cal.step', arg: '-1', aria: 'Previous' })}
      ${mode === 'day' ? dateStrip() : `<span class="mu">${esc(R.monthTitle(S.cal.date, S.lang))}</span>`}
      ${iconButton('›', { act: 'cal.step', arg: '1', aria: 'Next' })}
    </div>
    ${body}
    ${button(t('all_classes'), { act: 'nav.allclasses', cls: 'o wide mt' })}
  `;
}

/* ---------------------------------------------- all classes & one class -- */

export function allClasses() {
  const grouped = R.DAY_SHORT.map((name, index) => ({
    name,
    index,
    list: classes().filter((c) => (c.days || []).includes(index)),
  })).filter((g) => g.list.length);
  const onceOnly = classes().filter((c) => c.once_date);

  return `
    <div class="row top-row">${backButton()}<h1>${esc(t('all_classes'))}</h1></div>
    ${
      grouped.length || onceOnly.length
        ? ''
        : emptyState(t('no_classes_day'), '📚')
    }
    ${grouped
      .map(
        (g) =>
          `${label(R.DAY_LONG[g.index])}${g.list
            .map((c) =>
              card(
                `<b>${esc(c.title)}</b>${muted(
                  `${R.hhmm(c.start_time)} · ${c.place || ''} · ${(c.student_ids || []).length} ${t(
                    'students',
                  ).toLowerCase()}`,
                )}`,
                {
                  cls: 'sess tap',
                  style: `border-left-color:${R.subjectColour(c.subject)}`,
                  act: 'class.detail',
                  arg: c.id,
                },
              ),
            )
            .join('')}`,
      )
      .join('')}
    ${
      onceOnly.length
        ? label(t('just_once')) +
          onceOnly
            .map((c) =>
              card(`<b>${esc(c.title)}</b>${muted(`${c.once_date} · ${R.hhmm(c.start_time)}`)}`, {
                cls: 'sess tap',
                style: `border-left-color:${R.subjectColour(c.subject)}`,
                act: 'class.detail',
                arg: c.id,
              }),
            )
            .join('')
        : ''
    }
  `;
}

export function classDetail() {
  const cls = classById(S.sub.id);
  if (!cls) return emptyState('That class is gone.', '🤷');
  const enrolled = (cls.student_ids || []).map(studentById).filter(Boolean);

  return `
    <div class="row top-row">${backButton()}<h1 class="cal-h">${esc(cls.title)}</h1></div>
    ${card(
      `${muted(`${cls.curriculum} · ${t(typeKey(enrolled.length))}`)}
       <b class="blk-b">${esc(
         cls.once_date
           ? `${cls.once_date} · ${R.timeRange(cls)}`
           : `${(cls.days || []).map((d) => R.DAY_SHORT[d]).join(', ')} · ${R.timeRange(cls)}`,
       )}</b>
       ${muted(cls.place || '')}`,
    )}
    ${label(t('students'))}
    ${enrolled
      .map((s) =>
        card(
          `<div class="row">${avatar(s.name)}<b class="g">${esc(s.name)}</b>${
            Number(s.amount_due) > 0 ? pill(R.money(s.amount_due), 'p') : ''
          }</div>`,
          { act: 'student.open', arg: s.id, cls: 'tap' },
        ),
      )
      .join('')}
    ${
      (cls.skips || []).length
        ? card(`${label(t('skip_this_day'))}${(cls.skips || [])
            .map(
              (d) =>
                `<div class="row sp mt-s"><span>${esc(d)}</span>${button(t('remove'), {
                  act: 'class.unskip',
                  arg: `${cls.id}|${d}`,
                  cls: 'sm gh',
                })}</div>`,
            )
            .join('')}`)
        : ''
    }
    ${button(t('skip_this_day'), { act: 'class.skip', arg: cls.id, cls: 'o wide mt' })}
    ${button(S.sub.sure ? t('remove_class_again') : t('remove_class'), {
      act: 'class.remove',
      arg: cls.id,
      cls: 'd wide',
    })}
  `;
}

/* -------------------------------------------------------- 3 · attendance -- */

export function attendance() {
  const [classId, date] = String(S.sub.key).split('|');
  const cls = classById(classId);
  if (!cls) return emptyState('That class is gone.', '🤷');
  const absent = S.sub.absent || [];
  const enrolled = (cls.student_ids || []).map(studentById).filter(Boolean);

  return `
    <div class="row top-row">${backButton()}
      <div><h1 class="att-h">${esc(cls.title)}</h1>
      ${muted(`${R.dateTitle(date, S.lang)} · ${R.timeRange(cls)} · ${cls.place || ''}`)}</div>
    </div>
    <p class="mu note">${esc(t('everyone_present'))}</p>
    ${enrolled
      .map((s) => {
        const isAbsent = absent.includes(s.id);
        return card(
          `<div class="row">${avatar(s.name)}
            <div class="g"><b>${esc(s.name)}</b>${muted(`${t('grade')} ${s.grade ?? '–'}`)}</div>
            ${pill(isAbsent ? t('absent') : t('present'), isAbsent ? 'p' : 'g')}</div>`,
          { act: 'attend.toggle', arg: s.id, cls: `tap att-row ${isAbsent ? 'is-absent' : 'is-present'}` },
        );
      })
      .join('')}
    <div class="row sp mt">
      <b>${esc(t('count_present_absent', { present: enrolled.length - absent.length, absent: absent.length }))}</b>
    </div>
    ${button(t('done'), { act: 'attend.finish', cls: 'wide' })}
    <p class="mu center note">${esc(t('parents_get_message'))}</p>
  `;
}

/* ---------------------------------------------------------- 4 · students -- */

function studentRow(s) {
  const due = Number(s.amount_due);
  return card(
    `<div class="row">${avatar(s.name)}
      <div class="g"><b>${esc(s.name)}</b>${s.status === 'pending' ? ` ${pill(t('new_signup'), 't')}` : ''}
      ${muted(`${t('grade')} ${s.grade ?? '–'} · ${s.subject || (s.wanted_subjects || []).join(', ') || '—'}`)}</div>
      ${due > 0 ? pill(R.money(due), 'p') : s.status === 'pending' ? pill('—') : pill(t('paid'), 'g')}</div>`,
    { act: 'student.open', arg: s.id, cls: 'tap' },
  );
}

export function studentList() {
  const q = S.search.trim().toLowerCase();
  return students()
    .filter((s) =>
      q
        ? `${s.name} ${s.subject || ''} ${(s.wanted_subjects || []).join(' ')} ${s.area || ''} ${s.school || ''}`
            .toLowerCase()
            .includes(q)
        : true,
    )
    .sort(
      (a, b) =>
        (b.status === 'pending' ? 1 : 0) - (a.status === 'pending' ? 1 : 0) ||
        String(a.name).localeCompare(String(b.name)),
    )
    .map(studentRow)
    .join('');
}

export function studentsView() {
  return `
    <div class="row sp top-row">
      <h1>${esc(t('students'))}</h1>
      ${button(`+ ${t('add')}`, { act: 'student.add', cls: 'sm o' })}
    </div>
    <input id="q" class="search" type="search" placeholder="${esc(t('search_students'))}" value="${esc(S.search)}"
      aria-label="${esc(t('search_students'))}">
    <div id="student-list">${
      studentList() || emptyState(S.search ? t('no_match') : t('no_students_yet'), '🔍')
    }</div>
  `;
}

export function studentDetail() {
  const s = studentById(S.sub.id);
  if (!s) return emptyState('That student is gone.', '🤷');
  const due = Number(s.amount_due);
  const mine = classes().filter((c) => (c.student_ids || []).includes(s.id));
  const marks = (S.data.marksByStudent?.[s.id] || []).slice(-3);
  const hist = s.hist || '';

  return `
    <div class="row top-row">${backButton()}<h1 class="cal-h">${esc(s.name)}</h1></div>

    ${card(
      `<div class="row">${avatar(s.name)}
        <div class="g"><b>${esc(`${t('grade')} ${s.grade ?? '–'} · ${R.attendancePct(hist)}% ${t('attendance').toLowerCase()}`)}</b>
        ${muted(s.parent_phone ? `${s.parent_name ? `${s.parent_name} · ` : ''}${s.parent_phone}` : '—')}</div>
        ${s.parent_phone ? button(t('copy'), { act: 'student.copy', arg: s.id, cls: 'sm gh' }) : ''}</div>
       ${hist ? dots(hist) : ''}`,
    )}

    ${
      s.status === 'pending'
        ? card(
            `${label(t('new_signup'))}
             ${muted(`${s.school || ''} ${s.curriculum ? `· ${s.curriculum}` : ''} ${(s.wanted_subjects || []).join(', ')}`)}
             <label class="fld"><span class="lbl">${esc(t('fee_per_class'))}</span>
               <input id="newfee" type="number" min="0" inputmode="numeric" placeholder="1500"></label>
             ${button(t('confirm_and_send'), { act: 'student.confirm', arg: s.id })}`,
          )
        : card(
            `${label(t('family_code'))}
             ${muted(t('code_hashed'))}
             ${button(t('new_code'), { act: 'student.newcode', arg: s.id, cls: 'o' })}`,
          )
    }

    ${
      mine.length
        ? `${label(t('classes'))}${mine
            .map((c) =>
              card(`<b>${esc(c.title)}</b>${muted(`${(c.days || []).map((d) => R.DAY_SHORT[d]).join(', ')} · ${R.hhmm(c.start_time)}`)}`, {
                cls: 'sess tap',
                style: `border-left-color:${R.subjectColour(c.subject)}`,
                act: 'class.detail',
                arg: c.id,
              }),
            )
            .join('')}`
        : ''
    }

    ${card(
      `${label(t('fees'))}
       ${big(R.money(due), `color:${due > 0 ? 'var(--pt)' : 'var(--gt)'}`)}
       ${muted(
         due > 0
           ? t('classes_days_late', { classes: s.pending_classes, days: s.days_late })
           : t('classes_x_fee', { classes: 0, fee: R.money(s.fee_per_class) }),
       )}
       ${
         due > 0
           ? `<div class="row gap mt-s">${
               s.slip_sent_at
                 ? button(t('confirm_slip'), { act: 'fees.confirmslip', arg: s.id, cls: 'sm gr' }) +
                   button(t('view_slip'), { act: 'fees.viewslip', arg: s.id, cls: 'sm gh' })
                 : button(t('paid'), { act: 'fees.pay', arg: s.id, cls: 'sm gr' }) +
                   button(t('remind'), { act: 'fees.remind', arg: s.id, cls: 'sm o' })
             }</div>`
           : ''
       }`,
    )}

    ${card(
      `${label(t('marks'))}
       ${
         marks.length
           ? marks
               .map(
                 (m) =>
                   `<div class="row sp mt-s"><span>${esc(m.title)}</span><b style="color:${R.markTextColour(
                     R.markPct(m),
                   )}">${Math.round(R.markPct(m))}%</b></div>`,
               )
               .join('')
           : muted(t('no_marks_yet'))
       }`,
    )}

    <div class="row gap">
      ${button(t('add_mark'), { act: 'mark.add', arg: s.id, cls: 'o' })}
      ${button(t('send_report'), { act: 'report.send', arg: s.id })}
    </div>
  `;
}

/* -------------------------------------------------------------- 5 · fees -- */

export function fees() {
  const owing = students()
    .filter((s) => Number(s.amount_due) > 0)
    .sort((a, b) => b.days_late - a.days_late || Number(b.amount_due) - Number(a.amount_due));
  const outstanding = owing.reduce((a, s) => a + Number(s.amount_due), 0);
  const month = S.today.slice(0, 7);
  const collected = Number((S.data.months || []).find((m) => m.month === month)?.collected || 0);
  const pct = collected + outstanding ? (collected / (collected + outstanding)) * 100 : 100;

  return `
    <div class="row sp top-row">
      <h1>${esc(t('fees'))}</h1>
      ${button(t('see_months'), { act: 'nav.months', cls: 'sm o' })}
    </div>
    ${card(
      `${label(t('still_to_collect'))}
       ${big(R.money(outstanding), 'color:var(--pt)')}
       ${bar(pct)}
       ${muted(t('collected', { amount: R.money(collected) }))}`,
    )}
    <b class="h3">${esc(t('who_needs_to_pay'))}</b>
    ${
      owing.length
        ? owing
            .map((s) =>
              card(
                `<div class="row">${avatar(s.name)}
                  <div class="g"><b>${esc(s.name)}</b>${muted(
                    t('classes_days_late', { classes: s.pending_classes, days: s.days_late }),
                  )}</div>
                  <b>${esc(R.money(s.amount_due))}</b></div>
                 <div class="row gap mt-s">${
                   s.slip_sent_at
                     ? button(t('confirm_slip'), { act: 'fees.confirmslip', arg: s.id, cls: 'sm gr' }) +
                       button(t('view_slip'), { act: 'fees.viewslip', arg: s.id, cls: 'sm gh' })
                     : button(t('paid'), { act: 'fees.pay', arg: s.id, cls: 'sm gr' }) +
                       button(t('remind'), { act: 'fees.remind', arg: s.id, cls: 'sm o' })
                 }</div>
                 ${s.last_reminded_at ? muted(`${t('remind')}: ${s.last_reminded_at.slice(0, 10)}`) : ''}`,
              ),
            )
            .join('')
        : emptyState(t('everyone_paid'), '🎉')
    }
  `;
}

export function feeMonths() {
  const rows = (S.data.months || []).slice(-6).map((m) => ({
    label: m.month.slice(5),
    a: Number(m.collected),
    b: Math.max(0, Number(m.charged) - Number(m.collected)),
  }));
  return `
    <div class="row top-row">${backButton()}<h1>${esc(t('see_months'))}</h1></div>
    ${card(
      rows.length
        ? `${stackChart(rows)}<p class="legend"><span><i style="background:var(--green)"></i>${esc(
            t('paid'),
          )}</span><span><i style="background:var(--pink)"></i>${esc(t('still_to_collect'))}</span></p>`
        : muted(t('no_marks_yet')),
    )}
    ${(S.data.months || [])
      .slice()
      .reverse()
      .map((m) =>
        card(
          `<div class="row sp"><b>${esc(m.month)}</b>
            <span class="row gap-s"><b style="color:var(--gt)">${esc(R.money(m.collected))}</b>
            <span class="mu">/ ${esc(R.money(m.charged))}</span></span></div>`,
        ),
      )
      .join('')}
  `;
}

/* --------------------------------------------------------- 6 · dashboard -- */

export function dashboard() {
  const { mode, date } = S.dash;
  const sum = R.incomeSummary(S.data, mode, date, S.today);
  const labels =
    mode === 'week'
      ? R.DAY_SHORT
      : mode === 'month'
        ? sum.dates.map((d) => (Number(d.slice(8)) % 7 === 1 ? d.slice(8) : ''))
        : [R.DAY_SHORT[R.weekday(date)]];
  const highlight = sum.dates.indexOf(S.today);
  const owed = students().reduce((a, s) => a + Number(s.amount_due), 0);

  return `
    <div class="row top-row">${backButton()}<h1>${esc(t('dashboard'))}</h1></div>
    ${segmented(
      [
        { value: 'day', label: t('day') },
        { value: 'week', label: t('week') },
        { value: 'month', label: t('month') },
      ],
      mode,
      'dash.mode',
    )}
    ${card(
      `${label(t('earned_this', { range: t(mode) }))}
       ${big(R.money(sum.earned), 'color:var(--gt)')}
       ${muted(t('more_to_teach', { amount: R.money(sum.planned) }))}
       ${barChart(
         sum.perDay.map((d) => d.earned + d.planned),
         {
           colours: sum.perDay.map((d) => (d.earned ? 'var(--green)' : d.planned ? 'var(--card2)' : 'var(--card2)')),
           labels,
           highlight,
         },
       )}`,
    )}
    ${tiles([
      { label: t('classes'), value: `${sum.classesDone}/${sum.classesTotal}` },
      { label: t('hours_taught'), value: String(Math.round(sum.hours * 10) / 10) },
      { label: t('attendance'), value: `${sum.attendancePct}%` },
    ])}
    ${card(
      `<div class="row sp">${label(t('not_paid_yet'))}${button(t('see_who'), {
        act: 'nav.tab',
        arg: 'fees',
        cls: 'sm o',
      })}</div>${big(R.money(owed), 'color:var(--pt)')}`,
    )}
    <b class="h3">${esc(t('by_class'))}</b>
    ${
      sum.byClass.length
        ? sum.byClass
            .map((row) =>
              card(
                `<div class="row sp"><div class="g"><b>${esc(row.cls.title)}</b>${muted(
                  t('sessions_attendance', {
                    n: row.sessions,
                    pct: row.seats ? Math.round((row.present / row.seats) * 100) : 0,
                  }),
                )}</div><b style="color:var(--gt)">${esc(R.money(row.income))}</b></div>`,
                {
                  cls: 'sess tap',
                  style: `border-left-color:${R.subjectColour(row.cls.subject)}`,
                  act: 'class.detail',
                  arg: row.cls.id,
                },
              ),
            )
            .join('')
        : emptyState(t('no_classes_day'), '📊')
    }
  `;
}

/* -------------------------------------------------------- 7 · earn more -- */

export function earn() {
  const papers = S.data.papers || [];
  const revenue = papers.reduce((a, p) => a + Number(p.revenue), 0);
  const cost = papers.reduce((a, p) => a + Number(p.cost), 0);

  return `
    <div class="row sp top-row">
      <div class="row">${backButton()}<h1>${esc(t('earn_more'))}</h1></div>
      ${button(`+ ${t('add')}`, { act: 'paper.add', cls: 'sm o' })}
    </div>
    ${card(
      `${label(t('test_papers'))}
       ${big(R.money(revenue - cost), `color:${revenue - cost >= 0 ? 'var(--gt)' : 'var(--pt)'}`)}
       <div class="row gap mt-s">
         ${card(`${label(t('sold'))}${big(R.money(revenue))}`, { cls: 'mini' })}
         ${card(`${label(t('bought'))}${big(R.money(cost))}`, { cls: 'mini' })}
       </div>`,
    )}
    ${papers
      .map((p) =>
        card(
          `<div class="row sp"><div class="g"><b>${esc(p.name)}</b>${muted(
            `${R.money(p.price)} · ${p.sold} ${t('sold').toLowerCase()}`,
          )}</div></div>
           <div class="row gap mt-s">
             ${button(t('mark_one_sold'), { act: 'paper.sell', arg: p.id, cls: 'sm gh' })}
             ${button(t('send_to_parent'), { act: 'paper.send', arg: p.id, cls: 'sm o' })}
           </div>`,
        ),
      )
      .join('')}
    ${papers.length ? '' : emptyState(t('no_papers_yet'), '📄')}
    ${card(`${label('💡')}${muted(t('paper_tip'))}`)}
  `;
}

/* ------------------------------------------------------------- registry -- */

export const TABS = [
  { key: 'today', label: 'today', glyph: '◉' },
  { key: 'classes', label: 'classes', glyph: '▦' },
  { key: 'students', label: 'students', glyph: '☺' },
  { key: 'fees', label: 'fees', glyph: '৳' },
];

export const VIEWS = { today, classes: calendar, students: studentsView, fees };

export const SUBS = {
  dashboard,
  earn,
  allclasses: allClasses,
  class: classDetail,
  attendance,
  student: studentDetail,
  months: feeMonths,
};

export const ACTIONS = FORM_ACTIONS;

/** Hooks that need the real DOM: live search, and scrolling to "now". */
export function after(ctx) {
  const search = document.getElementById('q');
  if (search) {
    search.oninput = (e) => {
      S.search = e.target.value;
      const list = document.getElementById('student-list');
      if (list) {
        list.innerHTML =
          studentList() || emptyState(S.search ? t('no_match') : t('no_students_yet'), '🔍');
      }
    };
  }

  if (S.tab === 'classes' && !S.sub && S.cal.mode !== 'month' && S.cal.date === S.today) {
    const line = document.querySelector('.now');
    if (line) line.scrollIntoView({ block: 'center' });
  }
  void ctx;
}
