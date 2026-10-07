/**
 * Every teacher action: navigation, the bottom sheets, and the writes.
 *
 * Writes always go to /api and then reload the teacher's data, so what is on
 * screen is what is in the database - never an optimistic guess that could
 * drift from the server's own calculation.
 */

import { api } from '../api.js';
import { t } from '../i18n.js';
import * as R from '../rules.js';
import { S, classById, classes, goBack, goSub, goTab, savePrefs, applyTheme, studentById, students, teacherName } from '../state.js';
import {
  bubble,
  button,
  card,
  chip,
  closeSheet,
  esc,
  field,
  label,
  muted,
  openSheet,
  segmented,
  selectField,
  sheetActions,
  sheetTitle,
  toast,
} from '../ui.js';

const val = (id) => document.getElementById(id)?.value ?? '';
const numVal = (id) => Number(val(id)) || 0;

/** Add-a-class form state, kept while the sheet is open. */
const classForm = {
  subject: 'Maths',
  curriculum: 'Local',
  repeat: 'weekly',
  days: [],
  students: [],
};

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

/* ------------------------------------------------------------- sheets ---- */

function classSheet() {
  const teacherSubjects = S.teacher?.subjects?.length ? S.teacher.subjects : ['Maths', 'Science', 'English'];
  const teacherCurricula = S.teacher?.curricula?.length ? S.teacher.curricula : ['Local', 'Cambridge', 'Edexcel'];
  const pickable = students().filter((s) => s.status === 'active');

  openSheet(`
    ${sheetTitle(t('add_class'))}
    ${label(t('subject'))}
    <div class="chips">${teacherSubjects
      .map((s) => chip(s, { act: 'class.subject', arg: s, on: classForm.subject === s }))
      .join('')}</div>
    ${label(t('curriculum'))}
    <div class="chips">${teacherCurricula
      .map((c) => chip(c, { act: 'class.curriculum', arg: c, on: classForm.curriculum === c }))
      .join('')}</div>
    <div class="row gap">
      ${field('c-grade', t('grade'), { type: 'number', min: 1 })}
      ${field('c-place', t('place'), { placeholder: 'Hall B, Nugegoda' })}
    </div>
    ${label(t('students'))}
    ${
      pickable.length
        ? `<div class="picks">${pickable
            .map(
              (s) =>
                `<button type="button" class="pick${classForm.students.includes(s.id) ? ' on' : ''}"
                  data-a="class.student" data-i="${esc(s.id)}" role="checkbox"
                  aria-checked="${classForm.students.includes(s.id)}">
                  <span>${esc(s.name)}</span><em>${esc(`${t('grade')} ${s.grade ?? '–'}`)}</em></button>`,
            )
            .join('')}</div>`
        : muted(t('no_students_yet'))
    }
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
            chip(d, { act: 'class.day', arg: String(i), on: classForm.days.includes(i) }),
          ).join('')}</div>`
        : field('c-date', t('date'), { type: 'date', value: S.cal.date })
    }
    <div class="row gap">
      ${field('c-time', t('start_time'), { type: 'time', value: '16:00' })}
      ${field('c-dur', t('hours'), { type: 'number', step: '0.5', value: '1', min: 0.5 })}
    </div>
    ${sheetActions('class.save', t('save'))}
  `);
}

function paySheet(student) {
  const count = Number(student.pending_classes) || 1;
  const options = Array.from({ length: count }, (_, i) => ({
    value: String(i + 1),
    label: t('classes_amount', {
      n: i + 1,
      amount: R.money((i + 1) * Number(student.fee_per_class)),
    }),
  }));
  openSheet(`
    ${sheetTitle(t('record_payment'))}
    ${muted(`${student.name} · ${R.money(student.amount_due)}`)}
    ${selectField('p-classes', t('classes'), options, String(count))}
    ${label('')}
    <div class="chips" id="p-method">
      ${chip(t('bank_transfer'), { act: 'fees.method', arg: 'Bank transfer', on: true })}
      ${chip(t('cash'), { act: 'fees.method', arg: 'Cash', on: false })}
    </div>
    ${sheetActions('fees.savepay', t('save'), student.id)}
  `);
}

let payMethod = 'Bank transfer';

/* ------------------------------------------------------------ actions ---- */

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

  /* ---- calendar ---- */
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
  'cal.pick': (date, _el, ctx) => {
    S.cal.date = date;
    ctx.render();
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

  /* ---- classes ---- */
  'class.add': () => {
    classForm.days = [];
    classForm.students = [];
    classForm.repeat = 'weekly';
    classSheet();
  },
  'class.subject': (s) => {
    classForm.subject = s;
    classSheet();
  },
  'class.curriculum': (c) => {
    classForm.curriculum = c;
    classSheet();
  },
  'class.repeat': (mode) => {
    classForm.repeat = mode;
    classSheet();
  },
  'class.day': (index) => {
    const i = Number(index);
    const at = classForm.days.indexOf(i);
    if (at >= 0) classForm.days.splice(at, 1);
    else classForm.days.push(i);
    classSheet();
  },
  'class.student': (id) => {
    const at = classForm.students.indexOf(id);
    if (at >= 0) classForm.students.splice(at, 1);
    else classForm.students.push(id);
    classSheet();
  },
  'class.save': async (_a, _el, ctx) => {
    if (!classForm.students.length) return toast(t('pick_students'), 'bad');
    if (classForm.repeat === 'weekly' && !classForm.days.length) return toast(t('pick_days'), 'bad');
    const payload = {
      subject: classForm.subject,
      curriculum: classForm.curriculum,
      grade: numVal('c-grade') || undefined,
      place: val('c-place'),
      student_ids: classForm.students,
      start_time: val('c-time') || '16:00',
      duration_hours: numVal('c-dur') || 1,
      days: classForm.repeat === 'weekly' ? classForm.days : [],
      once_date: classForm.repeat === 'once' ? val('c-date') || S.cal.date : null,
      start_date: classForm.repeat === 'weekly' ? S.today : undefined,
    };
    try {
      const result = await api.teacherDo('class.create', payload);
      closeSheet();
      await reload(ctx);
      S.cal.date = payload.once_date || firstDateOf(result.class_id) || S.today;
      S.cal.mode = 'day';
      goTab('classes');
      ctx.render();
      toast(t('class_added', { title: result.title }));
    } catch (err) {
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

  /* ---- attendance ---- */
  'attend.open': (key, _el, ctx) => {
    if (!key) return;
    goSub('attendance', { key, absent: [] });
    ctx.render();
  },
  'attend.toggle': (id, _el, ctx) => {
    const absent = S.sub.absent;
    const at = absent.indexOf(id);
    if (at >= 0) absent.splice(at, 1);
    else absent.push(id);
    ctx.render();
  },
  'attend.finish': async (_a, _el, ctx) => {
    const [classId, date] = String(S.sub.key).split('|');
    const absent = [...S.sub.absent];
    try {
      const result = await api.teacherDo('attendance.finish', {
        class_id: classId,
        date,
        absent,
      });
      goBack();
      goTab('today');
      await reload(ctx);
      const manual = (result.messages || []).filter((m) => m.link);
      toast(
        result.absent === 0
          ? t('class_saved_none')
          : result.absent === 1
            ? t('class_saved_one')
            : t('class_saved', { n: result.absent }),
      );
      if (manual.length) openWhatsAppQueue(manual);
    } catch (err) {
      toast(err.message, 'bad');
    }
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
        ${field('s-grade', t('grade'), { type: 'number', min: 1 })}
        ${selectField('s-subject', t('subject'), subjects.map((x) => ({ value: x, label: x })), subjects[0])}
      </div>
      ${field('s-area', t('place'))}
      ${field('s-parent', t('parent_name'))}
      ${field('s-phone', t('parent_whatsapp'), { required: true, placeholder: '94771234567' })}
      ${field('s-fee', t('fee_per_class'), { type: 'number', min: 0 })}
      ${sheetActions('student.save', t('save'))}
      ${button(t('send_signup_link'), { act: 'invite.open', cls: 'gh wide mt' })}
    `);
  },
  'student.save': async (_a, _el, ctx) => {
    const name = val('s-name').trim();
    const phone = val('s-phone').trim();
    if (!name || !phone) return toast(t('name_phone_required'), 'bad');
    try {
      await api.teacherDo('student.create', {
        name,
        grade: numVal('s-grade') || undefined,
        subject: val('s-subject'),
        area: val('s-area'),
        parent_name: val('s-parent'),
        parent_phone: phone,
        fee_per_class: numVal('s-fee'),
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

  /* ---- fees ---- */
  'fees.pay': (id) => {
    payMethod = 'Bank transfer';
    const student = studentById(id);
    if (student) paySheet(student);
  },
  'fees.method': (method, el) => {
    payMethod = method;
    for (const node of document.querySelectorAll('#p-method .chip')) node.classList.remove('on');
    el.classList.add('on');
  },
  'fees.savepay': async (id, _el, ctx) => {
    try {
      const result = await api.teacherDo('payment.record', {
        student_id: id,
        classes: numVal('p-classes') || 1,
        method: payMethod,
      });
      closeSheet();
      await reload(ctx);
      toast(t('payment_received', { amount: R.money(result.amount) }));
    } catch (err) {
      toast(err.message, 'bad');
    }
  },
  'fees.confirmslip': async (id, _el, ctx) => {
    try {
      const result = await api.teacherDo('payment.confirm_slip', { student_id: id });
      await reload(ctx);
      toast(t('slip_confirmed') + ` · ${R.money(result.amount)}`);
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
};

function settingsSheet() {
  const teacher = S.teacher || {};
  openSheet(`
    ${sheetTitle(t('settings'))}
    ${card(`<b>${esc(teacherName())}</b>${muted((teacher.subjects || []).join(' · '))}`)}
    ${button(t('send_signup_link'), { act: 'invite.open', cls: 'o wide' })}
    ${button(t('share_timetable'), { act: 'timetable.share', cls: 'gh wide' })}
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
            `${t('send_on_whatsapp')} ${i + 1}`,
          )}</a>`,
      )
      .join('')}
    ${button(t('done'), { act: 'sheet.close', cls: 'o wide mt' })}
  `);
}

export { reload as reloadTeacher };
