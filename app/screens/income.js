/**
 * The Income tab (design handoff, screens 1, 2 and 4).
 *
 * This is about the teacher's Plus income, which is a different thing from
 * the fee ledger: fees are what parents pay the teacher for lessons, and
 * Plus is a monthly subscription the teacher keeps a share of. The two never
 * mix, and - as the handoff asks - no rupee amounts appear on these screens.
 * The teacher is shown students, growth and a goal, not a balance.
 */

import { t } from '../i18n.js';
import * as R from '../rules.js';
import { S, classes, students } from '../state.js';
import { qrSvg } from '../qr.js';
import {
  backButton,
  button,
  card,
  emptyState,
  esc,
  iconButton,
  label,
  muted,
} from '../ui.js';

/** The little mark in the corner of every Income screen. */
const plusMark = () => `<span class="plus-mark" aria-hidden="true">PLUS</span>`;

/* ----------------------------------------------- the growth graph (1) ---- */

/**
 * Two lines on one axis: Plus against tuition, both since the teacher joined.
 *
 * The handoff asks for no amounts, so the two series are scaled to their own
 * maximum - the shape is the message, not the rupees. The claim above it is
 * only made when there is enough history to make it honestly.
 */
function growthCard(summary) {
  const { series, multiple } = summary;
  const months = series.months.slice(-6);
  const take = (values) => values.slice(-6);
  const plus = take(series.plus);
  const tuition = take(series.tuition);

  const headline = multiple
    ? `${esc(t('plus_growing'))}<br><span class="grow-n">${esc(
        t('faster_than_tuition', { n: multiple }),
      )}</span>`
    : esc(t('growth_soon'));

  const w = 330;
  const h = 150;
  const path = (values) =>
    values
      .map((v, i) => {
        const x = values.length < 2 ? w : (i / (values.length - 1)) * w;
        return `${Math.round(x)},${Math.round(h - v * (h - 20))}`;
      })
      .join(' ');

  const line = months.length > 1;

  return card(
    `${label(t('your_growth'))}
     <div class="grow-h">${headline}</div>
     ${
       line
         ? `<svg class="grow" viewBox="0 0 ${w} ${h + 15}" preserveAspectRatio="none" role="img"
              aria-label="${esc(t('your_growth'))}">
             <defs><linearGradient id="gp" x1="0" y1="0" x2="0" y2="1">
               <stop offset="0" stop-color="var(--teal)" stop-opacity=".30"/>
               <stop offset="1" stop-color="var(--teal)" stop-opacity="0"/>
             </linearGradient></defs>
             <polygon points="${path(plus)} ${w},${h} 0,${h}" fill="url(#gp)"/>
             <polyline points="${path(tuition)}" fill="none" stroke="var(--mu)"
               stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
             <polyline points="${path(plus)}" fill="none" stroke="var(--teal)"
               stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
           </svg>
           <div class="grow-x">${months
             .map(
               (m, i) =>
                 `<span${i === months.length - 1 ? ' class="on"' : ''}>${esc(monthShort(m))}</span>`,
             )
             .join('')}</div>`
         : muted(t('growth_needs_months'))
     }`,
    { cls: 'grow-card' },
  );
}

const monthShort = (month) =>
  R.parseDate(`${month}-01`)
    .toLocaleDateString(S.lang === 'ta' ? 'ta-LK' : 'en-GB', { month: 'short', timeZone: 'UTC' })
    .toUpperCase();

/* ------------------------------------------- students, month by month ---- */

/** One column per month, built of student faces, as the handoff draws it. */
function studentsCard(summary) {
  const months = (S.data?.plus_months || []).slice(-6);
  if (!months.length) return '';
  const most = Math.max(1, ...months.map((m) => Number(m.students) || 0));
  const CAP = 12; // taller columns than this would not fit a phone

  return card(
    `${label(t('students_on_plus'))}
     <div class="grow-h sm">${esc(t('more_every_month'))}</div>
     <div class="faces">
       ${months
         .map((m, i) => {
           const count = Number(m.students) || 0;
           const shown = Math.min(count, CAP);
           const live = i === months.length - 1;
           return `<div class="faces-col">
             <b class="${live ? 'on' : ''}">${count}</b>
             <div class="faces-stack${live ? ' on' : ''}"
               style="min-height:${Math.round((shown / Math.max(most, CAP)) * 100)}%">
               ${Array.from({ length: shown }, (_, n) => face(n)).join('')}
             </div>
             <em>${esc(monthShort(m.month))}</em>
           </div>`;
         })
         .join('')}
     </div>`,
  );
}

const FACE_COLOURS = ['#9fe9ec', '#ffc2cf', '#b6efc9', '#ffe49a', '#d2c9ff', '#bfe3fd'];
const face = (n) =>
  `<i style="background:${FACE_COLOURS[n % FACE_COLOURS.length]}" aria-hidden="true"></i>`;

/* --------------------------------------------------- the goal (1 and 2) -- */

/** "Almost there: just 2 more students", with the ring from the handoff. */
function almostCard(goal) {
  const circumference = 2 * Math.PI * 22;
  const filled = (goal.joined / Math.max(1, goal.need)) * circumference;
  return card(
    `<div class="row">
       <svg class="ring" viewBox="0 0 52 52" aria-hidden="true">
         <circle cx="26" cy="26" r="22" fill="none" stroke="var(--card2)" stroke-width="6"/>
         <circle cx="26" cy="26" r="22" fill="none" stroke="var(--pink)" stroke-width="6"
           stroke-linecap="round" stroke-dasharray="${filled.toFixed(1)} ${circumference.toFixed(1)}"
           transform="rotate(-90 26 26)"/>
         <text x="26" y="30" text-anchor="middle" font-size="14" font-weight="800"
           fill="var(--tx)">${goal.joined}/${goal.need}</text>
       </svg>
       <div class="g">
         ${label(t('almost_there'))}
         <b class="goal-n">${esc(t('just_n_more', { n: goal.remaining }))}</b>
         ${muted(t('to_next_uplift', { pct: goal.uplift }))}
       </div>
     </div>`,
    { cls: 'almost' },
  );
}

/** "Next goal: add 6 more students → you get +25%". */
function goalCard(goal) {
  return card(
    `${label(t('next_goal'))}
     <div class="grow-h sm">${esc(t('add_n_more', { n: goal.remaining }))}</div>
     <div class="goal-row">
       <div class="goal-dots">${Array.from(
         { length: Math.min(goal.remaining, 8) },
         () => '<i></i>',
       ).join('')}</div>
       <span class="goal-arrow" aria-hidden="true">→</span>
       <div class="goal-prize">
         ${label(t('you_get'))}
         <b>+${goal.uplift}%</b>
         ${muted(t('plus_income_every_month'))}
       </div>
     </div>
     ${button(t('invite_n_students', { n: goal.remaining }), {
       act: 'plus.invite',
       cls: 'wide',
     })}`,
  );
}

/* ------------------------------------------------- by class (screen 2) --- */

function byClassCard(summary) {
  if (!summary.byClass.length) return emptyState(t('no_classes_day'), '📚');

  return `
    ${label(t('by_class_invite'))}
    ${summary.byClass
      .map((row) => {
        const done = row.total ? (row.on / row.total) * 100 : 0;
        return card(
          `<div class="row sp">
             <b class="g">${esc(row.cls.title)}</b>
             ${
               row.off
                 ? `<span class="off-n">${esc(t('n_not_on_plus', { n: row.off }))}</span>`
                 : `<span class="on-n">${esc(t('all_on_plus'))}</span>`
             }
           </div>
           <div class="pips">${Array.from(
             { length: Math.min(row.total, 16) },
             (_, i) => `<i class="${i < Math.round((done / 100) * Math.min(row.total, 16)) ? 'on' : ''}"></i>`,
           ).join('')}</div>
           ${
             row.off
               ? button(t('invite'), { act: 'plus.inviteclass', arg: row.cls.id, cls: 'sm o' })
               : ''
           }`,
          { cls: 'byclass' },
        );
      })
      .join('')}`;
}

/* ------------------------------------------------------------ the tab ---- */

export function income() {
  const summary = R.incomeSummaryPlus(S.data);
  const goal = summary.goal;

  return `
    <div class="row sp top-row">
      <div>
        <h1>${esc(t('income'))}</h1>
        ${muted(t('since_joined'))}
      </div>
      ${plusMark()}
    </div>

    ${growthCard(summary)}
    ${studentsCard(summary)}
    ${goal.almost ? almostCard(goal) : ''}
    ${goalCard(goal)}
    ${byClassCard(summary)}
  `;
}

/* --------------------------------------------- the invite screen (4) ----- */

/**
 * The QR code a class scans off the teacher's phone, and the same invite as
 * a WhatsApp message in each language the handoff offers.
 *
 * The code is drawn here rather than fetched from an image service, so a
 * teacher's join link never leaves the device to be rendered.
 */
export function plusInvite() {
  const invite = S.sub.invite;
  if (!invite) return emptyState(t('loading'), '⏳');

  const chosen = invite.languages.find((l) => l.code === (S.sub.lang || 'en')) || invite.languages[0];

  return `
    <div class="row sp top-row">
      <div class="row">${backButton()}
        <div><h1>${esc(t('invite_students'))}</h1>${muted(invite.title)}</div>
      </div>
      ${plusMark()}
    </div>

    ${card(
      `<div class="qr">${qrSvg(invite.link, { size: 230 })}</div>
       <b class="qr-h">${esc(t('show_in_class'))}</b>
       ${muted(t('scan_to_join'))}`,
      { cls: 'qr-card' },
    )}

    ${card(
      `${label(t('or_send_whatsapp'))}
       <div class="chips">${invite.languages
         .map(
           (l) =>
             `<button type="button" class="chip${l.code === chosen.code ? ' on' : ''}"
               data-a="plus.lang" data-i="${esc(l.code)}">${esc(l.label)}</button>`,
         )
         .join('')}</div>
       <div class="bub">${esc(chosen.text)}</div>
       <div class="row gap mt-s">
         ${button(t('send_on_whatsapp'), { act: 'plus.send', arg: chosen.code, cls: 'gr' })}
         ${button(t('copy_link'), { act: 'invite.copy', arg: invite.link, cls: 'o' })}
       </div>`,
    )}
  `;
}

/* ------------------------------------------- the celebration (screen 3) -- */

/**
 * Shown the moment a parent is marked as subscribed. The handoff wants this
 * to feel like something happened, so it is confetti and a number, not a
 * receipt - the money is deliberately not on it.
 */
export const celebration = (who, goal) => `
  <div class="party" aria-hidden="true">${Array.from(
    { length: 14 },
    (_, i) =>
      `<i style="left:${(i * 7 + 4) % 100}%;animation-delay:${(i % 5) * 0.12}s;background:${
        FACE_COLOURS[i % FACE_COLOURS.length]
      }"></i>`,
  ).join('')}</div>

  <div class="ok-screen">
    <div class="joined-av" aria-hidden="true">${face(0)}<span>+</span></div>
    <div class="joined-emoji" aria-hidden="true">🎉</div>
    <h1>${esc(t('joined_plus', { name: who.name }))}</h1>
    <p class="mu">${esc(t('thats_n_students', { n: who.students }))}<br>${esc(
      t('income_went_up'),
    )}</p>

    <div class="pips wide">${Array.from(
      { length: Math.max(1, goal.need) },
      (_, i) => `<i class="${i < goal.joined ? 'on' : ''}"></i>`,
    ).join('')}</div>
    <p class="goal-left">${esc(t('n_more_to_goal', { n: goal.remaining, pct: goal.uplift }))}</p>

    ${button(t('keep_going'), { act: 'plus.celebrated', cls: 'wide' })}
  </div>
`;

/** The icon for the fifth tab. */
export const INCOME_TAB = { key: 'income', label: 'income', glyph: '📈' };
