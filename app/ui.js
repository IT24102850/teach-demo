/**
 * The reusable components of section 5.3, as functions that return HTML.
 *
 * Everything that reaches the page goes through `esc()` first, so a student
 * name with an apostrophe or an angle bracket can never become markup.
 */

import { t } from './i18n.js';
import { groupLkMobile, initials, lkMobileError, toLkMobile } from './rules.js';

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

/**
 * One labelled box.
 *
 * `invalid` is what point 8 asks for: a step's missing answer is outlined in
 * pink, and the short reason is printed under it by the screen itself.
 */
export const field = (
  id,
  labelText,
  {
    type = 'text',
    value = '',
    placeholder = '',
    step,
    min,
    max,
    inputmode,
    required = false,
    invalid = false,
  } = {},
) =>
  `<label class="fld"><span class="lbl">${esc(labelText)}${
    required ? ` <em>${esc(t('required'))}</em>` : ''
  }</span><input id="${attr(id)}" type="${attr(type)}" value="${attr(value)}" placeholder="${attr(
    placeholder,
  )}"${step ? ` step="${attr(step)}"` : ''}${min !== undefined ? ` min="${attr(min)}"` : ''}${
    max !== undefined ? ` max="${attr(max)}"` : ''
  }${inputmode ? ` inputmode="${attr(inputmode)}"` : ''}${required ? ' required' : ''}${
    invalid ? ' class="bad" aria-invalid="true"' : ''
  }></label>`;

export const selectField = (id, labelText, options, current, { required = false, invalid = false } = {}) =>
  `<label class="fld"><span class="lbl">${esc(labelText)}${
    required ? ` <em>${esc(t('required'))}</em>` : ''
  }</span><select id="${attr(id)}"${invalid ? ' class="bad" aria-invalid="true"' : ''}>${options
    .map(
      (o) =>
        `<option value="${attr(o.value)}"${String(o.value) === String(current) ? ' selected' : ''}>${esc(
          o.label,
        )}</option>`,
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

/* ===========================================================================
   Plus App v2 components.
   =========================================================================== */

/* ------------------------------------------------- point 2 · sticky footer -- */

/**
 * The Back / Next row that stays at the bottom of the screen.
 *
 * The screen that uses it must also add `has-footer` to its scrolling area,
 * which reserves exactly this much room below the content so the last field is
 * never hidden behind the bar.
 */
export const footerBar = (buttonsHtml) => `<div class="footer-bar">${buttonsHtml}</div>`;

/**
 * Point 2: a button that shows it is working.
 *
 * `busy` replaces the label with a spinner and the given word, and makes the
 * button unclickable - so a second tap cannot send a second class or a second
 * payment. `disabled` dims a Next that the step has not earned yet; tapping it
 * still runs the action, which is what explains what is missing.
 */
export function actionButton(
  text,
  { act = '', arg = '', cls = '', busy = false, busyText = '', disabled = false } = {},
) {
  const body = busy
    ? `<span class="spin-s" aria-hidden="true"></span>${esc(busyText || text)}`
    : esc(text);
  return `<button class="btn ${cls}${busy ? ' is-busy' : ''}" type="button"${
    act ? ` data-a="${attr(act)}" data-i="${attr(arg)}"` : ''
  }${busy ? ' aria-busy="true"' : ''}${disabled ? ' aria-disabled="true"' : ''}>${body}</button>`;
}

/** Point 2: the green tick after a Submit that worked, or a pink one after a failure. */
export const okScreen = (title, blurb, { bad: isBad = false, extra = '' } = {}) => `
  <div class="ok-screen">
    <div class="ok-tick${isBad ? ' no' : ''}" aria-hidden="true">${isBad ? '!' : '✓'}</div>
    <h1>${esc(title)}</h1>
    ${blurb ? `<p class="mu">${esc(blurb)}</p>` : ''}
    ${extra}
  </div>`;

/* ----------------------------------------------- point 8 · step progress --- */

export const stepBar = (current, total) =>
  `<div class="steps" role="progressbar" aria-valuenow="${current}" aria-valuemin="1" aria-valuemax="${total}">${Array.from(
    { length: total },
    (_, i) => `<i class="${i < current ? 'on' : ''}"></i>`,
  ).join('')}</div>`;

export const stepLabel = (current, total, name) =>
  `<div class="step-n">${esc(t('step_of', { n: current, total }))}${name ? ` · ${esc(name)}` : ''}</div>`;

/* ------------------------------------------------- point 3 · +94 number --- */

/**
 * The phone box with the fixed +94 beside it.
 *
 * The person only ever types the nine national digits. `wireTelFields` keeps
 * the box spaced as they type, drops a leading 0 or a pasted country code, and
 * shows the green or pink line underneath. Everything it does is also done
 * again on the server, so the field is a help, not a gate.
 */
export function telField(id, labelText, { value = '', required = true, hint = true } = {}) {
  const shown = groupLkMobile(value);
  const problem = value ? lkMobileError(value) : 'empty';
  return `<label class="fld">
    <span class="lbl">${esc(labelText)}${required ? ` <em>${esc(t('required'))}</em>` : ''}</span>
    <div class="tel">
      <span class="tel-cc" aria-hidden="true">🇱🇰 +94</span>
      <input id="${attr(id)}" type="tel" inputmode="numeric" autocomplete="tel-national"
        data-tel="1" maxlength="13" placeholder="77 123 4567"
        aria-label="${attr(labelText)}" value="${attr(shown)}"${
          problem ? '' : ' class="ok"'
        }>
    </div>
    ${hint ? `<p class="fld-hint">${esc(t('tel_hint'))}</p>` : ''}
    <p class="fld-note${problem ? '' : ' ok'}" data-tel-note="${attr(id)}">${
      problem ? '' : esc(t('tel_ok'))
    }</p>
  </label>`;
}

/**
 * Attach the live behaviour to every +94 box on the screen.
 *
 * Called once after each render. The caret is put back where it belongs after
 * the spaces are re-inserted, so typing in the middle of a number does not
 * throw the cursor to the end.
 */
export function wireTelFields(root = document) {
  for (const input of root.querySelectorAll('input[data-tel]')) {
    if (input.dataset.telWired) continue;
    input.dataset.telWired = '1';
    input.addEventListener('input', () => {
      const before = input.value.slice(0, input.selectionStart ?? input.value.length);
      const digitsBefore = before.replace(/\D/g, '').length;
      input.value = groupLkMobile(input.value);
      // Walk forward over the formatted value until the same number of digits
      // has been passed; that is where the caret was.
      let seen = 0;
      let at = input.value.length;
      for (let i = 0; i < input.value.length; i += 1) {
        if (seen >= digitsBefore) {
          at = i;
          break;
        }
        if (/\d/.test(input.value[i])) seen += 1;
      }
      try {
        input.setSelectionRange(at, at);
      } catch {
        /* a type="tel" box refuses setSelectionRange in some browsers */
      }
      showTelState(input);
    });
    input.addEventListener('blur', () => showTelState(input, { always: true }));
  }
}

/** Paint the green or pink line under one phone box. */
export function showTelState(input, { always = false } = {}) {
  const note = document.querySelector(`[data-tel-note="${CSS_escape(input.id)}"]`);
  const problem = lkMobileError(input.value);
  const empty = problem === 'empty';
  input.classList.toggle('ok', !problem);
  input.classList.toggle('bad', Boolean(problem) && !empty);
  if (!note) return;
  if (empty && !always) {
    note.textContent = '';
    note.className = 'fld-note';
    return;
  }
  note.textContent = problem ? t(empty ? 'tel_nine' : problem) : t('tel_ok');
  note.className = `fld-note ${problem ? 'no' : 'ok'}`;
}

/** Read a +94 box as the stored 947XXXXXXXX, or null when it is not valid. */
export const telValue = (id) => toLkMobile(document.getElementById(id)?.value || '');

/** document.querySelector needs ids escaped; CSS.escape is not everywhere. */
const CSS_escape = (value) =>
  typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : String(value).replace(/"/g, '\\"');

/* ------------------------------------------------------ point 11 · tick --- */

/** A tick box, as a button so it works from the keyboard without a label. */
export const checkbox = (text, { act, arg = '', on = false } = {}) =>
  `<button class="check${on ? ' on' : ''}" type="button" role="checkbox" aria-checked="${on}"
    data-a="${attr(act)}" data-i="${attr(arg)}"><i aria-hidden="true">✓</i><span>${esc(text)}</span></button>`;

/** The lines of a receipt: label on the left, value right-aligned. */
export const receipt = (rows) =>
  `<div class="receipt">${rows
    .map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`)
    .join('')}</div>`;

/* --------------------------------------------------- point 1 · skeletons -- */

/**
 * Grey boxes in the shape of the screen that is coming, instead of a blank
 * page or a lone spinner. The page looks alive from the first frame.
 */
export const skeleton = (cards = 3) =>
  `<div aria-busy="true" aria-label="${esc(t('loading'))}">
    <div class="skel skel-line" style="width:40%"></div>
    <div class="skel skel-line" style="width:65%;height:22px"></div>
    ${Array.from({ length: cards }, () => '<div class="skel skel-card"></div>').join('')}
  </div>`;
