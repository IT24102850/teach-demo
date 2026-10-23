/**
 * Every teacher action: navigation, the bottom sheets, and the writes.
 *
 * Writes go to /api and then reload the teacher's data, so what is on screen
 * is what is in the database - never an optimistic guess that could drift
 * from the server's own calculation. The one thing that *is* optimistic is
 * the feedback: a button shows "Saving…" the moment it is pressed and cannot
 * be pressed twice (improvement plan points 2 and 7).
 */

import { api } from '../api.js';
import { t } from '../i18n.js';
import * as R from '../rules.js';
import {
  S,
  classById,
  classes,
  goBack,
  goSub,
  goTab,
  savePrefs,
  applyTheme,
  studentById,
  students,
  teacherName,
} from '../state.js';
import { celebration } from './income.js';
import {
  actionButton,
  bubble,
  button,
  card,
  checkbox,
  chip,
  closeSheet,
  esc,
  field,
  label,
  muted,
  openSheet,
  pill,
  receipt,
  segmented,
  selectField,
  sheetActions,
  sheetTitle,
  telField,
  telValue,
  toast,
  centerWheels,
  wheel,
  wireTelFields,
  wireWheels,
} from '../ui.js';

const val = (id) => document.getElementById(id)?.value ?? '';
const numVal = (id) => Number(val(id)) || 0;

/* =========================================================================
   Point 12 and 13: the New class sheet.
   ========================================================================= */

/**
 * The draft class, kept while the sheet is open.
 *
 * The sheet redraws itself whenever a chip is tapped, so `capture()` reads
 * every box back into here first - otherwise a half-typed institute name
 * would vanish the moment the teacher picked a day.
 */
const classForm = {
  id: null, // set when editing an existing class
  kind: 'individual',
  subject: 'Maths',
  curriculum: 'Local',
  grade: '',
  students: [],
  venue_type: 'area',
  venue_name: '',
  area: '',
  repeat: 'weekly',
  days: [],
  once_date: '',
  start_time: '16:00',
  duration_hours: 1.5,
  allowClash: false,
  /* Point 9: { id, date } when this one-off replaces one day of a repeat. */
  replaces: null,
};

function resetClassForm(over = {}) {
  Object.assign(classForm, {
    id: null,
    kind: 'individual',
    subject: S.teacher?.subjects?.[0] || 'Maths',
    curriculum: S.teacher?.curricula?.[0] || 'Local',
    grade: '',
    students: [],
    venue_type: 'area',
    venue_name: '',
    area: '',
    repeat: 'weekly',
    days: [],
    once_date: '',
    start_time: '16:00',
    duration_hours: 1.5,
    allowClash: false,
    replaces: null,
    ...over,
  });
}

/** Read whatever is on the sheet back into the draft before redrawing it. */
function captureClassForm() {
  const read = (id) => document.getElementById(id);
  if (read('c-grade')) classForm.grade = read('c-grade').value;
  if (read('c-area')) classForm.area = read('c-area').value;
  if (read('c-venue')) classForm.venue_name = read('c-venue').value;
  if (read('c-date')) classForm.once_date = read('c-date').value;
  const picked = read('c-student');
  if (picked) classForm.students = picked.value ? [picked.value] : [];
}

/** The draft in the shape the rules and the API expect. */
const classDraft = () => ({
  // When this replaces one day of a repeating class, the class it replaces is
  // the one it may legitimately overlap, so it is not counted as a clash.
  id: classForm.id || classForm.replaces?.id || null,
  kind: classForm.kind,
  student_ids: classForm.students,
  venue_type: classForm.kind === 'individual' ? 'area' : classForm.venue_type,
  venue_name: classForm.venue_name,
  area:
    classForm.kind === 'group' && classForm.venue_type === 'own_place'
      ? S.teacher?.own_place_area || classForm.area
      : classForm.area,
  days: classForm.repeat === 'weekly' ? classForm.days : [],
  once_date: classForm.repeat === 'once' ? classForm.once_date || S.cal.date : null,
  start_date: S.today,
  start_time: classForm.start_time,
  duration_hours: Number(classForm.duration_hours) || 0,
});

/** "Wed, Thu · 4:00 PM – 6:30 PM", the line on the Time button. */
function timeSummary() {
  const draft = classDraft();
  const when = draft.once_date
    ? R.dateTitle(draft.once_date, S.lang)
    : draft.days.length
      ? draft.days
          .slice()
          .sort((a, b) => a - b)
          .map((d) => R.dayShort(d, S.lang))
          .join(', ')
      : t('days');
  return `${when} · ${R.slotLabel(draft.start_time, draft.duration_hours)}`;
}

function classSheet() {
  const subjects = S.teacher?.subjects?.length ? S.teacher.subjects : ['Maths', 'Science', 'English'];
  const curricula = S.teacher?.curricula?.length
    ? S.teacher.curricula
    : ['Local', 'Cambridge', 'Edexcel'];
  const pickable = students().filter((s) => s.status === 'active');
  const group = classForm.kind === 'group';
  const ownPlace = S.teacher?.own_place_name || t('my_own_place');
  const ownArea = S.teacher?.own_place_area || '';

  openSheet(`
    ${sheetTitle(classForm.id ? t('edit_class') : t('new_class'))}

    <!-- Point 12: the first question is which kind of class this is. -->
    ${segmented(
      [
        { value: 'individual', label: t('individual') },
        { value: 'group', label: t('group') },
      ],
      classForm.kind,
      'class.kind',
    )}

    ${label(group ? t('students') : t('student'))}
    ${
      !pickable.length
        ? muted(t('no_students_yet'))
        : group
          ? `<div class="picks">${pickable
              .map(
                (s) =>
                  `<button type="button" class="pick${
                    classForm.students.includes(s.id) ? ' on' : ''
                  }" data-a="class.student" data-i="${esc(s.id)}" role="checkbox"
                    aria-checked="${classForm.students.includes(s.id)}">
                    <span>${esc(s.name)}</span><em>${esc(`${t('grade')} ${s.grade ?? '–'}`)}</em></button>`,
              )
              .join('')}</div>
             ${muted(
               classForm.students.length
                 ? `${classForm.students.length} · ${classForm.students
                     .map((id) => studentById(id)?.call_name || studentById(id)?.name || '')
                     .filter(Boolean)
                     .join(', ')}`
                 : t('pick_students_group'),
             )}`
          : selectField(
              'c-student',
              t('student'),
              [{ value: '', label: `— ${t('pick_one_student')} —` }].concat(
                pickable.map((s) => ({
                  value: s.id,
                  label: `${s.name} · ${t('grade')} ${s.grade ?? '–'}`,
                })),
              ),
              classForm.students[0] || '',
            )
    }

    ${label(t('subject'))}
    <div class="chips">${subjects
      .map((x) => chip(x, { act: 'class.subject', arg: x, on: classForm.subject === x }))
      .join('')}</div>

    ${label(t('curriculum'))}
    <div class="chips">${curricula
      .map((c) => chip(c, { act: 'class.curriculum', arg: c, on: classForm.curriculum === c }))
      .join('')}</div>

    ${
      group
        ? `<!-- Point 12: a group class is at an institute, or at the teacher's
                own place, which is typed once in Settings. -->
           ${label(t('where_is_class'))}
           <div class="chips">
             ${chip(t('institute'), {
               act: 'class.venue',
               arg: 'institute',
               on: classForm.venue_type === 'institute',
             })}
             ${chip(t('my_own_place'), {
               act: 'class.venue',
               arg: 'own_place',
               on: classForm.venue_type === 'own_place',
             })}
           </div>
           ${
             classForm.venue_type === 'own_place'
               ? `${label(t('place'))}
                  ${card(`<b>🏠 ${esc([ownPlace, ownArea].filter(Boolean).join(' · '))}</b>`)}
                  <p class="fld-hint">${esc(t('own_place_blurb'))}</p>
                  ${
                    ownArea
                      ? ''
                      : field('c-area', t('area'), { value: classForm.area, required: true })
                  }`
               : `${field('c-venue', t('institute_name'), {
                   value: classForm.venue_name,
                   required: true,
                   placeholder: 'Bright Minds Institute',
                 })}
                  ${field('c-area', t('area'), {
                    value: classForm.area,
                    required: true,
                    placeholder: 'Nugegoda',
                  })}`
           }`
        : `${field('c-area', t('location_area'), {
             value: classForm.area,
             required: true,
             placeholder: 'Nugegoda',
           })}
           <p class="fld-hint">${esc(t('from_student_area'))}</p>`
    }

    <div class="row gap">
      ${field('c-grade', t('grade'), { type: 'number', min: 1, max: 13, value: classForm.grade })}
    </div>

    ${label(t('repeat'))}
    ${segmented(
      [
        { value: 'weekly', label: t('every_week') },
        { value: 'once', label: t('just_once') },
      ],
      classForm.repeat,
      'class.repeat',
    )}
    ${
      classForm.repeat === 'weekly'
        ? `${label(t('days'))}<div class="chips">${R.DAY_SHORT.map((d, i) =>
            chip(R.dayShort(i, S.lang), {
              act: 'class.day',
              arg: String(i),
              on: classForm.days.includes(i),
            }),
          ).join('')}</div>`
        : field('c-date', t('date'), {
            type: 'date',
            value: classForm.once_date || S.cal.date,
          })
    }

    <!-- Point 13: the time is picked on its own sheet, never typed. -->
    ${label(t('choose_time'))}
    <button type="button" class="slotline" data-a="time.open" style="width:100%;cursor:pointer">
      <b>${esc(timeSummary())}</b><span class="mu" aria-hidden="true">›</span>
    </button>

    ${sheetActions('class.save', t('save'))}
  `);
}

/* --------------------------------------- point 13 · the time slot sheet -- */

/**
 * Start and end, each on its own wheels - the iPhone alarm picker.
 *
 * The two times live here while the sheet is open, rather than as a start and
 * a length on classForm, so an end before the start can sit on screen and be
 * fixed instead of turning into a negative length.
 */
const timeForm = { start: '16:00', end: '17:30' };

const timeSpan = () => R.spanMinutes(timeForm.start, timeForm.end);

/** The class as it would be with the wheels where they are now. */
const wheelDraft = () => ({
  ...classDraft(),
  start_time: timeForm.start,
  duration_hours: Math.max(0, timeSpan()) / 60,
});

/** Which row a wheel should show: "start:h" -> 4, "end:p" -> "PM". */
function wheelValue(which, part) {
  const p = R.clockParts(timeForm[which]);
  if (part === 'h') return p.h;
  if (part === 'p') return p.pm ? 'PM' : 'AM';
  // An older class may start at 4:07; the nearest five is the row lit up.
  return R.WHEEL_MINUTES.reduce((best, m) => (Math.abs(m - p.m) < Math.abs(best - p.m) ? m : best));
}

function clockWheels(which) {
  return `<div class="wheels">
    ${wheel(
      `${which}:h`,
      R.WHEEL_HOURS.map((h) => ({ value: h, label: String(h) })),
      wheelValue(which, 'h'),
      'time.wheel',
      'Hour',
    )}
    ${wheel(
      `${which}:m`,
      R.WHEEL_MINUTES.map((m) => ({ value: m, label: String(m).padStart(2, '0') })),
      wheelValue(which, 'm'),
      'time.wheel',
      'Minute',
    )}
    ${wheel(
      `${which}:p`,
      [
        { value: 'AM', label: 'AM' },
        { value: 'PM', label: 'PM' },
      ],
      wheelValue(which, 'p'),
      'time.wheel',
      'AM / PM',
    )}
  </div>`;
}

/** Everything under the wheels that changes as they turn. */
function timeLive() {
  const span = timeSpan();
  if (span <= 0) {
    return `${card(`<b>⚠ ${esc(t('end_after_start'))}</b>`, { cls: 'warn' })}
      ${button(t('done'), { act: 'time.done', cls: 'wide' })}`;
  }
  const draft = wheelDraft();
  // Shown whether or not it has been accepted, for the same reason as above.
  const clash = R.findClash(classes(), draft);
  const travel = clash ? null : R.travelWarning(classes(), draft);

  return `
    ${label(t('class_runs'))}
    <div class="slotline">
      <b>${esc(R.slotLabel(timeForm.start, span / 60))}</b>
      <span class="pill t">${esc(R.durationLabel(span / 60))}</span>
    </div>
    ${
      clash
        ? card(
            `<b>⚠ ${esc(
              t('clash_with', {
                title: clash.title,
                time: R.slotLabel(clash.start_time, clash.duration_hours),
                day: R.clashDay(draft, clash, S.lang),
              }),
            )}</b>`,
            { cls: 'warn' },
          )
        : travel
          ? card(muted(t('travel_warning', { title: travel.title })), { cls: 'warn' })
          : ''
    }
    ${button(clash && !classForm.allowClash ? t('save_anyway') : t('done'), {
      act: 'time.done',
      cls: clash ? 'd wide' : 'wide',
    })}`;
}

function timeSheet() {
  const draft = classDraft();
  openSheet(`
    ${sheetTitle(
      `${t('choose_time')} · ${
        draft.once_date
          ? R.dateTitle(draft.once_date, S.lang)
          : draft.days.map((d) => R.dayShort(d, S.lang)).join(', ') || t('days')
      }`,
    )}
    ${label(t('start_at'))}
    ${clockWheels('start')}
    ${label(t('end_at'))}
    ${clockWheels('end')}
    <div id="time-live">${timeLive()}</div>
  `);
  wireWheels(document.querySelector('#sheet .sheet-panel'), (arg) => {
    if (setWheel(arg)) refreshTime();
  });
}

/** Open the time sheet on the class's current start and end. */
function openTimeSheet() {
  timeForm.start = R.hhmm(classForm.start_time);
  timeForm.end = R.endTime(classForm.start_time, classForm.duration_hours);
  timeSheet();
}

/** Turn one wheel. Returns false when it already showed that row. */
function setWheel(arg) {
  const [which, part, value] = String(arg).split(':');
  const key = which === 'end' ? 'end' : 'start';
  const parts = R.clockParts(timeForm[key]);
  if (part === 'h') parts.h = Number(value);
  else if (part === 'm') parts.m = Number(value);
  else if (part === 'p') parts.pm = value === 'PM';
  const next = R.fromClockParts(parts);
  if (next === timeForm[key]) return false;

  if (key === 'start') {
    // As a calendar does: moving the start carries the end with it, so the
    // class keeps its length until the end is moved on purpose.
    const span = timeSpan();
    timeForm.start = next;
    if (span > 0) timeForm.end = R.fromMinutes(R.minutesOf(next) + span);
  } else {
    timeForm.end = next;
  }
  classForm.allowClash = false;
  return true;
}

/**
 * Redraw only what the wheels changed. Redrawing the whole sheet would throw
 * away the scroll position of a wheel that is still being flicked.
 */
function refreshTime() {
  const live = document.getElementById('time-live');
  const panel = document.querySelector('#sheet .sheet-panel');
  if (!live || !panel) return timeSheet();
  live.innerHTML = timeLive();
  for (const column of panel.querySelectorAll('.wheel[data-wheel]')) {
    const [which, part] = column.dataset.wheel.split(':');
    const want = `${column.dataset.wheel}:${wheelValue(which, part)}`;
    for (const row of column.querySelectorAll('.wheel-i')) {
      row.classList.toggle('on', row.dataset.i === want);
      row.setAttribute('aria-selected', String(row.dataset.i === want));
    }
  }
  centerWheels(panel);
}

/* =========================================================================
   Add students: fill a class from everyone on the list, many at a time.
   ========================================================================= */

/**
 * The open Add students sheet. `picked` starts as the class's own students,
 * so the sheet manages the whole roster: tick to add, untick to take out.
 */
const rosterForm = { classId: null, grade: 'all', q: '', picked: [] };

/** Everyone who can be put in a class: confirmed students and new sign-ups. */
const rosterPool = () => students().filter((s) => s.status !== 'archived');

function openRoster(classId) {
  const cls = classById(classId);
  if (!cls) return;
  const pool = rosterPool();
  // Start on the class's own grade when anyone is in it - a Grade 10 class
  // opens on the Grade 10 students, which is almost always who is wanted.
  const grade = cls.grade && pool.some((s) => Number(s.grade) === Number(cls.grade)) ? Number(cls.grade) : 'all';
  Object.assign(rosterForm, { classId, grade, q: '', picked: [...(cls.student_ids || [])] });
  rosterSheet();
}

const rosterSingle = () => R.classKind(classById(rosterForm.classId)) === 'individual';

function rosterRows() {
  const shown = R.filterRoster(rosterPool(), rosterForm);
  if (!shown.length) return muted(t('no_match'));
  const enrolled = classById(rosterForm.classId)?.student_ids || [];
  return shown
    .map((s) => {
      const on = rosterForm.picked.includes(s.id);
      return `<button type="button" class="roster-i${on ? ' on' : ''}" role="checkbox" aria-checked="${on}"
        data-a="roster.toggle" data-i="${esc(s.id)}">
        <i class="roster-box" aria-hidden="true">✓</i>
        <span class="g"><b>${esc(s.name)}</b>
          <em>${esc(
            [`${t('grade')} ${s.grade ?? '–'}`, s.subject, enrolled.includes(s.id) ? t('in_class') : '']
              .filter(Boolean)
              .join(' · '),
          )}</em></span>
        ${s.status === 'pending' ? pill(t('new_signup'), 't') : ''}
      </button>`;
    })
    .join('');
}

/** The Select all line and the Save button, which both count the ticks. */
function rosterFoot() {
  const shown = R.filterRoster(rosterPool(), rosterForm);
  const allOn = shown.length > 0 && shown.every((s) => rosterForm.picked.includes(s.id));
  return `
    ${
      rosterSingle() || !shown.length
        ? ''
        : `<button type="button" class="link-btn" data-a="roster.all">${esc(
            allOn ? t('clear_shown', { n: shown.length }) : t('select_shown', { n: shown.length }),
          )}</button>`
    }
    <div class="row gap" style="margin-top:12px">
      ${button(t('cancel'), { act: 'sheet.close', cls: 'o' })}
      ${actionButton(t('save_n_students', { n: rosterForm.picked.length }), { act: 'roster.save' })}
    </div>`;
}

function rosterSheet() {
  const cls = classById(rosterForm.classId);
  if (!cls) return closeSheet();
  const grades = R.gradesOf(rosterPool());

  openSheet(`
    ${sheetTitle(t('add_students'))}
    ${muted(rosterSingle() ? `${cls.title} · ${t('individual_one_student')}` : cls.title)}

    <div class="chips scroll mt-s">
      ${chip(t('all_grades'), { act: 'roster.grade', arg: 'all', on: rosterForm.grade === 'all' })}
      ${grades
        .map((g) =>
          chip(`${t('grade')} ${g}`, { act: 'roster.grade', arg: String(g), on: rosterForm.grade === g }),
        )
        .join('')}
    </div>
    <input id="roster-q" class="search" type="search" placeholder="${esc(t('search_students'))}"
      value="${esc(rosterForm.q)}" aria-label="${esc(t('search_students'))}">

    <div id="roster-list" class="roster">${rosterRows()}</div>
    <div id="roster-foot">${rosterFoot()}</div>
  `);

  const search = document.getElementById('roster-q');
  if (search && !search.dataset.wired) {
    search.dataset.wired = '1';
    search.addEventListener('input', () => {
      rosterForm.q = search.value;
      refreshRoster();
    });
  }
}

/** Redraw the list and the count, leaving the search box and the scroll alone. */
function refreshRoster() {
  const list = document.getElementById('roster-list');
  const foot = document.getElementById('roster-foot');
  if (!list || !foot) return rosterSheet();
  list.innerHTML = rosterRows();
  foot.innerHTML = rosterFoot();
}

/* =========================================================================
   Point 9, phase 2: a class dragged to a new slot.
   ========================================================================= */

/** What the drag proposed, until the teacher confirms or cancels it. */
const moveForm = {
  class_id: null,
  from_date: '',
  to_date: '',
  start_time: '',
  scope: 'day',
  notify: true,
  /* A clash the server reported that this side could not see for itself. */
  clash: null,
  /* The clash currently on screen, so saving knows it was acknowledged. */
  shownClash: null,
  /* The teacher saw it and meant it. */
  allowClash: false,
};

/**
 * The sheet a drag opens.
 *
 * A drag is one gesture and a WhatsApp message cannot be unsent, so nothing
 * is saved and nobody is told until this is confirmed. It shows where the
 * class came from and where it is going, names anything it would now clash
 * with, and lets the teacher decide whether this moves one session or the
 * class itself.
 */
function moveSheet() {
  const cls = classById(moveForm.class_id);
  if (!cls) return closeSheet();

  const repeating = !cls.once_date && (cls.days || []).length > 0;
  const scope = repeating ? moveForm.scope : 'all';
  const draft = R.movedDraft(cls, { ...moveForm, scope });

  // The day it is leaving is about to be cancelled, so the class being moved
  // must not be reported as standing in its own way.
  const existing = classes().map((c) =>
    c.id === cls.id && scope === 'day'
      ? { ...c, skips: [...(c.skips || []), moveForm.from_date] }
      : c,
  );
  /*
   * A known clash is always shown. `allowClash` records that the teacher has
   * seen this one and still means it - hiding the warning the moment they
   * confirm would leave them staring at a button with no idea why it changed.
   */
  const clash = R.findClash(existing, draft) || moveForm.clash;
  moveForm.shownClash = clash || null;
  const inPast = moveForm.to_date < S.today;
  const count = (cls.student_ids || []).length;

  openSheet(`
    ${sheetTitle(t('move_class'))}
    ${muted(cls.title)}

    ${card(
      `<div class="row sp"><span class="mu">${esc(t('move_from'))}</span>
         <b>${esc(R.whenLabel(moveForm.from_date, cls.start_time, S.lang))}</b></div>
       <div class="row sp mt-s"><span class="mu">${esc(t('move_to'))}</span>
         <b style="color:var(--tt)">${esc(
           R.whenLabel(moveForm.to_date, moveForm.start_time, S.lang),
         )}</b></div>
       ${muted(R.durationLabel(cls.duration_hours))}`,
    )}

    ${
      repeating
        ? `${label(t('which_days_edit'))}
           ${segmented(
             [
               { value: 'day', label: t('this_day_only') },
               { value: 'all', label: t('all_days') },
             ],
             scope,
             'class.movescope',
           )}`
        : ''
    }

    ${
      inPast
        ? card(`<b>⚠ ${esc(t('no_past_move'))}</b>`, { cls: 'warn' })
        : clash
          ? card(
              `<b>⚠ ${esc(
                t('clash_with', {
                  title: clash.title,
                  time: R.slotLabel(clash.start_time, clash.duration_hours),
                  day: R.clashDay(draft, clash, S.lang),
                }),
              )}</b>`,
              { cls: 'warn' },
            )
          : ''
    }

    ${checkbox(t('tell_parents_wa', { n: count }), { act: 'class.movenotify', on: moveForm.notify })}

    ${actionButton(clash && !moveForm.allowClash ? t('save_anyway') : t('move_class'), {
      act: 'class.movesave',
      cls: clash ? 'd wide' : 'wide',
      disabled: inPast,
    })}
    ${button(t('cancel'), { act: 'sheet.close', cls: 'o wide' })}
  `);
}

/* =========================================================================
   Point 11: recording a payment.
   ========================================================================= */

const payForm = { mode: 'full', amount: '', method: 'Cash', date: '', receipt: true };
let undoTimer = null;

/* Which student the sheet is for, so tapping a chip can redraw it with the
   amount and the date the teacher had already typed. */
let payStudentId = null;

/** Keep what is typed, then draw the sheet again. */
function redrawPaySheet() {
  payForm.amount = val('p-amount') || payForm.amount;
  payForm.date = val('p-date') || payForm.date;
  const student = studentById(payStudentId);
  if (student) paySheet(student);
}

function paySheet(student) {
  const due = Number(student.amount_due);
  const amount = payForm.mode === 'full' ? due : Number(payForm.amount) || 0;

  openSheet(`
    ${sheetTitle(t('record_payment'))}
    ${muted(
      t('owes_classes', {
        name: student.name,
        classes: student.pending_classes,
        fee: R.money(student.fee_per_class),
      }),
    )}

    <div class="chips">
      ${chip(t('full_amount', { amount: R.money(due) }), {
        act: 'fees.mode',
        arg: 'full',
        on: payForm.mode === 'full',
      })}
      ${chip(t('part_payment'), { act: 'fees.mode', arg: 'part', on: payForm.mode === 'part' })}
    </div>
    ${
      payForm.mode === 'part'
        ? field('p-amount', t('amount'), {
            type: 'number',
            min: 1,
            max: due,
            inputmode: 'numeric',
            value: payForm.amount,
            placeholder: String(Math.round(due)),
          })
        : ''
    }

    ${label(t('method'))}
    <div class="chips">${['Cash', 'Bank transfer', 'Online']
      .map((m) =>
        chip(t(m === 'Cash' ? 'cash' : m === 'Online' ? 'online' : 'bank_transfer'), {
          act: 'fees.method',
          arg: m,
          on: payForm.method === m,
        }),
      )
      .join('')}</div>

    ${field('p-date', t('date'), { type: 'date', value: payForm.date || S.today })}

    ${checkbox(t('send_receipt'), { act: 'fees.receipt', on: payForm.receipt })}

    ${actionButton(t('confirm_payment', { amount: R.money(amount) }), {
      act: 'fees.savepay',
      arg: student.id,
      cls: 'gr wide',
      disabled: !(amount > 0),
    })}
    ${button(t('cancel'), { act: 'sheet.close', cls: 'o wide' })}
  `);
}

/** The result screen, with ten seconds of Undo (point 11). */
function paidSheet(student, result, secondsLeft = 10) {
  openSheet(
    `
    <div class="ok-screen" style="padding:16px 0">
      <div class="ok-tick" aria-hidden="true">✓</div>
      <h1>${esc(t('payment_recorded'))}</h1>
      <p class="mu">${esc(
        result.full
          ? t('fully_paid', { name: student.call_name || student.name })
          : `${t('still_to_pay')}: ${R.money(result.balance)}`,
      )}</p>
    </div>
    ${receipt([
      [t('receipt_label'), result.receipt],
      [t('amount'), R.money(result.amount)],
      [t('method'), payForm.method],
      [t('balance'), R.money(result.balance)],
    ])}
    ${
      result.status === 'sent'
        ? `<p class="fld-note ok">✓✓ ${esc(t('receipt_sent'))}</p>`
        : result.link
          ? `<a class="btn o wide" href="${esc(result.link)}" target="_blank" rel="noopener">${esc(
              t('send_on_whatsapp'),
            )}</a>`
          : ''
    }
    <div class="row gap mt">
      ${button(t('undo_in', { n: secondsLeft }), {
        act: 'fees.undo',
        arg: result.payment_id,
        cls: 'o',
      })}
      ${button(t('done'), { act: 'fees.paiddone' })}
    </div>`,
    { onClose: stopUndoTimer },
  );

  stopUndoTimer();
  let left = secondsLeft;
  undoTimer = setInterval(() => {
    left -= 1;
    const node = document.querySelector('[data-a="fees.undo"]');
    if (!node) return stopUndoTimer();
    if (left <= 0) {
      // After ten seconds Undo moves to the student's payment history, so a
      // mistake is still fixable - just not with one tap.
      stopUndoTimer();
      node.remove();
      return;
    }
    node.textContent = t('undo_in', { n: left });
  }, 1000);
}

function stopUndoTimer() {
  if (undoTimer) clearInterval(undoTimer);
  undoTimer = null;
}

/* ------------------------------------------------------- send feedback --- */

/**
 * Show what happened to a message. With the WhatsApp Cloud API configured it
 * is already sent; without it the server hands back a wa.me link and the
 * teacher taps once to send it from their own WhatsApp.
 */
function showSendResult(result, { sentMessage } = {}) {
  if (result?.status === 'sent') {
    closeSheet();
    toast(sentMessage || t('reminder_sent', { name: '' }).trim());
    return;
  }
  if (result?.link) {
    openSheet(`
      ${sheetTitle(t('send_on_whatsapp'))}
      ${muted(t('wa_ready'))}
      <a class="btn wide mt" href="${esc(result.link)}" target="_blank" rel="noopener" data-a="sheet.close">${esc(
        t('send_on_whatsapp'),
      )}</a>
      ${button(t('done'), { act: 'sheet.close', cls: 'o wide' })}
    `);
    return;
  }
  closeSheet();
  if (result?.status === 'failed') toast(t('wa_failed'), 'bad');
  else toast(sentMessage || t('saved'));
}

/* ------------------------------------------------------------ plumbing --- */

async function reload(ctx, { quiet = false } = {}) {
  if (!quiet) S.busy = true;
  try {
    S.data = await api.teacherBootstrap();
    S.today = S.data.today || R.todayLocal();
    S.teacher = S.data.teacher;
    indexMarks();
  } finally {
    S.busy = false;
    ctx.render();
  }
}

/** Group the teacher's marks by student, for the student detail screen. */
export function indexMarks() {
  const byStudent = {};
  for (const m of S.data?.marks || []) {
    (byStudent[m.student_id] = byStudent[m.student_id] || []).push(m);
  }
  if (S.data) S.data.marksByStudent = byStudent;
}

/** The scheduled start of a session, as an ISO timestamp in local time. */
function scheduledStart(cls, date) {
  const [h, m] = R.hhmm(cls.start_time).split(':').map(Number);
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m, 0, 0).toISOString();
}

export const ACTIONS = {
  /* ---- navigation ---- */
  'nav.tab': (tab, _el, ctx) => {
    goTab(tab);
    ctx.render();
  },
  'nav.dashboard': (_a, _el, ctx) => {
    goSub('dashboard');
    ctx.render();
  },
  'nav.earn': (_a, _el, ctx) => {
    goSub('earn');
    ctx.render();
  },
  'nav.allclasses': (_a, _el, ctx) => {
    goSub('allclasses');
    ctx.render();
  },
  'nav.months': (_a, _el, ctx) => {
    goSub('months');
    ctx.render();
  },

  /* ---- calendar (point 9) ---- */
  'cal.mode': (mode, _el, ctx) => {
    S.cal.mode = mode;
    ctx.render();
  },
  'cal.day': (date, _el, ctx) => {
    S.cal.date = date;
    S.cal.mode = 'day';
    goTab('classes');
    ctx.render();
  },
  /** In the month view this selects the day whose agenda is shown underneath. */
  'cal.pick': async (date, _el, ctx) => {
    S.cal.date = date;
    ctx.render();
    await ensureSessionWindow(ctx);
  },
  'cal.step': async (step, _el, ctx) => {
    const n = Number(step);
    S.cal.date =
      S.cal.mode === 'month'
        ? R.addMonths(S.cal.date, n)
        : R.addDays(S.cal.date, n * (S.cal.mode === 'week' ? 7 : 1));
    ctx.render();
    await ensureSessionWindow(ctx);
  },
  /** Point 9: the month title opens a small picker to jump anywhere. */
  'cal.jump': () => {
    openSheet(`
      ${sheetTitle(t('jump_to_month'))}
      ${field('cal-jump', t('date'), { type: 'date', value: S.cal.date })}
      ${sheetActions('cal.jumpto', t('open'))}
    `);
  },
  'cal.jumpto': async (_a, _el, ctx) => {
    const date = val('cal-jump');
    if (!date) return closeSheet();
    S.cal.date = date;
    closeSheet();
    ctx.render();
    await ensureSessionWindow(ctx);
  },

  /* ---- the class sheet (points 12 and 13) ---- */
  'class.add': () => {
    resetClassForm({ once_date: S.cal.date });
    classSheet();
  },
  /** Point 9: tapping an empty slot starts a class already set to that time. */
  'class.quick': (arg) => {
    const [date, time] = String(arg).split('|');
    resetClassForm({
      repeat: 'once',
      once_date: date,
      start_time: time,
      days: [R.weekday(date)],
    });
    classSheet();
  },
  'class.kind': (kind) => {
    captureClassForm();
    classForm.kind = kind;
    // Point 12: an individual class has exactly one student, so a longer list
    // is cut back rather than silently kept and then refused on save.
    if (kind === 'individual') {
      classForm.students = classForm.students.slice(0, 1);
      classForm.venue_type = 'area';
    } else if (classForm.venue_type === 'area') {
      classForm.venue_type = 'institute';
    }
    classForm.allowClash = false;
    classSheet();
  },
  'class.venue': (type) => {
    captureClassForm();
    classForm.venue_type = type;
    classSheet();
  },
  'class.subject': (subject) => {
    captureClassForm();
    classForm.subject = subject;
    classSheet();
  },
  'class.curriculum': (curriculum) => {
    captureClassForm();
    classForm.curriculum = curriculum;
    classSheet();
  },
  'class.repeat': (mode) => {
    captureClassForm();
    classForm.repeat = mode;
    classForm.allowClash = false;
    classSheet();
  },
  'class.day': (index) => {
    captureClassForm();
    const i = Number(index);
    const at = classForm.days.indexOf(i);
    if (at >= 0) classForm.days.splice(at, 1);
    else classForm.days.push(i);
    classForm.allowClash = false;
    classSheet();
  },
  'class.student': (id) => {
    captureClassForm();
    const at = classForm.students.indexOf(id);
    if (at >= 0) classForm.students.splice(at, 1);
    else classForm.students.push(id);
    // The area follows the student unless the teacher typed one themselves.
    if (!classForm.area && classForm.students.length === 1) {
      classForm.area = studentById(classForm.students[0])?.area || '';
    }
    classSheet();
  },

  /* ---- the time sheet (point 13) ---- */
  'time.open': () => {
    captureClassForm();
    openTimeSheet();
  },
  /** A tapped row on a wheel; a flicked one arrives through wireWheels. */
  'time.wheel': (arg) => {
    if (setWheel(arg)) refreshTime();
  },
  'time.done': () => {
    const span = timeSpan();
    if (span <= 0) return toast(t('end_after_start'), 'bad');
    classForm.start_time = timeForm.start;
    classForm.duration_hours = span / 60;
    // "Save anyway" on a clash: the teacher has seen the warning and meant it.
    if (R.findClash(classes(), classDraft())) classForm.allowClash = true;
    classSheet();
  },

  'class.save': async (_a, _el, ctx) => {
    captureClassForm();
    const draft = classDraft();

    const problem = R.classDraftError(draft);
    if (problem) return toast(t(problem), 'bad');
    if (R.slotInPast(draft, S.today, new Date().getHours() * 60 + new Date().getMinutes())) {
      return toast(t('no_past_class'), 'bad');
    }

    const payload = {
      ...draft,
      subject: classForm.subject,
      curriculum: classForm.curriculum,
      grade: Number(classForm.grade) || undefined,
      allow_clash: classForm.allowClash,
    };

    // The one-off that replaces a day carries no id of its own.
    if (!classForm.id) payload.id = null;

    try {
      const result = classForm.id
        ? await api.teacherDo('class.update', { ...payload, class_id: classForm.id })
        : await api.teacherDo('class.create', payload);

      // Point 9: "This day only" also cancels the repeating class that day,
      // so the student is not booked twice.
      if (classForm.replaces) {
        await api.teacherDo('class.skip', {
          class_id: classForm.replaces.id,
          date: classForm.replaces.date,
          reason: 'Moved',
        });
      }
      closeSheet();
      await reload(ctx);
      S.cal.date = draft.once_date || firstDateOf(result.class_id || classForm.id) || S.today;
      S.cal.mode = 'day';
      goTab('classes');
      // A group class saved empty is the "create it first" path: go straight
      // to the class and open Add students, which is the next thing to do.
      if (!classForm.id && result.class_id && !draft.student_ids.length) {
        goSub('class', { id: result.class_id });
        ctx.render();
        openRoster(result.class_id);
        return;
      }
      ctx.render();
      toast(classForm.id ? t('saved') : t('class_added', { title: result.title || '' }));
    } catch (err) {
      // Point 13: a clash comes back as 409 and the sheet offers Save anyway.
      if (err.status === 409) {
        classForm.allowClash = true;
        openTimeSheet();
        return;
      }
      toast(err.message, 'bad');
    }
  },

  'class.detail': (id, _el, ctx) => {
    goSub('class', { id });
    ctx.render();
  },
  'class.open': (key, _el, ctx) => {
    goSub('class', { id: String(key).split('|')[0] });
    ctx.render();
  },
  /**
   * Point 9: Edit on a class. A repeating class is asked about first -
   * changing every Wednesday is a different thing from moving one of them.
   */
  'class.edit': (arg) => {
    const [id, date] = String(arg).split('|');
    const cls = classById(id);
    if (!cls) return;
    if (cls.once_date) return openEditForm(cls, null);
    openSheet(`
      ${sheetTitle(t('which_days_edit'))}
      ${muted(cls.title)}
      ${field('edit-date', t('date'), { type: 'date', value: date || S.cal.date })}
      ${button(t('this_day_only'), { act: 'class.editscope', arg: `${cls.id}|day`, cls: 'o wide' })}
      ${button(t('all_days'), { act: 'class.editscope', arg: `${cls.id}|all`, cls: 'wide' })}
      ${button(t('cancel'), { act: 'sheet.close', cls: 'gh wide' })}
    `);
  },
  'class.editscope': (arg) => {
    const [id, scope] = String(arg).split('|');
    const cls = classById(id);
    if (!cls) return;
    openEditForm(cls, scope === 'day' ? val('edit-date') || S.cal.date : null);
  },
  /** A drag finished: show what it would do, before anything is saved. */
  'class.moved': (payload) => {
    let dropped;
    try {
      dropped = JSON.parse(payload);
    } catch {
      return;
    }
    Object.assign(moveForm, {
      ...dropped,
      // Dragging one block most naturally moves that one session; the teacher
      // can widen it to the whole class in the sheet.
      scope: 'day',
      notify: true,
      clash: null,
      shownClash: null,
      allowClash: false,
    });
    moveSheet();
  },
  'class.movescope': (scope) => {
    moveForm.scope = scope === 'all' ? 'all' : 'day';
    // A different scope is a different move, so an old clash no longer applies.
    moveForm.clash = null;
    moveForm.allowClash = false;
    moveSheet();
  },
  'class.movenotify': () => {
    moveForm.notify = !moveForm.notify;
    moveSheet();
  },
  'class.movesave': async (_a, _el, ctx) => {
    const cls = classById(moveForm.class_id);
    if (!cls) return closeSheet();
    const repeating = !cls.once_date && (cls.days || []).length > 0;

    try {
      const result = await api.teacherDo('class.move', {
        class_id: moveForm.class_id,
        from_date: moveForm.from_date,
        to_date: moveForm.to_date,
        start_time: moveForm.start_time,
        scope: repeating ? moveForm.scope : 'all',
        notify: moveForm.notify,
        // Pressing the button while a clash is on screen is the confirmation.
        allow_clash: Boolean(moveForm.shownClash),
      });
      closeSheet();
      S.cal.date = moveForm.to_date;
      await reload(ctx);
      toast(
        result.told
          ? t('class_moved_told', { n: result.told })
          : t('class_moved'),
      );
      // Without the WhatsApp Cloud API the server hands back wa.me links and
      // the teacher sends them from their own WhatsApp, one tap each.
      const manual = (result.messages || []).filter((m) => m.link);
      if (manual.length) openWhatsAppQueue(manual);
    } catch (err) {
      if (err.status === 409) {
        // Point 13: the server saw a clash this side could not. Show it, and
        // let the next press be the "Save anyway".
        moveForm.clash = err.data?.clash || { title: '', start_time: '' };
        moveSheet();
        return;
      }
      toast(err.message, 'bad');
    }
  },

  'class.remove': async (id, _el, ctx) => {
    if (!S.sub.sure) {
      S.sub.sure = true;
      ctx.render();
      return;
    }
    try {
      await api.teacherDo('class.delete', { class_id: id });
      goBack();
      await reload(ctx);
      toast(t('class_removed'));
    } catch (err) {
      toast(err.message, 'bad');
    }
  },
  'class.skip': (id) => {
    openSheet(`
      ${sheetTitle(t('skip_this_day'))}
      ${field('skip-date', t('date'), { type: 'date', value: S.cal.date })}
      ${sheetActions('class.skipsave', t('save'), id)}
    `);
  },
  'class.skipsave': async (id, _el, ctx) => {
    const date = val('skip-date');
    if (!date) return toast(t('pick_days'), 'bad');
    try {
      await api.teacherDo('class.skip', { class_id: id, date });
      closeSheet();
      await reload(ctx);
      toast(t('day_cancelled'));
    } catch (err) {
      toast(err.message, 'bad');
    }
  },
  'class.unskip': async (arg, _el, ctx) => {
    const [id, date] = String(arg).split('|');
    await api.teacherDo('class.unskip', { class_id: id, date });
    await reload(ctx);
  },

  /* ---- Add students to a class ---- */
  'roster.open': (classId) => openRoster(classId),
  'roster.grade': (grade) => {
    rosterForm.grade = grade === 'all' ? 'all' : Number(grade);
    rosterSheet();
  },
  'roster.toggle': (id) => {
    const at = rosterForm.picked.indexOf(id);
    if (at >= 0) rosterForm.picked.splice(at, 1);
    // An individual class has one student, so a tick moves rather than adds.
    else if (rosterSingle()) rosterForm.picked = [id];
    else rosterForm.picked.push(id);
    refreshRoster();
  },
  /** Tick everyone the filter shows, or untick them if they all are already. */
  'roster.all': () => {
    const shown = R.filterRoster(rosterPool(), rosterForm).map((s) => s.id);
    const allOn = shown.every((id) => rosterForm.picked.includes(id));
    rosterForm.picked = allOn
      ? rosterForm.picked.filter((id) => !shown.includes(id))
      : [...new Set([...rosterForm.picked, ...shown])];
    refreshRoster();
  },
  'roster.save': async (_a, _el, ctx) => {
    if (rosterSingle() && rosterForm.picked.length !== 1) {
      return toast(t('individual_one_student'), 'bad');
    }
    try {
      const result = await api.teacherDo('class.students', {
        class_id: rosterForm.classId,
        student_ids: rosterForm.picked,
      });
      closeSheet();
      await reload(ctx);
      toast(
        result.added || result.removed
          ? t('roster_saved', { added: result.added, removed: result.removed })
          : t('saved'),
      );
    } catch (err) {
      toast(err.message, 'bad');
    }
  },

  /* ---- attendance: Scheduled -> In progress -> Ended (point 10) ---- */
  'attend.open': (key, _el, ctx) => {
    if (!key) return;
    const [classId, date] = String(key).split('|');
    const saved = R.sessionsOn(S.data, date).find((x) => x.cls.id === classId);
    // Re-marking a class starts from what was saved, not from an empty roll.
    goSub('attendance', {
      key,
      absent: [...(saved?.absent || [])],
      told: [],
      startedAt: saved?.started_at || null,
      result: null,
    });
    ctx.render();
  },

  'attend.start': async (_a, _el, ctx) => {
    const [classId, date] = String(S.sub.key).split('|');
    // Point 7: the clock starts on screen at once; the server catches up.
    S.sub.startedAt = new Date().toISOString();
    ctx.render();
    try {
      const result = await api.teacherDo('attendance.start', { class_id: classId, date });
      S.sub.startedAt = result.started_at || S.sub.startedAt;
      await reload(ctx, { quiet: true });
      toast(t('class_started'));
    } catch (err) {
      S.sub.startedAt = null;
      ctx.render();
      toast(err.message, 'bad');
    }
  },

  /** "Use scheduled time", for a teacher who forgot to press Start. */
  'attend.scheduled': (_a, _el, ctx) => {
    const [classId, date] = String(S.sub.key).split('|');
    const cls = classById(classId);
    if (!cls) return;
    S.sub.startedAt = scheduledStart(cls, date);
    ctx.render();
  },

  'attend.toggle': (id, _el, ctx) => {
    const absent = S.sub.absent;
    const at = absent.indexOf(id);
    if (at >= 0) absent.splice(at, 1);
    else absent.push(id);
    ctx.render();
  },

  /** Point 10: tell the parents now, without waiting for the class to end. */
  'attend.sendnow': async (_a, _el, ctx) => {
    const [classId, date] = String(S.sub.key).split('|');
    const pending = (S.sub.absent || []).filter((id) => !(S.sub.told || []).includes(id));
    if (!pending.length) return;
    const links = [];
    try {
      for (const studentId of pending) {
        const result = await api.teacherDo('attendance.absent_now', {
          class_id: classId,
          date,
          student_id: studentId,
        });
        S.sub.told = [...(S.sub.told || []), studentId];
        if (result.link) links.push(result);
      }
      ctx.render();
      if (links.length) openWhatsAppQueue(links);
      else toast(t('reminder_sent', { name: '' }).trim());
    } catch (err) {
      ctx.render();
      toast(err.message, 'bad');
    }
  },

  'attend.finish': async (_a, _el, ctx) => {
    const [classId, date] = String(S.sub.key).split('|');
    const cls = classById(classId);
    const absent = [...(S.sub.absent || [])];
    const told = [...(S.sub.told || [])];
    const startedAt = S.sub.startedAt || (cls ? scheduledStart(cls, date) : null);
    const endedAt = new Date().toISOString();

    try {
      const result = await api.teacherDo('attendance.finish', {
        class_id: classId,
        date,
        absent,
        started_at: startedAt,
        ended_at: endedAt,
        already_notified: told,
      });
      await reload(ctx, { quiet: true });
      // Point 10: the ended screen shows the real times and what was sent.
      S.sub.result = {
        absentIds: absent,
        started_at: result.started_at || startedAt,
        ended_at: result.ended_at || endedAt,
        messages: (result.messages || []).map((m) => ({
          ...m,
          at: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        })),
      };
      ctx.render();
      toast(
        absent.length === 0
          ? t('class_saved_none')
          : absent.length === 1
            ? t('class_saved_one')
            : t('class_saved', { n: absent.length }),
      );
    } catch (err) {
      toast(err.message, 'bad');
    }
  },

  'attend.resend': async (studentId, _el, ctx) => {
    const [classId, date] = String(S.sub.key).split('|');
    try {
      const result = await api.teacherDo('attendance.resend', {
        class_id: classId,
        date,
        student_id: studentId,
      });
      if (result.link) openWhatsAppQueue([result]);
      else toast(t('reminder_sent', { name: result.name || '' }).trim());
      void ctx;
    } catch (err) {
      toast(err.message, 'bad');
    }
  },

  'attend.edittext': (studentId) => {
    const message = (S.sub.result?.messages || []).find((m) => m.student_id === studentId);
    openSheet(`
      ${sheetTitle(t('edit_text'))}
      <label class="fld"><span class="lbl">${esc(t('message_to_parent', { name: message?.name || '' }))}</span>
        <textarea id="att-text" rows="5">${esc(message?.text || '')}</textarea></label>
      ${sheetActions('attend.sendedited', t('send'), studentId)}
    `);
  },
  'attend.sendedited': async (studentId, _el, ctx) => {
    const [classId, date] = String(S.sub.key).split('|');
    const text = val('att-text').trim();
    if (!text) return toast(t('edit_text'), 'bad');
    try {
      const result = await api.teacherDo('attendance.resend', {
        class_id: classId,
        date,
        student_id: studentId,
        text,
      });
      const message = (S.sub.result?.messages || []).find((m) => m.student_id === studentId);
      if (message) {
        message.text = text;
        message.status = result.status;
        message.link = result.link;
      }
      closeSheet();
      ctx.render();
      showSendResult(result, { sentMessage: t('saved') });
    } catch (err) {
      toast(err.message, 'bad');
    }
  },

  /** Point 10: "Start / end time wrong?" after the class. */
  'attend.fixtimes': () => {
    const result = S.sub.result || {};
    const asTime = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    openSheet(`
      ${sheetTitle(t('fix_times'))}
      <div class="row gap">
        ${field('fix-start', t('start_at'), { type: 'time', value: asTime(result.started_at) })}
        ${field('fix-end', t('class_ended'), { type: 'time', value: asTime(result.ended_at) })}
      </div>
      ${sheetActions('attend.savetimes', t('save'))}
    `);
  },
  'attend.savetimes': async (_a, _el, ctx) => {
    const [classId, date] = String(S.sub.key).split('|');
    const toIso = (hhmm) => {
      if (!hhmm) return null;
      const [h, m] = hhmm.split(':').map(Number);
      const [y, mo, d] = date.split('-').map(Number);
      return new Date(y, mo - 1, d, h, m, 0, 0).toISOString();
    };
    try {
      const result = await api.teacherDo('attendance.fix_times', {
        class_id: classId,
        date,
        started_at: toIso(val('fix-start')),
        ended_at: toIso(val('fix-end')),
      });
      if (S.sub.result) {
        S.sub.result.started_at = result.started_at;
        S.sub.result.ended_at = result.ended_at;
      }
      closeSheet();
      await reload(ctx);
      toast(t('times_fixed'));
    } catch (err) {
      toast(err.message, 'bad');
    }
  },

  'attend.close': (_a, _el, ctx) => {
    goBack();
    goTab('today');
    ctx.render();
  },

  /** Rule 7.1.3: tell the parents about a class that has not happened yet. */
  'session.notify': async (key, _el, ctx) => {
    const [classId, date] = String(key).split('|');
    try {
      const result = await api.teacherDo('session.notify', { class_id: classId, date });
      await reload(ctx);
      const manual = (result.messages || []).filter((m) => m.link);
      if (manual.length) openWhatsAppQueue(manual);
      else toast(t('timetable_shared', { n: result.notified }));
    } catch (err) {
      toast(err.message, 'bad');
    }
  },

  /* ---- students ---- */
  'student.open': (id, _el, ctx) => {
    goSub('student', { id });
    ctx.render();
  },
  'student.copy': async (id) => {
    const student = studentById(id);
    try {
      await navigator.clipboard.writeText(student?.parent_phone || '');
      toast(t('copied'));
    } catch {
      toast(student?.parent_phone || '', 'info');
    }
  },
  'student.add': () => {
    const subjects = S.teacher?.subjects?.length ? S.teacher.subjects : ['Maths', 'Science', 'English'];
    openSheet(`
      ${sheetTitle(t('add_student'))}
      ${field('s-name', t('student_name'), { required: true })}
      <div class="row gap">
        ${field('s-grade', t('grade'), { type: 'number', min: 1, max: 13 })}
        ${selectField('s-subject', t('subject'), subjects.map((x) => ({ value: x, label: x })), subjects[0])}
      </div>
      ${field('s-area', t('place'))}
      ${field('s-parent', t('parent_name'))}
      ${telField('s-phone', t('parent_whatsapp'))}
      ${field('s-fee', t('fee_per_class'), { type: 'number', min: 0, inputmode: 'numeric' })}
      ${selectField(
        's-feestatus',
        t('payment_status'),
        [
          { value: 'unpaid', label: t('unpaid') },
          { value: 'paid', label: t('paid') },
        ],
        'unpaid',
      )}
      ${sheetActions('student.save', t('save'))}
      ${button(t('send_signup_link'), { act: 'invite.open', cls: 'gh wide mt' })}
    `);
    wireTelFields(document.getElementById('sheet'));
  },
  'student.save': async (_a, _el, ctx) => {
    const name = val('s-name').trim();
    // Point 3: the same +94 rule as the join form, everywhere a number is typed.
    const phone = telValue('s-phone');
    if (!name) return toast(t('name_phone_required'), 'bad');
    if (!phone) return toast(t('tel_nine'), 'bad');
    try {
      await api.teacherDo('student.create', {
        name,
        grade: numVal('s-grade') || undefined,
        subject: val('s-subject'),
        area: val('s-area'),
        parent_name: val('s-parent'),
        parent_phone: phone,
        fee_per_class: numVal('s-fee'),
        fee_status: val('s-feestatus') === 'paid' ? 'paid' : 'unpaid',
      });
      closeSheet();
      await reload(ctx);
      toast(t('student_added'));
    } catch (err) {
      toast(err.message, 'bad');
    }
  },
  'student.confirm': async (id, _el, ctx) => {
    const fee = numVal('newfee');
    if (!fee) return toast(t('enter_fee'), 'bad');
    try {
      const result = await api.teacherDo('student.confirm', { student_id: id, fee_per_class: fee });
      await reload(ctx);
      if (result.code) {
        openSheet(`
          ${sheetTitle(t('family_code'))}
          <div class="code-big">${esc(result.code)}</div>
          ${muted(t('code_once'))}
          ${result.link ? `<a class="btn wide mt" href="${esc(result.link)}" target="_blank" rel="noopener">${esc(t('send_on_whatsapp'))}</a>` : ''}
          ${button(t('done'), { act: 'sheet.close', cls: 'o wide' })}
        `);
      } else {
        toast(t('saved'));
      }
    } catch (err) {
      toast(err.message, 'bad');
    }
  },
  'student.newcode': async (id, _el, ctx) => {
    try {
      const student = studentById(id);
      const result = await api.teacherDo('student.newcode', { student_id: id });
      await reload(ctx);
      openSheet(`
        ${sheetTitle(t('family_code'))}
        <div class="code-big">${esc(result.code)}</div>
        ${muted(`${student?.name || ''} — ${t('code_once')}`)}
        ${result.link ? `<a class="btn wide mt" href="${esc(result.link)}" target="_blank" rel="noopener">${esc(t('send_on_whatsapp'))}</a>` : ''}
        ${button(t('done'), { act: 'sheet.close', cls: 'o wide' })}
      `);
    } catch (err) {
      toast(err.message, 'bad');
    }
  },

  /* ---- fees (point 11) ---- */

  /**
   * Paid / Unpaid, set by hand once the teacher has the money. With classes
   * still owing on the ledger, "Paid" means recording that payment, so it
   * opens the payment sheet instead of hiding the balance.
   */
  'fees.status': async (arg, _el, ctx) => {
    const [id, status] = String(arg).split('|');
    const student = studentById(id);
    if (!student) return;
    if (status === 'paid' && Number(student.amount_due) > 0) return ACTIONS['fees.pay'](id);
    try {
      await api.teacherDo('student.fee_status', { student_id: id, fee_status: status });
      await reload(ctx);
      toast(status === 'paid' ? t('marked_paid') : t('marked_unpaid'));
    } catch (err) {
      toast(err.message, 'bad');
    }
  },
  'fees.pay': (id) => {
    const student = studentById(id);
    if (!student) return;
    payStudentId = id;
    Object.assign(payForm, {
      mode: 'full',
      amount: '',
      method: 'Cash',
      date: S.today,
      receipt: true,
    });
    paySheet(student);
  },
  'fees.mode': (mode) => {
    payForm.mode = mode;
    redrawPaySheet();
  },
  'fees.method': (method) => {
    payForm.method = method;
    redrawPaySheet();
  },
  'fees.receipt': () => {
    payForm.receipt = !payForm.receipt;
    redrawPaySheet();
  },
  'fees.savepay': async (id, _el, ctx) => {
    const student = studentById(id);
    if (!student) return;
    const due = Number(student.amount_due);
    const amount = payForm.mode === 'full' ? due : Number(val('p-amount') || payForm.amount);

    const problem = R.paymentError(due, amount);
    if (problem) return toast(t(problem), 'bad');

    try {
      const result = await api.teacherDo('payment.record', {
        student_id: id,
        amount,
        method: payForm.method,
        paid_date: val('p-date') || payForm.date || S.today,
        send_receipt: payForm.receipt,
      });
      await reload(ctx, { quiet: true });
      paidSheet(student, result);
    } catch (err) {
      toast(err.message, 'bad');
    }
  },
  'fees.paiddone': (_a, _el, ctx) => {
    stopUndoTimer();
    closeSheet();
    ctx.render();
  },
  'fees.undo': async (paymentId, _el, ctx) => {
    stopUndoTimer();
    try {
      await api.teacherDo('payment.reverse', { payment_id: paymentId });
      closeSheet();
      await reload(ctx);
      toast(t('payment_undone'));
    } catch (err) {
      toast(err.message, 'bad');
    }
  },
  'fees.confirmslip': async (id, _el, ctx) => {
    try {
      const result = await api.teacherDo('payment.confirm_slip', { student_id: id });
      await reload(ctx);
      toast(`${t('slip_confirmed')} · ${R.money(result.amount)}`);
    } catch (err) {
      toast(err.message, 'bad');
    }
  },
  'fees.viewslip': async (id) => {
    try {
      const { url } = await api.slipUrl(id);
      openSheet(`
        ${sheetTitle(t('view_slip'))}
        <img class="slip" src="${esc(url)}" alt="${esc(t('view_slip'))}">
        ${button(t('done'), { act: 'sheet.close', cls: 'o wide mt' })}
      `);
    } catch (err) {
      toast(err.message, 'bad');
    }
  },
  'fees.remind': async (id) => {
    const student = studentById(id);
    try {
      const { text } = await api.teacherPreview('fee', id);
      openSheet(`
        ${sheetTitle(t('fee_reminder'))}
        ${muted(student?.name || '')}
        ${bubble(text)}
        ${sheetActions('fees.sendremind', t('send'), id)}
      `);
    } catch (err) {
      toast(err.message, 'bad');
    }
  },
  'fees.sendremind': async (id, _el, ctx) => {
    const student = studentById(id);
    try {
      const result = await api.teacherDo('message.fee', { student_id: id });
      await reload(ctx);
      showSendResult(result, {
        sentMessage: t('reminder_sent', { name: String(student?.name || '').split(' ')[0] }),
      });
    } catch (err) {
      toast(err.message, 'bad');
    }
  },

  /* ---- marks and reports ---- */
  'mark.add': (id) => {
    openSheet(`
      ${sheetTitle(t('add_mark'))}
      ${field('m-title', t('test_name'), { required: true })}
      <div class="row gap">
        ${field('m-score', t('score'), { type: 'number', min: 0, required: true })}
        ${field('m-max', t('out_of'), { type: 'number', min: 1, value: '100' })}
      </div>
      ${sheetActions('mark.save', t('save_and_tell'), id)}
    `);
  },
  'mark.save': async (id, _el, ctx) => {
    const title = val('m-title').trim();
    if (!title || val('m-score') === '') return toast(t('test_name'), 'bad');
    try {
      const result = await api.teacherDo('mark.add', {
        student_id: id,
        title,
        score: numVal('m-score'),
        max_score: numVal('m-max') || 100,
      });
      await reload(ctx);
      showSendResult(result, { sentMessage: t('mark_saved') });
    } catch (err) {
      toast(err.message, 'bad');
    }
  },
  'report.send': async (id) => {
    try {
      const { text } = await api.teacherPreview('report', id);
      openSheet(`
        ${sheetTitle(t('progress_report'))}
        ${bubble(text)}
        ${sheetActions('report.confirm', t('send'), id)}
      `);
    } catch (err) {
      toast(err.message, 'bad');
    }
  },
  'report.confirm': async (id, _el, ctx) => {
    const student = studentById(id);
    try {
      const result = await api.teacherDo('message.report', { student_id: id });
      await reload(ctx);
      showSendResult(result, {
        sentMessage: t('reminder_sent', { name: String(student?.name || '').split(' ')[0] }),
      });
    } catch (err) {
      toast(err.message, 'bad');
    }
  },

  /* ---- papers ---- */
  'paper.add': () => {
    openSheet(`
      ${sheetTitle(t('add_paper'))}
      ${field('pp-name', t('test_name'), { required: true })}
      <div class="row gap">
        ${field('pp-price', t('price'), { type: 'number', min: 0 })}
        ${field('pp-cost', t('cost'), { type: 'number', min: 0 })}
      </div>
      ${sheetActions('paper.save', t('save'))}
    `);
  },
  'paper.save': async (_a, _el, ctx) => {
    const name = val('pp-name').trim();
    if (!name) return toast(t('test_name'), 'bad');
    try {
      await api.teacherDo('paper.create', {
        name,
        price: numVal('pp-price'),
        cost: numVal('pp-cost'),
      });
      closeSheet();
      await reload(ctx);
      toast(t('saved'));
    } catch (err) {
      toast(err.message, 'bad');
    }
  },
  'paper.sell': async (id, _el, ctx) => {
    await api.teacherDo('paper.sell', { paper_id: id });
    await reload(ctx);
    toast(t('marked_sold'));
  },
  'paper.send': (id) => {
    const pickable = students().filter((s) => s.status === 'active');
    openSheet(`
      ${sheetTitle(t('send_to_parent'))}
      ${selectField('pp-student', t('students'), pickable.map((s) => ({ value: s.id, label: s.name })), pickable[0]?.id)}
      ${sheetActions('paper.sendto', t('send'), id)}
    `);
  },
  'paper.sendto': async (id, _el, ctx) => {
    try {
      const result = await api.teacherDo('paper.send', {
        paper_id: id,
        student_id: val('pp-student'),
      });
      await reload(ctx);
      showSendResult(result, { sentMessage: t('saved') });
    } catch (err) {
      toast(err.message, 'bad');
    }
  },

  /* ---- the sign-up link ---- */
  'invite.open': async () => {
    try {
      const invite = await api.teacherInvite();
      openSheet(`
        ${sheetTitle(t('send_signup_link'))}
        ${muted(t('subjects_shown', { list: (S.teacher?.subjects || []).join(', ') }))}
        ${bubble(invite.text)}
        <a class="btn wide mt" href="${esc(invite.whatsapp)}" target="_blank" rel="noopener">${esc(t('send_on_whatsapp'))}</a>
        ${button(t('copy_link'), { act: 'invite.copy', arg: invite.link, cls: 'o wide' })}
        <a class="btn o wide mt" href="${esc(invite.link)}" target="_blank" rel="noopener">${esc(t('see_the_form'))}</a>
        ${button(t('add_by_hand'), { act: 'student.add', cls: 'gh wide' })}
      `);
    } catch (err) {
      toast(err.message, 'bad');
    }
  },
  'invite.copy': async (link) => {
    try {
      await navigator.clipboard.writeText(link);
      toast(t('link_copied'));
    } catch {
      toast(link, 'info');
    }
  },

  /* ---- timetable broadcast ---- */
  'timetable.share': async (_a, _el, ctx) => {
    try {
      const result = await api.teacherDo('message.timetable', {});
      await reload(ctx);
      closeSheet();
      toast(t('timetable_shared', { n: result.sent }));
    } catch (err) {
      toast(err.message, 'bad');
    }
  },

  /* ---- reschedule requests ---- */
  'reschedule.resolve': async (arg, _el, ctx) => {
    const [id, status] = String(arg).split('|');
    await api.teacherDo('reschedule.resolve', { request_id: id, status });
    await reload(ctx);
    toast(t('saved'));
  },

  /* ---- Plus subscriptions and the Income tab ---- */

  /**
   * The teacher marks that a parent has paid for Plus, and the celebration
   * from the handoff appears straight away - it is the whole point of the
   * screen, so it is not left to the next reload to discover.
   */
  'plus.start': async (id, _el, ctx) => {
    try {
      const result = await api.teacherDo('subscription.start', { student_id: id });
      await reload(ctx);
      openSheet(celebration(result, R.plusGoal(result.students)), { onClose: () => {} });
    } catch (err) {
      toast(err.message, 'bad');
    }
  },
  'plus.celebrated': (_a, _el, ctx) => {
    closeSheet();
    goTab('income');
    ctx.render();
  },
  'plus.end': async (id, _el, ctx) => {
    const student = studentById(id);
    try {
      await api.teacherDo('subscription.end', { student_id: id });
      await reload(ctx);
      toast(t('plus_ended', { name: student?.call_name || student?.name || '' }));
    } catch (err) {
      toast(err.message, 'bad');
    }
  },

  /** The "Invite N students" button: the QR screen for the fullest class. */
  'plus.invite': async (_a, _el, ctx) => {
    const summary = R.incomeSummaryPlus(S.data);
    const fullest = summary.byClass.find((row) => row.off > 0);
    return ACTIONS['plus.inviteclass'](fullest?.cls?.id, _el, ctx);
  },

  'plus.inviteclass': async (classId, _el, ctx) => {
    try {
      const invite = await api.plusInvite(classId);
      goSub('plusinvite', { invite, lang: S.lang === 'ta' ? 'ta' : 'en' });
      ctx.render();
    } catch (err) {
      toast(err.message, 'bad');
    }
  },

  'plus.lang': (code, _el, ctx) => {
    S.sub.lang = code;
    ctx.render();
  },

  /** Send the invite to everyone in the class who is not on Plus yet. */
  'plus.send': async (code, _el, ctx) => {
    const invite = S.sub.invite;
    if (!invite?.class_id) return toast(t('no_students_yet'), 'bad');
    try {
      const result = await api.teacherDo('message.plus_invite', {
        class_id: invite.class_id,
        lang: code || 'en',
      });
      await reload(ctx);
      const manual = (result.messages || []).filter((m) => m.link);
      if (manual.length) openWhatsAppQueue(manual);
      else toast(t('invited_n', { n: result.invited }));
    } catch (err) {
      toast(err.message, 'bad');
    }
  },

  /* ---- settings ---- */
  'settings.open': () => settingsSheet(),
  'settings.lang': async (lang, _el, ctx) => {
    S.lang = lang;
    savePrefs();
    const { setLang } = await import('../i18n.js');
    setLang(lang);
    applyTheme();
    ctx.render();
    settingsSheet();
    api.teacherDo('settings.update', { lang }).catch(() => {});
  },
  'settings.theme': (theme, _el, ctx) => {
    S.theme = theme;
    savePrefs();
    applyTheme();
    ctx.render();
    settingsSheet();
    api.teacherDo('settings.update', { theme }).catch(() => {});
  },
  'settings.autorem': async (_a, _el, ctx) => {
    const next = !S.teacher.auto_reminders;
    const { teacher } = await api.teacherDo('settings.update', { auto_reminders: next });
    S.teacher = teacher;
    if (S.data) S.data.teacher = teacher;
    ctx.render();
    settingsSheet();
  },
  'settings.remdays': async (days, _el, ctx) => {
    const { teacher } = await api.teacherDo('settings.update', { remind_after_days: Number(days) });
    S.teacher = teacher;
    if (S.data) S.data.teacher = teacher;
    ctx.render();
    settingsSheet();
  },
  /** Point 12: "My own place", typed once and reused by every class there. */
  'settings.place': () => {
    openSheet(`
      ${sheetTitle(t('my_place'))}
      ${field('op-name', t('place'), {
        value: S.teacher?.own_place_name || '',
        placeholder: 'My home',
      })}
      ${field('op-area', t('area'), {
        value: S.teacher?.own_place_area || '',
        placeholder: 'Nugegoda',
      })}
      ${sheetActions('settings.saveplace', t('save'))}
    `);
  },
  'settings.saveplace': async (_a, _el, ctx) => {
    try {
      const { teacher } = await api.teacherDo('settings.update', {
        own_place_name: val('op-name'),
        own_place_area: val('op-area'),
      });
      S.teacher = teacher;
      if (S.data) S.data.teacher = teacher;
      closeSheet();
      ctx.render();
      toast(t('saved'));
    } catch (err) {
      toast(err.message, 'bad');
    }
  },
};

function settingsSheet() {
  const teacher = S.teacher || {};
  openSheet(`
    ${sheetTitle(t('settings'))}
    ${card(`<b>${esc(teacherName())}</b>${muted((teacher.subjects || []).join(' · '))}`)}
    ${button(t('send_signup_link'), { act: 'invite.open', cls: 'o wide' })}
    ${button(t('share_timetable'), { act: 'timetable.share', cls: 'gh wide' })}
    ${card(
      `<div class="row sp"><div class="g">${label(t('my_place'))}<b>${esc(
        [teacher.own_place_name || t('my_own_place'), teacher.own_place_area]
          .filter(Boolean)
          .join(' · '),
      )}</b></div>${button(t('edit'), { act: 'settings.place', cls: 'sm o' })}</div>`,
    )}
    ${label(t('language'))}
    ${segmented(
      [
        { value: 'en', label: 'English' },
        { value: 'ta', label: 'தமிழ்' },
      ],
      S.lang,
      'settings.lang',
    )}
    ${label(t('appearance'))}
    ${segmented(
      [
        { value: 'night', label: t('night') },
        { value: 'day', label: t('day_theme') },
        { value: 'auto', label: t('auto') },
      ],
      S.theme,
      'settings.theme',
    )}
    ${card(
      `<div class="row sp"><span>${esc(t('auto_fee_reminders'))}</span>
        <button class="sw${teacher.auto_reminders ? ' on' : ''}" type="button" role="switch"
          aria-checked="${Boolean(teacher.auto_reminders)}" data-a="settings.autorem"><i></i></button></div>
       ${label(t('remind_after'))}
       <div class="chips">${[7, 14, 30]
         .map((d) =>
           chip(`${d} ${t('day').toLowerCase()}s`, {
             act: 'settings.remdays',
             arg: String(d),
             on: Number(teacher.remind_after_days) === d,
           }),
         )
         .join('')}</div>`,
    )}
    ${button(t('done'), { act: 'sheet.close', cls: 'wide mt' })}
    ${button(t('log_out'), { act: 'auth.logout', cls: 'o wide' })}
  `);
}

/* ------------------------------------------------------------- helpers --- */

/**
 * Fill the class sheet from an existing class.
 *
 * With `onlyDate`, this is point 9's "This day only": the sheet becomes a new
 * one-off class on that date, and saving it also cancels the repeating class
 * for that one day - so the week keeps its shape and only that session moves.
 */
function openEditForm(cls, onlyDate) {
  resetClassForm({
    id: onlyDate ? null : cls.id,
    kind: R.classKind(cls),
    subject: cls.subject,
    curriculum: cls.curriculum,
    grade: cls.grade || '',
    students: [...(cls.student_ids || [])],
    venue_type: cls.venue_type || 'area',
    venue_name: cls.venue_name || '',
    area: cls.area || cls.place || '',
    repeat: onlyDate || cls.once_date ? 'once' : 'weekly',
    days: [...(cls.days || [])],
    once_date: onlyDate || cls.once_date || '',
    start_time: R.hhmm(cls.start_time),
    duration_hours: Number(cls.duration_hours) || 1,
  });
  classForm.replaces = onlyDate ? { id: cls.id, date: onlyDate } : null;
  classSheet();
}

function firstDateOf(classId) {
  const cls = classById(classId);
  if (!cls) return null;
  if (cls.once_date) return cls.once_date;
  for (let i = 0; i < 14; i += 1) {
    const date = R.addDays(S.today, i);
    if ((cls.days || []).includes(R.weekday(date)) && date >= cls.start_date) return date;
  }
  return S.today;
}

/** Walking far outside the loaded window: fetch the sessions for it. */
async function ensureSessionWindow(ctx) {
  const window = S.data?.window;
  if (!window) return;
  const anchor = S.cal.date;
  if (anchor >= window.from && anchor <= window.to) return;
  const from = R.addDays(R.startOfMonth(anchor), -7);
  const to = R.addDays(from, 70);
  try {
    const { sessions } = await api.teacherSessions(from, to);
    const seen = new Set(S.data.sessions.map((s) => `${s.class_id}|${s.date}`));
    S.data.sessions.push(...sessions.filter((s) => !seen.has(`${s.class_id}|${s.date}`)));
    S.data.window = { from: from < window.from ? from : window.from, to: to > window.to ? to : window.to };
    // The sessions list changed in place, so the memoised days are stale.
    R.forgetSessions(S.data);
    ctx.render();
  } catch {
    /* the calendar still draws: only saved results are missing */
  }
}

/** Open each pending WhatsApp message in turn, from one tap. */
function openWhatsAppQueue(messages) {
  openSheet(`
    ${sheetTitle(t('send_on_whatsapp'))}
    ${muted(t('messages_ready', { n: messages.length }))}
    ${messages
      .map(
        (m, i) =>
          `<a class="btn wide mt" href="${esc(m.link)}" target="_blank" rel="noopener">${esc(
            `${t('send_on_whatsapp')} ${m.name || i + 1}`,
          )}</a>`,
      )
      .join('')}
    ${button(t('done'), { act: 'sheet.close', cls: 'o wide mt' })}
  `);
}

export { reload as reloadTeacher, classForm, classDraft, resetClassForm, payForm };
