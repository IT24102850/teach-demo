/**
 * The reusable components of section 5.3, as functions that return HTML.
 *
 * Everything that reaches the page goes through `esc()` first, so a student
 * name with an apostrophe or an angle bracket can never become markup.
 */

import { t } from './i18n.js';
import { initials } from './rules.js';

/** Escape text for HTML. Never interpolate a value without it. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape for an attribute that an action reads back (data-i). */
export const attr = (value) => esc(value);

export const card = (inner, { cls = '', style = '', act = '', arg = '' } = {}) =>
  `<div class="card ${cls}"${style ? ` style="${esc(style)}"` : ''}${
    act ? ` data-a="${attr(act)}" data-i="${attr(arg)}" role="button" tabindex="0"` : ''
  }>${inner}</div>`;

export const pill = (text, tone = '') => `<span class="pill ${tone}">${esc(text)}</span>`;

export const avatar = (name) => `<div class="av" aria-hidden="true">${esc(initials(name))}</div>`;

export const label = (text) => `<div class="lbl">${esc(text)}</div>`;
export const muted = (text) => `<div class="mu">${esc(text)}</div>`;
export const big = (text, style = '') => `<div class="big"${style ? ` style="${esc(style)}"` : ''}>${esc(text)}</div>`;

export function button(text, { act = '', arg = '', cls = '', type = 'button', disabled = false } = {}) {
  return `<button class="btn ${cls}" type="${type}"${act ? ` data-a="${attr(act)}" data-i="${attr(arg)}"` : ''}${
    disabled ? ' disabled' : ''
  }>${esc(text)}</button>`;
}

export const iconButton = (glyph, { act, arg = '', aria, cls = '' } = {}) =>
  `<button class="ib ${cls}" type="button" data-a="${attr(act)}" data-i="${attr(arg)}" aria-label="${attr(
    aria || glyph,
  )}">${glyph}</button>`;

export const backButton = () => iconButton('←', { act: 'back', aria: t('back') });

export const chip = (text, { act, arg = '', on = false } = {}) =>
  `<button class="chip${on ? ' on' : ''}" type="button" role="switch" aria-checked="${on}" data-a="${attr(
    act,
  )}" data-i="${attr(arg)}">${esc(text)}</button>`;

/** Joined buttons: Day · Week · Month, Marks · Attendance, Present · Absent. */
export function segmented(options, current, act, { tone = '' } = {}) {
  return `<div class="seg ${tone}" role="tablist">${options
    .map(
      (o) =>
        `<button type="button" role="tab" aria-selected="${o.value === current}" class="${
          o.value === current ? 'on' : ''
        }" data-a="${attr(act)}" data-i="${attr(o.value)}">${esc(o.label)}</button>`,
    )
    .join('')}</div>`;
}

export const tiles = (items) =>
  `<div class="tiles">${items
    .map(
      (i) =>
        `<div class="card">${label(i.label)}${big(i.value, i.colour ? `color:${i.colour}` : '')}${
          i.caption ? muted(i.caption) : ''
        }</div>`,
    )
    .join('')}</div>`;

export const bar = (pct, colour = 'var(--green)') =>
  `<div class="bar" role="img" aria-label="${Math.round(pct)}%"><i style="width:${Math.max(
    0,
    Math.min(100, pct),
  )}%;background:${esc(colour)}"></i></div>`;

export const bubble = (text) => `<div class="bub">${esc(text)}</div>`;

export const dots = (hist) =>
  `<div class="dots">${[...(hist || '')]
    .map((c) => `<span class="dot ${c === 'A' ? 'A' : ''}" title="${c === 'A' ? t('absent') : t('present')}">${c}</span>`)
    .join('')}</div>`;

export const toggle = (on, act) =>
  `<button class="sw${on ? ' on' : ''}" type="button" role="switch" aria-checked="${on}" data-a="${attr(
    act,
  )}"><i></i></button>`;

export const field = (id, labelText, { type = 'text', value = '', placeholder = '', step, min, required = false } = {}) =>
  `<label class="fld"><span class="lbl">${esc(labelText)}${
    required ? ` <em>${esc(t('required'))}</em>` : ''
  }</span><input id="${attr(id)}" type="${attr(type)}" value="${attr(value)}" placeholder="${attr(
    placeholder,
  )}"${step ? ` step="${attr(step)}"` : ''}${min !== undefined ? ` min="${attr(min)}"` : ''}${
    required ? ' required' : ''
  }></label>`;

export const selectField = (id, labelText, options, current) =>
  `<label class="fld"><span class="lbl">${esc(labelText)}</span><select id="${attr(id)}">${options
    .map(
      (o) =>
        `<option value="${attr(o.value)}"${o.value === current ? ' selected' : ''}>${esc(o.label)}</option>`,
    )
    .join('')}</select></label>`;

export const emptyState = (text, icon = '🙂') =>
  `<div class="card empty"><div class="empty-i" aria-hidden="true">${icon}</div><p>${esc(text)}</p></div>`;

export const spinner = (text) =>
  `<div class="load"><div class="spin" aria-hidden="true"></div><p class="mu">${esc(text || t('loading'))}</p></div>`;

/** A simple SVG bar chart (section 5.3: hand-drawn, no chart library). */
export function barChart(values, { height = 76, colours, labels, highlight = -1 } = {}) {
  const max = Math.max(1, ...values);
  const width = Math.max(values.length * 16, 100);
  const bars = values
    .map((v, i) => {
      const h = Math.max(2, (v / max) * (height - 22));
      const fill = colours?.[i] || (v > 0 ? 'var(--green)' : 'var(--card2)');
      return `<rect x="${i * 16 + 3}" y="${height - 18 - h}" width="10" height="${h}" rx="3" fill="${esc(
        fill,
      )}"/>`;
    })
    .join('');
  const text = (labels || [])
    .map(
      (l, i) =>
        `<text x="${i * 16 + 8}" y="${height - 5}" text-anchor="middle" font-size="7" fill="${
          i === highlight ? 'var(--tx)' : 'var(--mu)'
        }" font-weight="${i === highlight ? 800 : 500}">${esc(l)}</text>`,
    )
    .join('');
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img">${bars}${text}</svg>`;
}

/** Two series on the same axis: collected vs still owed. */
export function stackChart(rows, { height = 80 } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.a + r.b));
  const width = Math.max(rows.length * 22, 100);
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img">${rows
    .map((r, i) => {
      const ha = (r.a / max) * (height - 22);
      const hb = (r.b / max) * (height - 22);
      return (
        `<rect x="${i * 22 + 5}" y="${height - 18 - ha}" width="12" height="${Math.max(1, ha)}" rx="3" fill="var(--green)"/>` +
        `<rect x="${i * 22 + 5}" y="${height - 18 - ha - hb}" width="12" height="${Math.max(1, hb)}" rx="3" fill="var(--pink)" opacity=".75"/>` +
        `<text x="${i * 22 + 11}" y="${height - 5}" text-anchor="middle" font-size="7" fill="var(--mu)">${esc(
          r.label,
        )}</text>`
      );
    })
    .join('')}</svg>`;
}

/* ------------------------------------------------------- sheets & toasts -- */

let sheetCloser = null;

export function openSheet(html, { onClose } = {}) {
  const host = document.getElementById('sheet');
  host.innerHTML = `<div class="sheet-panel" role="dialog" aria-modal="true"><div class="grab" aria-hidden="true"></div>${html}</div>`;
  host.classList.add('open');
  sheetCloser = onClose || null;
  const first = host.querySelector('input,select,button');
  if (first) setTimeout(() => first.focus(), 60);
}

export function closeSheet() {
  const host = document.getElementById('sheet');
  host.classList.remove('open');
  host.innerHTML = '';
  if (sheetCloser) {
    const fn = sheetCloser;
    sheetCloser = null;
    fn();
  }
}

export const sheetIsOpen = () => document.getElementById('sheet').classList.contains('open');

let toastTimer = null;
export function toast(message, tone = 'good') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `open ${tone}`;
  el.setAttribute('role', 'status');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = '';
  }, 2800);
}

/** The Cancel / Save row at the bottom of every sheet. */
export const sheetActions = (saveAct, saveLabel, arg = '') =>
  `<div class="row gap" style="margin-top:14px">${button(t('cancel'), {
    act: 'sheet.close',
    cls: 'o',
  })}${button(saveLabel || t('save'), { act: saveAct, arg })}</div>`;

export const sheetTitle = (text) => `<h2 class="sheet-h">${esc(text)}</h2>`;
