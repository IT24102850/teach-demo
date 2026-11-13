/**
 * "Review with AI": the teacher photographs a student's answer paper, Gemini
 * suggests the marks question by question, and the teacher decides.
 *
 * Nothing is saved until the teacher presses "Save and tell parent", and what
 * is saved is what is on the screen at that moment - the score they may have
 * changed and the message they may have rewritten - through the same mark.add
 * as a mark typed by hand. The AI never writes a mark on its own.
 */

import { api } from '../api.js';
import { t } from '../i18n.js';
import { S, goBack, goSub, studentById } from '../state.js';
import { reload, showSendResult } from './teacher-forms.js';
import {
  backButton,
  big,
  button,
  card,
  emptyState,
  esc,
  field,
  label,
  muted,
  pill,
  spinner,
  toast,
} from '../ui.js';

/* The server's limits, repeated so the screen can say no before uploading. */
const MAX = { pages: 8, scheme: 4 };
/** Vercel refuses bodies over 4.5 MB; leave room for the rest of the JSON. */
const BUDGET = 4_000_000;

/** The review in progress. One at a time, kept while the screen redraws. */
const RV = {
  studentId: null,
  title: '',
  max: '100',
  subject: '',
  notes: '',
  pages: [],
  scheme: [],
  phase: 'form', // form | working | result
  review: null,
  score: '',
  note: '',
};

function resetReview(student) {
  Object.assign(RV, {
    studentId: student?.id || null,
    title: '',
    max: '100',
    subject: student?.subject || S.teacher?.subjects?.[0] || '',
    notes: '',
    pages: [],
    scheme: [],
    phase: 'form',
    review: null,
    score: '',
    note: '',
  });
}

/** Read the boxes back into RV before a redraw wipes them. */
function capture() {
  const read = (id) => document.getElementById(id);
  if (read('rv-title')) RV.title = read('rv-title').value;
  if (read('rv-max')) RV.max = read('rv-max').value;
  if (read('rv-subject')) RV.subject = read('rv-subject').value;
  if (read('rv-notes')) RV.notes = read('rv-notes').value;
  if (read('rv-score')) RV.score = read('rv-score').value;
  if (read('rv-note')) RV.note = read('rv-note').value;
}

/* ---------------------------------------------------------------- photos -- */

/**
 * Shrink a photo on the phone. A 12-megapixel camera picture is 4 MB; at
 * 1600 px on the long side handwriting is still perfectly readable and a page
 * is a few hundred kilobytes.
 */
export function shrink(source, maxSide = 1600, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const draw = (src) => {
      const img = new Image();
      img.onerror = () => reject(new Error(t('photo_unreadable')));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const g = canvas.getContext('2d');
        // White under a transparent PNG, or it turns black as a JPEG.
        g.fillStyle = '#fff';
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = src;
    };
    if (typeof source === 'string') return draw(source);
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t('photo_unreadable')));
    reader.onload = () => draw(reader.result);
    reader.readAsDataURL(source);
  });
}

const totalChars = () => [...RV.pages, ...RV.scheme].reduce((a, x) => a + x.length, 0);

async function addFiles(which, files, ctx) {
  capture();
  const list = RV[which];
  const room = MAX[which] - list.length;
  const picked = [...(files || [])].filter((f) => /^image\//.test(f.type));
  if (picked.length > room) toast(t('review_max_pages', { n: MAX[which] }), 'bad');
  for (const file of picked.slice(0, Math.max(0, room))) {
    try {
      list.push(await shrink(file));
    } catch (err) {
      toast(err.message, 'bad');
    }
  }
  ctx.render();
}

/** Over the upload limit: shrink every page further rather than refuse. */
async function fitBudget() {
  if (totalChars() <= BUDGET) return true;
  RV.pages = await Promise.all(RV.pages.map((x) => shrink(x, 1200, 0.6)));
  RV.scheme = await Promise.all(RV.scheme.map((x) => shrink(x, 1200, 0.6)));
  return totalChars() <= BUDGET;
}

/* ---------------------------------------------------------------- screen -- */

const thumbs = (which) =>
  `<div class="thumbs">${RV[which]
    .map(
      (src, i) =>
        `<div class="thumb"><img src="${esc(src)}" alt="${esc(`${i + 1}`)}">
          <button type="button" class="thumb-x" data-a="review.remove" data-i="${esc(`${which}|${i}`)}"
            aria-label="${esc(t('remove'))}">×</button><span>${i + 1}</span></div>`,
    )
    .join('')}${
    RV[which].length < MAX[which]
      ? `<button type="button" class="thumb add" data-a="review.pick" data-i="${which}">+<span>${esc(
          t('add_photos'),
        )}</span></button>`
      : ''
  }</div>
  <input id="rv-${which}" type="file" accept="image/*" multiple hidden>`;

const VERDICT = {
  correct: () => pill(t('verdict_correct'), 'g'),
  partial: () => pill(t('verdict_partial'), 't'),
  wrong: () => pill(t('verdict_wrong'), 'p'),
  unanswered: () => pill(t('verdict_unanswered')),
};

const CONFIDENCE = {
  high: () => pill(t('conf_high'), 'g'),
  medium: () => pill(t('conf_medium'), 't'),
  low: () => pill(t('conf_low'), 'p'),
};

const fmt = (n) => (Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(1));

const bullets = (items) =>
  `<ul class="rv-list">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;

function formView() {
  return `
    ${card(`${label(t('answer_pages'))}${thumbs('pages')}`)}
    ${card(`${label(t('scheme_pages'))}${muted(t('scheme_hint'))}${thumbs('scheme')}`)}
    ${field('rv-title', t('test_name'), { value: RV.title, required: true })}
    <div class="row gap">
      ${field('rv-max', t('out_of'), { type: 'number', min: 1, value: RV.max, inputmode: 'numeric' })}
      ${field('rv-subject', t('subject'), { value: RV.subject })}
    </div>
    <label class="fld"><span class="lbl">${esc(t('ai_notes'))}</span>
      <textarea id="rv-notes" rows="3" placeholder="${esc(t('ai_notes_ph'))}">${esc(RV.notes)}</textarea></label>
    ${button(`✨ ${t('review_run')}`, { act: 'review.run', cls: 'wide' })}
  `;
}

function resultView() {
  const r = RV.review;
  const scaled = r.model_total && Number(r.model_total.out_of) !== Number(r.max_score);
  return `
    ${card(
      `<div class="row sp">${label(t('suggested_score'))}${(CONFIDENCE[r.confidence] || CONFIDENCE.medium)()}</div>
       ${big(`${fmt(r.score)} / ${fmt(r.max_score)}`)}
       ${
         scaled
           ? muted(
               t('ai_scaled', {
                 awarded: fmt(r.model_total.awarded),
                 outof: fmt(r.model_total.out_of),
                 max: fmt(r.max_score),
               }),
             )
           : ''
       }
       ${r.summary ? `<p class="rv-p">${esc(r.summary)}</p>` : ''}`,
    )}

    ${
      r.questions.length
        ? `<b class="h3">${esc(t('by_question'))}</b>${r.questions
            .map((q) =>
              card(
                `<div class="row sp"><b>${esc(q.label)}</b>
                   <div class="row gap-s">${(VERDICT[q.verdict] || VERDICT.partial)()}
                   <b>${esc(`${fmt(q.awarded)}/${fmt(q.max)}`)}</b></div></div>
                 ${q.comment ? muted(q.comment) : ''}`,
                { cls: `rv-q ${q.verdict}` },
              ),
            )
            .join('')}`
        : ''
    }

    ${r.strengths.length ? card(`${label(t('went_well'))}${bullets(r.strengths)}`) : ''}
    ${r.improve.length ? card(`${label(t('to_work_on'))}${bullets(r.improve)}`) : ''}
    ${r.unreadable.length ? card(`${label(`⚠️ ${t('unreadable_parts')}`)}${bullets(r.unreadable)}`) : ''}

    ${card(
      `${field('rv-score', t('your_score'), { type: 'number', min: 0, max: r.max_score, step: '0.5', value: RV.score, inputmode: 'decimal' })}
       <label class="fld"><span class="lbl">${esc(t('parent_message'))}</span>
         <textarea id="rv-note" rows="4">${esc(RV.note)}</textarea></label>
       ${muted(t('ai_check'))}`,
    )}

    <div class="row gap">
      ${button(t('review_again'), { act: 'review.again', cls: 'o' })}
      ${button(t('save_and_tell'), { act: 'review.save' })}
    </div>
  `;
}

export function reviewView() {
  const s = studentById(S.sub?.id);
  if (!s) return emptyState('That student is gone.', '🤷');
  if (RV.studentId !== s.id) resetReview(s);

  const body =
    RV.phase === 'working'
      ? spinner(t('review_working'))
      : RV.phase === 'result' && RV.review
        ? resultView()
        : formView();

  return `
    <div class="row top-row">${backButton()}<h1 class="cal-h">${esc(t('review_title'))}</h1></div>
    ${muted(`${s.name}${s.grade ? ` · ${t('grade')} ${s.grade}` : ''}`)}
    ${body}
  `;
}

/** The file pickers are recreated on every render, so they are wired after it. */
export function reviewAfter(ctx) {
  for (const which of ['pages', 'scheme']) {
    const input = document.getElementById(`rv-${which}`);
    if (!input || input.dataset.wired) continue;
    input.dataset.wired = '1';
    input.addEventListener('change', () => addFiles(which, input.files, ctx));
  }
}

/* --------------------------------------------------------------- actions -- */

export const ACTIONS = {
  'review.open': (id, _el, ctx) => {
    resetReview(studentById(id));
    goSub('review', { id });
    ctx.render();
  },

  'review.pick': (which) => {
    capture();
    document.getElementById(`rv-${which === 'scheme' ? 'scheme' : 'pages'}`)?.click();
  },

  'review.remove': (arg, _el, ctx) => {
    capture();
    const [which, i] = String(arg).split('|');
    if (RV[which]) RV[which].splice(Number(i), 1);
    ctx.render();
  },

  'review.run': async (_a, _el, ctx) => {
    capture();
    if (!RV.pages.length) return toast(t('review_need_pages'), 'bad');
    if (!RV.title.trim()) return toast(t('test_name'), 'bad');
    const studentId = RV.studentId;

    RV.phase = 'working';
    ctx.render();
    try {
      if (!(await fitBudget())) throw new Error(t('photos_too_large'));
      const { review } = await api.reviewPaper({
        student_id: studentId,
        title: RV.title.trim(),
        max_score: Number(RV.max) || 100,
        subject: RV.subject.trim(),
        notes: RV.notes.trim(),
        lang: S.lang,
        pages: RV.pages,
        scheme: RV.scheme,
      });
      // The teacher may have gone back to another student while it ran.
      if (RV.studentId !== studentId) return;
      RV.review = review;
      RV.score = String(review.score);
      RV.max = String(review.max_score);
      RV.note = review.parent_note;
      RV.phase = 'result';
    } catch (err) {
      RV.phase = 'form';
      toast(err.message, 'bad');
    }
    if (S.sub?.view === 'review') ctx.render();
  },

  'review.again': (_a, _el, ctx) => {
    capture();
    RV.phase = 'form';
    ctx.render();
  },

  'review.save': async (_a, _el, ctx) => {
    capture();
    const max = Number(RV.review?.max_score || RV.max) || 100;
    const score = Number(RV.score);
    if (RV.score === '' || !Number.isFinite(score) || score < 0 || score > max) {
      return toast(t('your_score'), 'bad');
    }
    const result = await api.teacherDo('mark.add', {
      student_id: RV.studentId,
      title: RV.title.trim(),
      score,
      max_score: max,
      feedback: RV.note.trim(),
    });
    resetReview(null);
    goBack();
    await reload(ctx);
    showSendResult(result, { sentMessage: t('mark_saved') });
  },
};
