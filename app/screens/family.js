/**
 * The Parent view (section 8.2) and the Student view (section 8.3).
 *
 * Both read the same payload from /api/family - the difference is the layout
 * and the wording. Everything here is read-only except paying by slip, asking
 * to reschedule, and switching child or view.
 */

import { api } from '../api.js';
import { t } from '../i18n.js';
import * as R from '../rules.js';
import { S, applyTheme, savePrefs } from '../state.js';
import {
  avatar,
  backButton,
  bar,
  barChart,
  big,
  button,
  card,
  closeSheet,
  dots,
  emptyState,
  esc,
  iconButton,
  label,
  muted,
  openSheet,
  pill,
  segmented,
  sheetActions,
  sheetTitle,
  tiles,
  toast,
} from '../ui.js';

const child = () => S.data?.child || {};
const marks = () => S.data?.marks || [];

/* ------------------------------------------------------------- shared ---- */

function topBar(title, subtitle) {
  return `
    <div class="row sp top-row">
      <div><h1>${esc(title)}</h1>${subtitle ? muted(subtitle) : ''}</div>
      <div class="row gap-s">
        ${
          (S.children || []).length > 1
            ? `<button class="pill t tap" type="button" data-a="family.switch">${esc(
                child().name?.split(' ')[0] || '',
              )} ▾</button>`
            : ''
        }
        ${iconButton('⚙', { act: 'family.settings', aria: t('settings') })}
      </div>
    </div>`;
}

function nextClassCard() {
  const next = R.nextSession(S.data, S.today);
  if (!next) return card(`${label(t('next_class_label'))}${big(t('nothing_planned'))}`, { cls: 'hero' });
  const when =
    next.date === S.today
      ? t('today')
      : `${R.DAY_SHORT[R.weekday(next.date)]} ${Number(next.date.slice(8))}`;
  return card(
    `${label(t('next_class_label'))}
     ${big(`${when} ${R.hhmm(next.cls.start_time)}`, 'margin:6px 0')}
     <div>${esc(`${next.cls.subject} · ${next.cls.place || ''} · ${next.cls.duration_hours}h`)}</div>`,
    { cls: 'hero' },
  );
}

function attendanceSentence(hist) {
  if (R.atRisk(hist)) return t('missed_a_few');
  const run = R.streak(hist);
  return run >= 3 ? t('on_a_roll', { n: run }) : t('keep_it_up');
}

function progressChart() {
  const list = marks();
  if (list.length < 2) return '';
  const change = R.progress(list);
  return card(
    `<div class="row sp">${label(t('marks'))}
      ${pill(t('since_first_test', { n: `${change >= 0 ? '+' : ''}${change}` }), change >= 0 ? 'g' : 'p')}</div>
     ${barChart(
       list.map((m) => R.markPct(m)),
       { colours: list.map((m) => R.markColour(R.markPct(m))), labels: list.map((_, i) => String(i + 1)) },
     )}`,
  );
}

function boardRows(rows, { limit } = {}) {
  const shown = limit ? rows.slice(0, limit) : rows;
  const me = rows.find((r) => r.self);
  const list = limit && me && me.rank > limit ? [...shown, me] : shown;
  return list
    .map((r) =>
      card(
        `<div class="row"><b class="rank">${r.rank}</b><span class="g">${esc(r.name)}</span>
          <b>${r.value}%</b></div>`,
        { cls: r.self ? 'mine' : '', style: '' },
      ),
    )
    .join('');
}

function weekClassList() {
  const sessions = R.weekSessions(S.data, S.today);
  if (!sessions.length) return emptyState(t('no_classes_day'), '📅');
  return sessions
    .map((s) => {
      let status = { label: t('upcoming'), tone: '' };
      if (s.done) {
        const wasAbsent = s.absent?.includes(S.data.child_id) || s.saved?.present === false;
        status = wasAbsent
          ? { label: t('absent'), tone: 'p' }
          : { label: t('attended'), tone: 'g' };
      } else if (s.date < S.today) status = { label: t('upcoming'), tone: '' };
      else if (s.notified) status = { label: t('reminded'), tone: 't' };

      return card(
        `<div class="row sp"><b>${esc(`${R.DAY_SHORT[R.weekday(s.date)]} ${R.timeRange(s.cls)}`)}</b>${pill(
          status.label,
          status.tone,
        )}</div>
         ${muted(`${s.cls.title} · ${s.cls.place || ''}`)}`,
        { cls: 'sess', style: `border-left-color:${R.subjectColour(s.cls.subject)}` },
      );
    })
    .join('');
}

function feesCard({ compact = false } = {}) {
  const c = child();
  const due = Number(c.amount_due || 0);
  if (!due) {
    return compact ? '' : card(`${label(t('amount_due'))}${big(R.money(0), 'color:var(--gt)')}${muted(t('paid'))}`);
  }
  const action = c.slip_sent
    ? `<p class="mu mt-s">${esc(t('slip_waiting'))}</p>`
    : button(compact ? t('pay_amount', { amount: R.money(due) }) : t('pay_now'), {
        act: 'family.slip',
        cls: 'wide mt-s',
      });
  if (compact) return action;
  return card(
    `${label(t('amount_due'))}
     ${big(R.money(due), 'color:var(--pt)')}
     ${muted(
       `${t('classes_x_fee', { classes: c.pending_classes, fee: R.money(c.fee_per_class) })} · ${t(
         'classes_days_late',
         { classes: c.pending_classes, days: c.days_late },
       )}`,
     )}
     ${action}`,
  );
}

const EVENT_TONE = { absent: 'p', fee: 'p', paid: 'g', mark: 't', report: 't', class: '', slip: 't', join: 'g' };

function updatesFeed() {
  const events = S.data?.events || [];
  if (!events.length) return emptyState(t('updates_from_teacher'), '📭');
  return events
    .slice(0, 6)
    .map((e) =>
      card(
        `<div class="row">${pill(t(e.type), EVENT_TONE[e.type] ?? '')}
          <span class="g">${esc(e.text)}</span>
          <span class="mu">${esc(e.created_at.slice(5, 10))}</span></div>`,
      ),
    )
    .join('');
}

/* ------------------------------------------------------- parent screens -- */

export function parentHome() {
  const c = child();
  const hist = c.hist || '';
  const board = S.data.board?.marks || [];
  const rank = board.find((r) => r.self)?.rank;
  const present = [...hist].filter((x) => x === 'P').length;

  return `
    ${topBar(c.name || '', `${t('grade')} ${c.grade ?? '–'} · ${c.area || ''}`)}
    <div class="row gap-s wrap">${[c.subject, c.curriculum].filter(Boolean).map((x) => pill(x, 't')).join('')}</div>
    ${nextClassCard()}
    ${tiles([
      { label: t('attendance'), value: `${R.attendancePct(hist)}%` },
      { label: t('average'), value: `${c.avg_pct ?? 0}%` },
      { label: t('rank'), value: rank ? `#${rank}` : '–' },
    ])}
    ${card(
      `${label(t('attendance'))}
       ${bar(R.attendancePct(hist))}
       ${muted(`${present} ${t('present').toLowerCase()} · ${hist.length - present} ${t('absent').toLowerCase()}`)}
       ${dots(hist)}
       <p class="mu mt-s">${esc(attendanceSentence(hist))}</p>`,
    )}
    ${progressChart()}
    ${card(
      `<div class="row sp">${label(t('leaderboard'))}${button(t('see_full_board'), {
        act: 'nav.tab',
        arg: 'board',
        cls: 'sm o',
      })}</div>
       ${segmented(
         [
           { value: 'marks', label: t('marks') },
           { value: 'attendance', label: t('attendance') },
         ],
         S.boardBy,
         'board.by',
       )}
       ${boardRows(S.data.board?.[S.boardBy] || [], { limit: 5 })}`,
    )}
    ${feesCard({ compact: true })}
    ${button(t('progress_report'), { act: 'nav.report', cls: 'o wide mt' })}
    <b class="h3">${esc(t('updates_from_teacher'))}</b>
    ${updatesFeed()}
  `;
}

export function parentBoard() {
  return `
    ${topBar(t('leaderboard'))}
    ${segmented(
      [
        { value: 'marks', label: t('marks') },
        { value: 'attendance', label: t('attendance') },
      ],
      S.boardBy,
      'board.by',
    )}
    ${boardRows(S.data.board?.[S.boardBy] || [])}
    <p class="mu note">${esc(t('privacy_note'))}</p>
  `;
}

export function parentClasses() {
  return `
    ${topBar(t('classes'))}
    ${weekClassList()}
    ${
      S.role === 'parent'
        ? button(t('ask_reschedule'), { act: 'family.reschedule', cls: 'o wide mt' })
        : ''
    }
  `;
}

export function parentFees() {
  const c = child();
  const payments = S.data.payments || [];
  return `
    ${topBar(t('fees'))}
    ${feesCard()}
    ${payments.length ? label(t('payments')) : ''}
    ${payments
      .map((p) =>
        card(
          `<div class="row sp"><span>${esc(`${p.paid_date} · ${p.method}`)}</span>
            <b style="color:var(--gt)">${esc(R.money(p.amount))}</b></div>`,
        ),
      )
      .join('')}
    ${muted(`${t('fee_per_class')}: ${R.money(c.fee_per_class)}`)}
  `;
}

export function parentReport() {
  const c = child();
  const hist = c.hist || '';
  const present = [...hist].filter((x) => x === 'P').length;
  const list = marks();
  return `
    <div class="row top-row">${backButton()}<h1>${esc(t('progress_report'))}</h1></div>
    ${card(`<div class="row">${avatar(c.name)}<div class="g"><b>${esc(c.name)}</b>${muted(
      `${t('grade')} ${c.grade ?? '–'} · ${c.school || ''}`,
    )}</div></div>`)}
    ${tiles([
      { label: t('attendance'), value: `${R.attendancePct(hist)}%`, caption: `${present}/${hist.length}` },
      { label: t('average'), value: `${c.avg_pct ?? 0}%` },
      { label: t('best'), value: `${c.best_pct ?? 0}%` },
    ])}
    ${progressChart()}
    ${
      list.length
        ? list
            .map((m) =>
              card(
                `<div class="row sp"><div class="g"><b>${esc(m.title)}</b>${muted(m.taken_on)}</div>
                  <b style="color:${R.markTextColour(R.markPct(m))}">${esc(`${m.score}/${m.max_score}`)}</b></div>`,
              ),
            )
            .join('')
        : emptyState(t('no_marks_yet'), '📝')
    }
    ${card(`${label(t('fees'))}${big(R.money(c.amount_due), `color:${Number(c.amount_due) ? 'var(--pt)' : 'var(--gt)'}`)}`)}
  `;
}

/* ------------------------------------------------------ student screens -- */

export function studentHome() {
  const c = child();
  const hist = c.hist || '';
  const pct = R.attendancePct(hist);
  const reached = pct >= R.ATTENDANCE_GOAL;
  const latest = marks()[marks().length - 1];
  const next = R.nextSession(S.data, S.today);

  return `
    ${topBar(`${t('home')}, ${String(c.name || '').split(' ')[0]}`)}
    ${card(
      `${label(t('up_next'))}
       ${big(
         next
           ? `${next.date === S.today ? t('today') : R.DAY_SHORT[R.weekday(next.date)]} ${R.hhmm(next.cls.start_time)}`
           : t('nothing_planned'),
         'margin:6px 0',
       )}
       ${next ? `<div>${esc(`${next.cls.subject} · ${next.cls.place || ''} · ${next.cls.duration_hours}h`)}</div>` : ''}`,
      { cls: 'hero' },
    )}
    ${tiles([
      { label: t('streak'), value: String(R.streak(hist)) },
      { label: t('average'), value: `${c.avg_pct ?? 0}%` },
      { label: t('present'), value: `${pct}%` },
    ])}
    ${card(
      `<div class="row sp"><b>${esc(t('goal_90', { pct: R.ATTENDANCE_GOAL }))}</b>
        ${pill(reached ? t('reached') : t('keep_going'), reached ? 'g' : 't')}</div>
       ${bar(pct)}
       <p class="mu mt-s">${esc(attendanceSentence(hist))}</p>`,
    )}
    ${
      latest
        ? card(
            `${label(t('latest_mark'))}<b class="blk-b">${esc(
              `${latest.title}: ${latest.score}/${latest.max_score}`,
            )}</b>`,
          )
        : ''
    }
    ${button(t('practice_papers'), { act: 'nav.tab', arg: 'papers', cls: 'o wide mt' })}
  `;
}

export function studentMarks() {
  const list = marks();
  const c = child();
  return `
    ${topBar(t('marks'))}
    <div class="tiles two">
      ${card(`${label(t('average'))}${big(`${c.avg_pct ?? 0}%`)}`)}
      ${card(`${label(t('best'))}${big(`${c.best_pct ?? 0}%`)}`)}
    </div>
    ${
      list.length
        ? card(
            barChart(
              list.map((m) => R.markPct(m)),
              { colours: list.map((m) => R.markColour(R.markPct(m))), labels: list.map((_, i) => String(i + 1)) },
            ),
          ) +
          list
            .map((m) =>
              card(
                `<div class="row sp"><div class="g"><b>${esc(m.title)}</b>${muted(m.taken_on)}</div>
                  <b style="color:${R.markTextColour(R.markPct(m))}">${esc(`${m.score}/${m.max_score}`)}</b></div>`,
              ),
            )
            .join('')
        : emptyState(t('no_marks_yet'), '📝')
    }
  `;
}

export function studentPapers() {
  const papers = S.data.papers || [];
  return `
    ${topBar(t('papers'))}
    ${
      papers.length
        ? papers
            .map((p) =>
              card(
                `<div class="row sp"><b class="g">${esc(p.name)}</b>${button(t('open'), {
                  act: 'family.paper',
                  arg: p.id,
                  cls: 'sm',
                })}</div>`,
              ),
            )
            .join('')
        : emptyState(t('no_papers_yet'), '📄')
    }
  `;
}

/* ------------------------------------------------------------ actions ---- */

async function reload(ctx, childId) {
  S.busy = true;
  try {
    S.data = await api.familyBootstrap(childId);
    S.today = S.data.today || R.todayLocal();
    S.teacher = S.data.teacher;
    S.children = S.data.children;
    S.childId = S.data.child_id;
  } finally {
    S.busy = false;
    ctx.render();
  }
}

export const ACTIONS = {
  'nav.tab': (tab, _el, ctx) => {
    S.tab = tab;
    S.sub = null;
    ctx.render();
  },
  'nav.report': (_a, _el, ctx) => {
    S.sub = { view: 'report' };
    ctx.render();
  },
  'board.by': (by, _el, ctx) => {
    S.boardBy = by === 'attendance' ? 'attendance' : 'marks';
    ctx.render();
  },

  'family.switch': () => {
    openSheet(`
      ${sheetTitle(t('switch_child'))}
      ${(S.children || [])
        .map((c) =>
          card(
            `<div class="row">${avatar(c.name)}<div class="g"><b>${esc(c.name)}</b>${muted(
              `${t('grade')} ${c.grade ?? '–'} · ${c.subject || ''}`,
            )}</div>${c.id === S.childId ? pill('✓', 'g') : ''}</div>`,
            { act: 'family.child', arg: c.id, cls: 'tap' },
          ),
        )
        .join('')}
      ${label(t('switch_role'))}
      ${segmented(
        [
          { value: 'parent', label: t('parent') },
          { value: 'student', label: t('student') },
        ],
        S.role,
        'family.role',
      )}
      ${button(t('done'), { act: 'sheet.close', cls: 'o wide mt' })}
    `);
  },

  'family.child': async (id, _el, ctx) => {
    closeSheet();
    await api.familyDo('child', { child_id: id });
    await reload(ctx, id);
  },

  'family.role': async (role, _el, ctx) => {
    closeSheet();
    const session = await api.switchRole(role);
    S.role = session.role;
    S.tab = 'home';
    S.sub = null;
    await reload(ctx);
  },

  'family.settings': () => {
    openSheet(`
      ${sheetTitle(t('settings'))}
      ${label(t('language'))}
      ${segmented(
        [
          { value: 'en', label: 'English' },
          { value: 'ta', label: 'தமிழ்' },
        ],
        S.lang,
        'family.lang',
      )}
      ${label(t('appearance'))}
      ${segmented(
        [
          { value: 'night', label: t('night') },
          { value: 'day', label: t('day_theme') },
          { value: 'auto', label: t('auto') },
        ],
        S.theme,
        'family.theme',
      )}
      ${(S.children || []).length > 1 ? button(t('switch_child'), { act: 'family.switch', cls: 'o wide' }) : ''}
      ${label(t('switch_role'))}
      ${segmented(
        [
          { value: 'parent', label: t('parent') },
          { value: 'student', label: t('student') },
        ],
        S.role,
        'family.role',
      )}
      ${button(t('done'), { act: 'sheet.close', cls: 'wide mt' })}
      ${button(t('log_out'), { act: 'auth.logout', cls: 'o wide' })}
    `);
  },

  'family.lang': async (lang, _el, ctx) => {
    S.lang = lang;
    savePrefs();
    const { setLang } = await import('../i18n.js');
    setLang(lang);
    applyTheme();
    ctx.render();
    ACTIONS['family.settings']();
  },

  'family.theme': (theme, _el, ctx) => {
    S.theme = theme;
    savePrefs();
    applyTheme();
    ctx.render();
    ACTIONS['family.settings']();
  },

  /** Rule 7.2.6 from the parent's side: send a photo of the transfer slip. */
  'family.slip': () => {
    openSheet(`
      ${sheetTitle(t('send_bank_slip'))}
      ${muted(t('choose_slip_photo'))}
      <input id="slip-file" type="file" accept="image/png,image/jpeg,image/webp" capture="environment">
      <div id="slip-preview"></div>
      ${sheetActions('family.sendslip', t('send'))}
    `);
  },

  'family.sendslip': async (_a, _el, ctx) => {
    const input = document.getElementById('slip-file');
    const file = input?.files?.[0];
    if (!file) return toast(t('choose_slip_photo'), 'bad');
    try {
      const image = await shrinkImage(file);
      await api.familyDo('slip', { image });
      closeSheet();
      await reload(ctx);
      toast(t('slip_sent'));
    } catch (err) {
      toast(err.message, 'bad');
    }
  },

  'family.reschedule': () => {
    const week = R.weekSessions(S.data, S.today).filter((s) => s.date >= S.today);
    openSheet(`
      ${sheetTitle(t('ask_reschedule'))}
      ${
        week.length
          ? `<label class="fld"><span class="lbl">${esc(t('classes'))}</span>
              <select id="rs-class">${week
                .map(
                  (s) =>
                    `<option value="${esc(`${s.cls.id}|${s.date}`)}">${esc(
                      `${R.DAY_SHORT[R.weekday(s.date)]} ${R.hhmm(s.cls.start_time)} · ${s.cls.title}`,
                    )}</option>`,
                )
                .join('')}</select></label>`
          : ''
      }
      <label class="fld"><span class="lbl">${esc(t('ask_reschedule'))}</span>
        <textarea id="rs-note" rows="3" placeholder="${esc(t('ask_reschedule'))}"></textarea></label>
      ${sheetActions('family.sendreschedule', t('send'))}
    `);
  },

  'family.sendreschedule': async (_a, _el, ctx) => {
    const pick = document.getElementById('rs-class')?.value || '';
    const [classId, date] = pick.split('|');
    try {
      await api.familyDo('reschedule', {
        class_id: classId || null,
        date: date || null,
        note: document.getElementById('rs-note')?.value || '',
      });
      closeSheet();
      await reload(ctx);
      toast(t('reschedule_sent'));
    } catch (err) {
      toast(err.message, 'bad');
    }
  },

  'family.paper': async (id) => {
    try {
      const { url } = await api.familyDo('paper.link', { paper_id: id });
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      toast(err.message, 'bad');
    }
  },
};

/** Keep the upload small so it works on a slow connection. */
function shrinkImage(file, maxSide = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that photo'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image'));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ----------------------------------------------------------- registries -- */

export const PARENT_TABS = [
  { key: 'home', label: 'home', glyph: '⌂' },
  { key: 'board', label: 'board', glyph: '🏆' },
  { key: 'classes', label: 'classes', glyph: '▦' },
  { key: 'fees', label: 'fees', glyph: '৳' },
];

export const PARENT_VIEWS = {
  home: parentHome,
  board: parentBoard,
  classes: parentClasses,
  fees: parentFees,
};

export const STUDENT_TABS = [
  { key: 'home', label: 'home', glyph: '⌂' },
  { key: 'classes', label: 'classes', glyph: '▦' },
  { key: 'marks', label: 'marks', glyph: '✓' },
  { key: 'papers', label: 'papers', glyph: '📄' },
];

export const STUDENT_VIEWS = {
  home: studentHome,
  classes: parentClasses,
  marks: studentMarks,
  papers: studentPapers,
};

export const SUBS = { report: parentReport };

export { reload as reloadFamily };
