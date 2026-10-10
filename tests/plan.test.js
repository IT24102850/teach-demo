/**
 * The improvement plan, point by point, as runnable tests:  npm test
 *
 * Each test is named after the point it checks and asserts that point's own
 * "Done when" line from the plan, so a change that quietly undoes one of them
 * fails here rather than on someone's phone.
 *
 * What these can and cannot prove:
 *  - the rules, the wording, the generated HTML and the stylesheet are all
 *    checked here, on every run, with no database and no network;
 *  - point 1's timings ("first screen under 2 seconds on 4G") are measured on
 *    a real device, not here. What is checked here is the thing that makes
 *    them possible: no render-blocking font request, a skeleton instead of a
 *    blank page, and a debounced search.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as CR from '../app/rules.js';
import * as SR from '../api/_lib/rules.js';
import { render as message } from '../api/_lib/templates.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const CSS = read('style.css');
const INDEX = read('index.html');
const JOIN_HTML = read('join.html');

/* =========================================================================
   Point 1 and 7 · lag, loading and saving
   ========================================================================= */

test('point 1: nothing render-blocking waits on Google Fonts', () => {
  for (const [name, html] of [
    ['index.html', INDEX],
    ['join.html', JOIN_HTML],
  ]) {
    assert.doesNotMatch(
      html,
      /<link[^>]+rel="stylesheet"[^>]+fonts\.googleapis\.com/,
      `${name} still blocks the first paint on the font stylesheet`,
    );
  }
  // It is attached after the first paint instead, and swaps when it lands.
  const fonts = read('app/fonts.js');
  assert.match(fonts, /fonts\.googleapis\.com/);
  assert.match(fonts, /display=swap/);
  assert.match(read('app/main.js'), /loadFonts\(\)/);
});

test('point 1: the font link is added from JS, which the CSP allows', () => {
  // script-src is 'self', so an inline onload handler would be blocked and the
  // page would sit on the system font for ever.
  assert.doesNotMatch(INDEX, /onload=/, 'index.html must not use an inline handler');
  assert.doesNotMatch(JOIN_HTML, /onload=/, 'join.html must not use an inline handler');
  assert.match(read('vercel.json'), /script-src 'self'/);
});

test('point 1: the first screen is a skeleton, never a blank page', () => {
  const main = read('app/main.js');
  assert.match(main, /if \(S\.loading\) return skeleton\(\)/);
  assert.match(main, /if \(!role \|\| !S\.data\) return skeleton\(\)/);
  assert.match(CSS, /\.skel\s*\{/);
});

test('point 1: the student search waits for the typing to stop', () => {
  const teacher = read('app/screens/teacher.js');
  assert.match(teacher, /setTimeout\([^)]*\n?[\s\S]{0,400}?\}, 200\)/, 'a 200 ms debounce');
  // Only the list is replaced, so the box keeps the caret and drops no letter.
  assert.match(teacher, /getElementById\('student-list'\)/);
  assert.doesNotMatch(
    teacher.slice(teacher.indexOf('export function after')),
    /ctx\.render\(\)/,
    'typing must not redraw the whole screen',
  );
});

test('points 2 and 7: one tap is one write, and slow saves say so', () => {
  const main = read('app/main.js');
  assert.match(main, /if \(el\?\.dataset\?\.busy\) return;/, 'a second tap is dropped');
  assert.match(main, /el\.dataset\.busy = '1'/);
  assert.match(main, /still_saving/, 'a save over 3 seconds says it is still going');
});

/* =========================================================================
   Point 2 · the Submit button
   ========================================================================= */

test('point 2: Back and Submit are pinned above the keyboard and the home bar', () => {
  assert.match(CSS, /\.footer-bar\s*\{[\s\S]*?position: absolute;[\s\S]*?bottom: 0;/);
  assert.match(CSS, /\.footer-bar\s*\{[\s\S]*?var\(--safe-b\)/, 'clear of the iPhone home bar');
  // The content reserves the same height, so the last field is never hidden.
  assert.match(CSS, /\.has-footer\s*\{[\s\S]*?padding-bottom:/);
  assert.match(read('app/join.js'), /host\.className = 'has-footer'/);
});

test('point 2: the last step says Submit and the earlier ones say Next', () => {
  const join = read('app/join.js');
  assert.match(join, /last \? \(form\.failed \? t\('try_again'\) : t\('submit'\)\) : t\('next'\)/);
});

test('point 2: a failed submit keeps everything typed and offers Try again', () => {
  const join = read('app/join.js');
  assert.match(join, /form\.failed = err\.message/);
  // `form` is module state, not read back out of the DOM, so a redraw after a
  // failure cannot lose an answer.
  assert.doesNotMatch(join, /form\.name = ''/);
});

/* =========================================================================
   Point 3 · the mobile number
   ========================================================================= */

test('point 3: typing 0771234567 gives 94771234567', () => {
  assert.equal(CR.toLkMobile('0771234567'), '94771234567');
  assert.equal(SR.toLkMobile('0771234567'), '94771234567');
});

test('point 3: every shape a person can type lands on the same stored number', () => {
  for (const typed of [
    '0771234567',
    '077 123 4567',
    '77 123 4567',
    '771234567',
    '+94 77 123 4567',
    '+94771234567',
    '94771234567',
    '0094771234567',
    '  077-123-4567  ',
  ]) {
    assert.equal(CR.toLkMobile(typed), '94771234567', `${typed} should normalise`);
    assert.equal(SR.toLkMobile(typed), '94771234567', `${typed} should normalise on the server too`);
  }
});

test('point 3: typing 12345 is refused with "9 digits starting with 7"', () => {
  assert.equal(CR.toLkMobile('12345'), null);
  assert.equal(CR.lkMobileError('12345'), 'tel_start7');
  assert.equal(CR.lkMobileError('7712345'), 'tel_nine');
  assert.equal(CR.lkMobileError(''), 'empty');
  assert.equal(CR.lkMobileError('771234567'), null);
});

test('point 3: a landline or a foreign number is not a Sri Lankan mobile', () => {
  for (const bad of ['0112345678', '0812233445', '+44 7700 900123', '', null, undefined, 'abc']) {
    assert.equal(CR.toLkMobile(bad), null, `${bad} should be refused`);
  }
});

test('point 3: stored as digits, shown to people as +94 77 123 4567', () => {
  assert.equal(CR.formatLkMobile('94771234567'), '+94 77 123 4567');
  assert.equal(SR.formatLkMobile('94771234567'), '+94 77 123 4567');
  // The box itself groups the national part as it is typed.
  assert.equal(CR.groupLkMobile('0771234567'), '77 123 4567');
  assert.equal(CR.groupLkMobile('7'), '7');
  assert.equal(CR.groupLkMobile('7712'), '77 12');
});

test('point 3: the field is a number pad with a fixed +94 beside it', () => {
  const ui = read('app/ui.js');
  assert.match(ui, /inputmode="numeric"/);
  assert.match(ui, /\+94/);
  assert.match(CSS, /\.tel-cc\s*\{/);
});

test('point 3: the same rule applies everywhere a number is entered', () => {
  const api = read('api/teacher.js');
  // Adding a student by hand, and editing one, both go through toLkMobile.
  assert.equal((api.match(/R\.toLkMobile\(body\.parent_phone\)/g) || []).length, 2);
  assert.match(read('api/join.js'), /toLkMobile\(body\.parent_phone\)/);
  assert.match(read('app/screens/teacher-forms.js'), /telValue\('s-phone'\)/);
});

/* =========================================================================
   Point 4 · no zoom
   ========================================================================= */

test('point 4: the viewport is locked on both pages', () => {
  for (const [name, html] of [
    ['index.html', INDEX],
    ['join.html', JOIN_HTML],
  ]) {
    const meta = /<meta\s+name="viewport"[\s\S]*?>/.exec(html);
    assert.ok(meta, `${name} has no viewport meta`);
    assert.match(meta[0], /maximum-scale=1/, name);
    assert.match(meta[0], /user-scalable=no/, name);
    assert.match(meta[0], /viewport-fit=cover/, name);
  }
});

test('point 4: every text box is 16px, which is what stops the iOS jump-zoom', () => {
  const rule = /input,\s*select,\s*textarea\s*\{[^}]*\}/.exec(CSS);
  assert.ok(rule, 'no shared rule for the form controls');
  assert.match(rule[0], /font-size: 16px/);
});

test('point 4: double-tap zoom is off and nothing scrolls sideways', () => {
  assert.match(CSS, /touch-action: manipulation/);
  assert.match(CSS, /overflow-x: hidden/);
});

test('point 4: the app installs full screen', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.display, 'standalone');
  assert.match(INDEX, /apple-mobile-web-app-capable/);
});

/* =========================================================================
   Point 5 · the full-screen code entry
   ========================================================================= */

test('point 5: the keys are at least 72px and carry their letters', () => {
  const pad = /\.pad\s*\{[^}]*\}/.exec(CSS);
  assert.match(pad[0], /repeat\(3, 72px\)/, 'a 3-column grid of 72px keys');
  assert.match(CSS, /\.pad button\s*\{[\s\S]*?height: 72px/);
  const login = read('app/screens/login.js');
  for (const letters of ['ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQRS', 'TUV', 'WXYZ']) {
    assert.match(login, new RegExp(`'${letters}'`), `the ${letters} key`);
  }
});

test('point 5: nothing else is on the screen', () => {
  const login = read('app/screens/login.js');
  const lock = login.slice(login.indexOf('function lockScreen'), login.indexOf('export const view'));
  assert.match(lock, /class="lock"/);
  assert.doesNotMatch(lock, /class="card/, 'no cards on a lock screen');
  assert.doesNotMatch(lock, /logo\.png/, 'no logo either');
  assert.match(lock, /lock-role/, 'the role label at the top');
  assert.match(lock, /forgot_code/);
  assert.match(lock, /cancel/);
  // The bottom row and the keypad both stay clear of the notch and home bar.
  assert.match(CSS, /\.lock\s*\{[\s\S]*?var\(--safe-t\)[\s\S]*?var\(--safe-b\)/);
});

test('point 5: the last digit checks the code, with no Enter button', () => {
  const login = read('app/screens/login.js');
  assert.match(login, /if \(L\.pin\.length === S\.codeLength\) await submit\(ctx\)/);
  assert.doesNotMatch(login, /'enter'|Enter<\/button>/i);
});

test('point 5: five wrong codes cost 30 seconds, then longer', () => {
  const login = read('app/screens/login.js');
  assert.match(login, /const LOCK_AFTER = 5/);
  assert.match(login, /30 \* 2 \*\* Math\.max\(0, strikes - LOCK_AFTER\)/);
  assert.match(login, /navigator\.vibrate/, 'the phone buzzes where it may');
  assert.match(login, /L\.shake = true/);
});

/* =========================================================================
   Point 6 · alignment
   ========================================================================= */

test('point 6: there is one spacing scale and the controls have one height', () => {
  for (const token of ['--s1: 4px', '--s2: 8px', '--s3: 12px', '--s4: 16px', '--s5: 24px', '--s6: 32px']) {
    assert.match(CSS, new RegExp(token.replace(/[-]/g, '\\-')), token);
  }
  assert.match(CSS, /--gutter: 20px/, '20px side margins');
  assert.match(CSS, /--fld-h: 50px/, 'all text boxes 50px high');
  assert.match(CSS, /--btn-h: 54px/, '54px main buttons');
  assert.match(CSS, /--btn-h-card: 46px/, '46px inside a card');
});

test('point 6: a label sits 6px above its box, with 14px between fields', () => {
  assert.match(CSS, /\.fld\s*\{[^}]*margin: 0 0 14px/);
  assert.match(CSS, /\.fld \.lbl\s*\{[^}]*margin-bottom: 6px/);
});

test('point 6: two buttons side by side share the width, 10px apart', () => {
  assert.match(CSS, /\.row\.gap\s*\{[^}]*gap: 10px/);
  assert.match(CSS, /\.row\.gap > \.btn\s*\{[^}]*flex: 1 1 0/);
});

test('point 6: money uses equal-width digits so the columns line up', () => {
  assert.match(CSS, /\.amt\s*\{[^}]*font-variant-numeric: tabular-nums/);
  assert.match(CSS, /\.big\s*\{[^}]*font-variant-numeric: tabular-nums/);
});

test('point 6: every screen pads for the status bar and the home bar', () => {
  assert.match(CSS, /--safe-t: env\(safe-area-inset-top/);
  assert.match(CSS, /--safe-b: env\(safe-area-inset-bottom/);
});

/* =========================================================================
   Point 8 and 15 · the four-step registration
   ========================================================================= */

const W = await import('../app/join-steps.js');

/** A set of answers with step 1 to 3 all filled in correctly. */
const answers = (over = {}) => ({
  ...W.emptyAnswers(),
  curricula: ['Local', 'Cambridge'],
  name: 'Kasun Perera',
  call_name: 'Kasun',
  grade: '11',
  curriculum: 'Local',
  wanted: ['Maths'],
  parent_name: 'Nadeesha Perera',
  phone: '0771234567',
  ...over,
});

test('point 8: there are four steps', () => {
  assert.equal(W.TOTAL, 4);
  assert.equal(W.STEPS.length, 4);
});

test('point 8: Next checks only the step in front of the person', () => {
  const blank = { ...W.emptyAnswers(), curricula: ['Local', 'Cambridge'] };

  // An empty form complains about step 1 only - not about steps 2 and 3.
  assert.deepEqual(Object.keys(W.problems(blank, 1)).sort(), ['j-call', 'j-grade', 'j-name']);
  assert.ok(!W.stepOk(blank, 1));

  const one = { ...blank, name: 'Kasun Perera', call_name: 'Kasun', grade: '11' };
  assert.ok(W.stepOk(one, 1), 'step 1 is answered');
  assert.ok(!W.stepOk(one, 2), 'but step 2 has not been touched');

  const two = { ...one, curriculum: 'Local', wanted: ['Maths'] };
  assert.ok(W.stepOk(two, 2));
  assert.ok(!W.stepOk(two, 3));

  const three = { ...two, parent_name: 'Nadeesha Perera', phone: '0771234567' };
  assert.ok(W.stepOk(three, 3));
  assert.ok(W.stepOk(three, 4), 'the check page asks for nothing');
  assert.equal(W.firstUnfinished(three), null);
});

test('point 8: a bad phone number blocks step 3 with the right reason', () => {
  assert.equal(W.problems(answers({ phone: '12345' }), 3)['j-phone'], 'tel_start7');
  assert.equal(W.problems(answers({ phone: '' }), 3)['j-phone'], 'tel_nine');
  assert.equal(W.problems(answers({ phone: '7712345' }), 3)['j-phone'], 'tel_nine');
  assert.deepEqual(W.problems(answers({ phone: '+94 77 123 4567' }), 3), {});
});

test('point 8: grade is chosen from a list, 1 to 13, not typed', () => {
  for (const [grade, ok] of [
    ['0', false],
    ['1', true],
    ['13', true],
    ['14', false],
    ['', false],
    ['abc', false],
    ['7.5', false],
  ]) {
    assert.equal(W.stepOk(answers({ grade }), 1), ok, `grade ${grade}`);
  }
  assert.match(read('app/join.js'), /selectField\(\s*'j-grade'/, 'a list, not a text box');
});

test('point 8: the curriculum question is skipped when the teacher offers one', () => {
  const one = answers({ curricula: ['Local'], curriculum: '' });
  assert.ok(W.stepOk(one, 2), 'nothing to choose, so nothing to answer');
  const many = answers({ curricula: ['Local', 'Cambridge'], curriculum: '' });
  assert.equal(W.problems(many, 2).curriculum, 'curriculum');
});

test('point 8: the short name follows the first name until it is edited', () => {
  assert.equal(W.suggestCallName({ name: 'Kasun Perera', call_name: '' }), 'Kasun');
  assert.equal(W.suggestCallName({ name: 'Kasun Perera', call_name: 'Kasun' }), 'Kasun');
  assert.equal(
    W.suggestCallName({ name: 'Kasun Perera', call_name: 'Kasu', callTouched: true }),
    'Kasu',
    'once they type their own, it is left alone',
  );
});

test('point 8: Back never loses an answer', () => {
  // Every answer lives in one object that redrawing never clears, so walking
  // back and forth cannot drop one.
  const join = read('app/join.js');
  assert.match(join, /function capture\(\)/);
  assert.match(join, /'step\.back'/);
  assert.doesNotMatch(join, /form = \{\s*\}/, 'the answers object is never reset mid-form');
});

test('point 15: the join form asks for exactly the pasted field list', () => {
  const join = read('app/join.js');
  for (const id of ['j-name', 'j-call', 'j-grade', 'j-school', 'j-ambition', 'j-parent', 'j-phone', 'j-job']) {
    assert.match(join, new RegExp(`'${id}'`), `${id} is missing from the form`);
  }
  assert.doesNotMatch(join, /Preview only/i, 'the preview line is gone from the real form');
});

test('point 8: the photo is optional and shrunk on the phone before sending', () => {
  const join = read('app/join.js');
  assert.match(join, /const PHOTO_PX = 320/);
  assert.match(join, /toDataURL\('image\/jpeg'/);
  // And the server refuses anything that is not a small picture.
  assert.match(read('api/join.js'), /MAX_PHOTO_BYTES/);
});

/* =========================================================================
   Point 9 · the calendar
   ========================================================================= */

test('point 9: the month view has an agenda and a "+" button', () => {
  const teacher = read('app/screens/teacher.js');
  assert.match(teacher, /export function agenda\(date\)/);
  assert.match(teacher, /\$\{agenda\(S\.cal\.date\)\}/, 'the agenda sits under the month grid');
  assert.match(teacher, /class="fab"/);
  assert.match(CSS, /\.fab\s*\{/);
  // It must float over the frame, not scroll away inside the calendar.
  assert.match(teacher, /export function overlay\(\)/);
  assert.match(read('index.html'), /id="over"/);
  assert.match(read('app/main.js'), /role\?\.overlay/);
});

test('point 9: tapping an empty slot starts a class at that day and time', () => {
  const teacher = read('app/screens/teacher.js');
  assert.match(teacher, /data-a="class\.quick" data-i="\$\{esc\(`\$\{date\}\|\$\{time\}`\)\}"/);
  const forms = read('app/screens/teacher-forms.js');
  assert.match(forms, /'class\.quick': \(arg\) => \{/);
  assert.match(forms, /once_date: date,\s*\n\s*start_time: time,/);
});

test('point 9: the month and year title opens a picker', () => {
  assert.match(read('app/screens/teacher.js'), /data-a="cal\.jump"/);
  assert.match(read('app/screens/teacher-forms.js'), /'cal\.jumpto':/);
});

test('point 9: a class can be edited from its own screen', () => {
  assert.match(read('app/screens/teacher.js'), /act: 'class\.edit'/);
  assert.match(read('app/screens/teacher-forms.js'), /'class\.edit':/);
  assert.match(read('api/teacher.js'), /case 'class\.update':/);
});

test('point 9: the subject colours are the same everywhere', () => {
  assert.equal(CR.SUBJECT_COLOUR.Maths, 'var(--teal)');
  assert.equal(CR.SUBJECT_COLOUR.Science, 'var(--green)');
  assert.equal(CR.SUBJECT_COLOUR.English, 'var(--pink)');
});

/* =========================================================================
   Point 10 · start, end and the absent message
   ========================================================================= */

test('point 10: a session is Scheduled, then In progress, then Ended', () => {
  assert.equal(CR.sessionState(null), 'scheduled');
  assert.equal(CR.sessionState({}), 'scheduled');
  assert.equal(CR.sessionState({ started_at: '2026-10-08T10:32:00Z' }), 'running');
  assert.equal(
    CR.sessionState({ started_at: '2026-10-08T10:32:00Z', ended_at: '2026-10-08T13:01:00Z', done: true }),
    'ended',
  );
  assert.equal(CR.sessionState({ cancelled: true }), 'cancelled');
});

test('point 10: an ended class shows its real start, end and duration', () => {
  const session = { started_at: '2026-10-08T10:32:00Z', ended_at: '2026-10-08T13:01:00Z' };
  assert.equal(CR.taughtMinutes(session), 149);
  assert.equal(SR.taughtMinutes(session), 149);
  assert.equal(CR.durationLabel(149 / 60), '2 h 29 m');
  assert.match(CR.realRange(session), /^\d{1,2}:\d{2} – \d{1,2}:\d{2} (AM|PM)$/);
});

test('point 10: a class with no real times falls back to the scheduled length', () => {
  assert.equal(CR.taughtMinutes({}), null);
  assert.equal(CR.taughtMinutes({ started_at: 'x', ended_at: 'y' }), null);
  assert.equal(CR.taughtMinutes({ started_at: '2026-10-08T13:01:00Z', ended_at: '2026-10-08T10:32:00Z' }), null);
});

test('point 10: the timer counts from the real start', () => {
  const since = new Date(Date.now() - 3661_000).toISOString();
  assert.equal(CR.elapsed(since), '01:01:01');
  assert.equal(CR.elapsed(null), '00:00:00');
  assert.equal(CR.elapsed('2026-10-08T10:00:00Z', '2026-10-08T10:00:42Z'), '00:00:42');
});

test('point 10: the absent message names the teacher, the class and the time', () => {
  const text = message(
    'absent',
    { teacher: 'Nimal Sir', student: 'Kasun', class: 'Grade 11 Maths class', time: '4:00 PM' },
    'en',
  );
  assert.match(text, /Hi, this is Nimal Sir\./);
  assert.match(text, /Kasun was absent from today's Grade 11 Maths class \(4:00 PM\)/);
  assert.match(text, /Please let me know if there is a problem\. Thank you\./);
  // Tamil says the same thing.
  const ta = message('absent', { teacher: 'Nimal Sir', student: 'Kasun', class: 'Maths', time: '4:00 PM' }, 'ta');
  assert.match(ta, /Kasun/);
  assert.match(ta, /4:00 PM/);
});

test('point 10: each absent student gets exactly one message', () => {
  // A parent told with "Send now" during the class is listed in
  // already_notified and is skipped when the class ends.
  const api = read('api/teacher.js');
  assert.match(api, /const alreadyTold = new Set\(/);
  assert.match(api, /const toTell = absent\.filter\(\(id\) => !alreadyTold\.has\(id\)\)/);
  assert.match(read('app/screens/teacher-forms.js'), /already_notified: told/);
});

test('point 10: pressing Start twice does not restart the clock', () => {
  assert.match(read('supabase/schema.sql'), /do update set started_at = coalesce\(sessions\.started_at, now\(\)\)/);
});

test('point 10: a class left running past its end time is nudged once', () => {
  const main = read('app/main.js');
  assert.match(main, /function remindToEnd\(\)/);
  assert.match(main, /nudged\.has\(session\.key\)/, 'one nudge, not one a minute');
  assert.match(main, /still_running/);
  // Nothing is ended on the teacher's behalf: the hours are billed on these
  // times, so only they may close the class.
  assert.doesNotMatch(main, /attendance\.finish/);
});

test('point 9: a repeating class asks "this day only" or "all days"', () => {
  const forms = read('app/screens/teacher-forms.js');
  assert.match(forms, /which_days_edit/);
  assert.match(forms, /'class\.editscope':/);
  assert.match(forms, /this_day_only/);
  assert.match(forms, /all_days/);
  // "This day only" makes a one-off and cancels the repeat for that date, so
  // the student is never booked twice.
  assert.match(forms, /classForm\.replaces/);
  assert.match(forms, /api\.teacherDo\('class\.skip', \{/);
});

test('point 1: only the login screen is in the first download', () => {
  const main = read('app/main.js');
  assert.match(main, /import\('\.\/screens\/teacher\.js'\)/, 'the teacher app is fetched later');
  assert.match(main, /import\('\.\/screens\/family\.js'\)/);
  assert.doesNotMatch(main, /from '\.\/screens\/teacher\.js'/, 'and not in the first bundle');
  assert.doesNotMatch(main, /from '\.\/screens\/family\.js'/);
  assert.match(main, /from '\.\/screens\/login\.js'/, 'the login screen is');
});

test('point 1: a date\'s sessions are worked out once and reused', () => {
  const rules = read('app/rules.js');
  assert.match(rules, /const sessionCache = new WeakMap\(\)/);
  assert.match(rules, /export function forgetSessions/);
  // The cache must go when the sessions list is changed in place.
  assert.match(read('app/screens/teacher-forms.js'), /R\.forgetSessions\(S\.data\)/);
});

test('point 10: the times can be corrected afterwards', () => {
  const api = read('api/teacher.js');
  assert.match(api, /case 'attendance\.fix_times':/);
  assert.match(api, /The class cannot end before it started/);
});

/* =========================================================================
   Point 11 · fees
   ========================================================================= */

test('point 11: a part payment of 2,000 on 6,000 leaves 4,000', () => {
  const out = CR.paymentOutcome(6000, 2000);
  assert.equal(out.paid, 2000);
  assert.equal(out.balance, 4000);
  assert.equal(out.full, false);
  assert.deepEqual(SR.paymentOutcome(6000, 2000), out);
});

test('point 11: paying the whole bill clears the balance', () => {
  const out = CR.paymentOutcome(6000, 6000);
  assert.equal(out.balance, 0);
  assert.equal(out.full, true);
});

test('point 11: an over-payment is clamped and never becomes a credit', () => {
  assert.equal(CR.paymentOutcome(6000, 60000).paid, 6000);
  assert.equal(CR.paymentOutcome(6000, 60000).balance, 0);
});

test('point 11: an empty or zero amount is refused', () => {
  assert.equal(CR.paymentError(6000, 0), 'enter_amount');
  assert.equal(CR.paymentError(6000, -5), 'enter_amount');
  assert.equal(CR.paymentError(6000, ''), 'enter_amount');
  assert.equal(CR.paymentError(0, 1000), 'nothing_owed');
  assert.equal(CR.paymentError(6000, 2000), null);
});

test('point 11: the receipt number is padded to four digits', () => {
  assert.equal(CR.receiptNo(12), '#0012');
  assert.equal(CR.receiptNo(1), '#0001');
  assert.equal(CR.receiptNo(10000), '#10000');
  assert.equal(SR.receiptNo(12), '#0012');
});

test('point 11: the receipt message carries the number and what is left', () => {
  const part = message('paid', { student: 'Kasun', amount: 2000, receipt: '#0012', balance: 4000 }, 'en');
  assert.match(part, /LKR 2,000/);
  assert.match(part, /#0012/);
  assert.match(part, /Still to pay: LKR 4,000/);

  const full = message('paid', { student: 'Kasun', amount: 6000, receipt: '#0013', balance: 0 }, 'en');
  assert.doesNotMatch(full, /Still to pay/, 'nothing left to say when it is settled');
});

test('point 11: Undo reverses, it never deletes', () => {
  const sql = read('supabase/schema.sql');
  assert.match(sql, /update payments set reversed_at = now\(\)/);
  assert.doesNotMatch(sql, /delete from payments/);
  // And a reversed payment stops counting towards what was collected.
  assert.match(sql, /from payments where reversed_at is null group by student_id/);
  assert.match(sql, /from payments where reversed_at is null group by teacher_id/);
});

test('point 11: Undo is offered for ten seconds, then from the history', () => {
  const forms = read('app/screens/teacher-forms.js');
  assert.match(forms, /function paidSheet\(student, result, secondsLeft = 10\)/);
  assert.match(forms, /'fees\.undo':/);
  assert.match(read('app/screens/teacher.js'), /function paymentHistory\(studentId\)/);
});

test('point 11: Cash, Bank transfer and Online are all accepted', () => {
  assert.match(read('api/teacher.js'), /\['Cash', 'Bank transfer', 'Online', 'Slip'\]/);
  assert.match(read('supabase/schema.sql'), /check \(method in \('Bank transfer','Cash','Online','Slip'\)\)/);
});

/* =========================================================================
   Point 12 · individual or group
   ========================================================================= */

test('point 12: an individual class cannot hold two students', () => {
  const base = { days: [1], start_time: '16:00', duration_hours: 1, area: 'Nugegoda' };
  assert.equal(CR.classDraftError({ ...base, kind: 'individual', student_ids: ['a'] }), null);
  assert.equal(
    CR.classDraftError({ ...base, kind: 'individual', student_ids: ['a', 'b'] }),
    'individual_one_student',
  );
});

test('point 12: a group class cannot hold one, or be saved without a venue', () => {
  const base = { days: [1], start_time: '16:00', duration_hours: 1 };
  assert.equal(
    CR.classDraftError({ ...base, kind: 'group', student_ids: ['a'], venue_type: 'institute', venue_name: 'X', area: 'N' }),
    'group_two_students',
  );
  assert.equal(
    CR.classDraftError({ ...base, kind: 'group', student_ids: ['a', 'b'], venue_type: 'institute', area: 'N' }),
    'enter_institute',
  );
  assert.equal(
    CR.classDraftError({ ...base, kind: 'group', student_ids: ['a', 'b'], venue_type: 'own_place', area: '' }),
    'enter_area',
  );
  assert.equal(
    CR.classDraftError({ ...base, kind: 'group', student_ids: ['a', 'b'], venue_type: 'own_place', area: 'Nugegoda' }),
    null,
  );
});

test('point 12: the kind is stored, and only guessed for an older class', () => {
  assert.equal(CR.classKind({ kind: 'group', student_ids: ['a'] }), 'group', 'the stored value wins');
  assert.equal(CR.classKind({ student_ids: ['a'] }), 'individual', 'an old class falls back to the count');
  assert.equal(CR.classKind({ student_ids: ['a', 'b'] }), 'group');
  assert.equal(SR.classKind({ kind: 'individual', student_ids: ['a', 'b'] }), 'individual');
});

test('point 12: the venue reads the way it was entered', () => {
  assert.equal(
    CR.venueLabel({ venue_type: 'institute', venue_name: 'Bright Minds Institute', area: 'Nugegoda' }),
    'Bright Minds Institute · Nugegoda',
  );
  assert.equal(CR.venueLabel({ venue_type: 'own_place', area: 'Nugegoda' }), 'My home · Nugegoda');
  assert.equal(
    CR.venueLabel({ venue_type: 'own_place', area: 'Nugegoda' }, { ownPlaceName: 'My studio' }),
    'My studio · Nugegoda',
  );
  assert.equal(CR.venueLabel({ venue_type: 'area', area: 'Dehiwala' }), 'Dehiwala');
  assert.equal(CR.venueLabel({ place: 'Kotte' }), 'Kotte', 'an older class still reads');
});

test('point 12: "my own place" is typed once in Settings', () => {
  assert.match(read('app/screens/teacher-forms.js'), /'settings\.place':/);
  assert.match(read('api/teacher.js'), /patch\.own_place_name/);
  assert.match(read('supabase/schema.sql'), /own_place_name/);
});

/* =========================================================================
   Point 13 · the time slot
   ========================================================================= */

test('point 13: 4:00 PM plus 2.5 h shows 4:00 PM – 6:30 PM', () => {
  assert.equal(CR.slotLabel('16:00', 2.5), '4:00 PM – 6:30 PM');
  assert.equal(CR.durationLabel(2.5), '2 h 30 m');
  assert.equal(CR.durationLabel(2), '2 h');
  assert.equal(CR.durationLabel(0.5), '30 m');
});

test('point 13: the clock reads the way people say it', () => {
  assert.equal(CR.clock12('00:00'), '12:00 AM');
  assert.equal(CR.clock12('09:05'), '9:05 AM');
  assert.equal(CR.clock12('12:00'), '12:00 PM');
  assert.equal(CR.clock12('16:30'), '4:30 PM');
  assert.equal(CR.clock12('23:59'), '11:59 PM');
});

test('point 13: the start chips run every half hour from 6:00 to 21:00', () => {
  const chips = CR.startChoices();
  assert.equal(chips[0], '06:00');
  assert.equal(chips[chips.length - 1], '21:00');
  assert.equal(chips.length, 31);
  assert.deepEqual(CR.DURATION_CHOICES, [1, 1.5, 2, 2.5, 3]);
});

test('point 13: a class 6:30 – 7:30 does not clash with 4:00 – 6:30', () => {
  const existing = [{ id: 'a', days: [2], start_time: '16:00', duration_hours: 2.5, active: true }];
  assert.equal(CR.findClash(existing, { days: [2], start_time: '18:30', duration_hours: 1 }), null);
  assert.equal(SR.findClash(existing, { days: [2], start_time: '18:30', duration_hours: 1 }), null);
  // One minute inside it does clash.
  assert.ok(CR.findClash(existing, { days: [2], start_time: '18:00', duration_hours: 1 }));
});

test('point 13: the clash check covers one-time classes too', () => {
  const weekly = [{ id: 'a', days: [3], start_time: '17:30', duration_hours: 2, active: true, start_date: '2026-01-01' }];
  // 8 October 2026 is a Thursday.
  assert.equal(CR.findClash(weekly, { once_date: '2026-10-08', start_time: '18:00', duration_hours: 1 }).id, 'a');
  assert.equal(CR.findClash(weekly, { once_date: '2026-10-07', start_time: '18:00', duration_hours: 1 }), null);

  const once = [{ id: 'b', once_date: '2026-10-09', start_time: '10:00', duration_hours: 1, active: true }];
  assert.equal(CR.findClash(once, { once_date: '2026-10-09', start_time: '10:30', duration_hours: 1 }).id, 'b');
  assert.equal(CR.findClash(once, { once_date: '2026-10-10', start_time: '10:30', duration_hours: 1 }), null);
});

test('point 13: a skipped day is not a clash', () => {
  const weekly = [
    { id: 'a', days: [3], start_time: '17:30', duration_hours: 2, active: true, start_date: '2026-01-01', skips: ['2026-10-08'] },
  ];
  assert.equal(CR.findClash(weekly, { once_date: '2026-10-08', start_time: '18:00', duration_hours: 1 }), null);
});

test('point 13: a class never clashes with itself, so editing one is safe', () => {
  const existing = [{ id: 'a', days: [2], start_time: '16:00', duration_hours: 2.5, active: true }];
  assert.equal(CR.findClash(existing, { id: 'a', days: [2], start_time: '16:00', duration_hours: 3 }), null);
});

test('point 13: a one-time class may not be put in the past', () => {
  assert.equal(CR.slotInPast({ once_date: '2026-10-08', start_time: '10:00' }, '2026-10-09'), true);
  assert.equal(CR.slotInPast({ once_date: '2026-10-10', start_time: '10:00' }, '2026-10-09'), false);
  // Today, before now.
  assert.equal(CR.slotInPast({ once_date: '2026-10-09', start_time: '10:00' }, '2026-10-09', 700), true);
  assert.equal(CR.slotInPast({ once_date: '2026-10-09', start_time: '18:00' }, '2026-10-09', 700), false);
  assert.equal(CR.slotInPast({ days: [1], start_time: '06:00' }, '2026-10-09', 700), false, 'weekly is never past');
});

test('point 13: two classes in different areas under 30 minutes apart warn', () => {
  const existing = [{ id: 'a', days: [2], start_time: '16:00', duration_hours: 2, active: true, area: 'Nugegoda' }];
  assert.equal(CR.travelWarning(existing, { days: [2], start_time: '18:10', duration_hours: 1, area: 'Dehiwala' }).id, 'a');
  assert.equal(CR.travelWarning(existing, { days: [2], start_time: '18:45', duration_hours: 1, area: 'Dehiwala' }), null);
  assert.equal(
    CR.travelWarning(existing, { days: [2], start_time: '18:10', duration_hours: 1, area: 'Nugegoda' }),
    null,
    'the same area needs no travel',
  );
});

test('point 13: the slot is stored as minutes, which is simple to compare', () => {
  assert.deepEqual(CR.classSpan({ start_time: '16:00', duration_hours: 2.5 }), { start: 960, end: 1110 });
  assert.deepEqual(SR.classSpan({ start_time: '16:00', duration_hours: 2.5 }), { start: 960, end: 1110 });
  assert.equal(CR.overlaps({ start: 960, end: 1110 }, { start: 1110, end: 1170 }), false);
  assert.equal(CR.overlaps({ start: 960, end: 1110 }, { start: 1109, end: 1170 }), true);
});

/* =========================================================================
   The browser and the server must not drift apart
   ========================================================================= */

test('the browser and the server agree on every shared v2 rule', () => {
  const phones = ['0771234567', '+94 77 123 4567', '12345', '', '0112345678'];
  for (const p of phones) assert.equal(CR.toLkMobile(p), SR.toLkMobile(p), p);

  const existing = [{ id: 'a', days: [0, 2], start_time: '16:00', duration_hours: 1.5, active: true }];
  for (const draft of [
    { days: [0], start_time: '16:30', duration_hours: 1 },
    { days: [0], start_time: '17:30', duration_hours: 1 },
    { days: [1], start_time: '16:30', duration_hours: 1 },
  ]) {
    assert.equal(
      CR.findClash(existing, draft)?.id ?? null,
      SR.findClash(existing, draft)?.id ?? null,
      JSON.stringify(draft),
    );
  }

  for (const amount of [0, 1500, 6000, 60000]) {
    assert.deepEqual(CR.paymentOutcome(6000, amount), SR.paymentOutcome(6000, amount), String(amount));
  }
});

/* =========================================================================
   Point 9, phase 2 · dragging a class to a new slot, and telling the parents
   ========================================================================= */

const dragged = (over = {}) => ({
  id: 'c1',
  kind: 'group',
  student_ids: ['a', 'b'],
  venue_type: 'institute',
  venue_name: 'Bright Minds',
  area: 'Nugegoda',
  days: [0, 2], // Monday and Wednesday
  start_time: '16:00',
  duration_hours: 2.5,
  start_date: '2026-01-05',
  once_date: null,
  ...over,
});

// 18 March 2026 is a Wednesday, 19 March a Thursday.
const WED = '2026-03-18';
const THU = '2026-03-19';

test('drag: a dropped time lands on a quarter hour', () => {
  assert.equal(CR.snapMinutes(967), 960, '16:07 becomes 16:00');
  assert.equal(CR.snapMinutes(968), 975, '16:08 becomes 16:15');
  assert.equal(CR.snapMinutes(-20), 0, 'dragged above the grid, clamped');
  assert.equal(CR.snapMinutes(99999) < 24 * 60, true, 'and never past midnight');
  assert.equal(CR.fromMinutes(CR.snapMinutes(967)), '16:00');
  assert.deepEqual(CR.snapMinutes(967), SR.snapMinutes(967), 'the server agrees');
});

test('drag: "this day only" becomes a one-off on the new date', () => {
  const draft = CR.movedDraft(dragged(), {
    fromDate: WED,
    toDate: THU,
    startTime: '17:00',
    scope: 'day',
  });
  assert.equal(draft.id, null, 'it is a new class, not the one being dragged');
  assert.equal(draft.once_date, THU);
  assert.deepEqual(draft.days, []);
  assert.equal(draft.start_time, '17:00');
  assert.equal(draft.duration_hours, 2.5, 'moving does not change the length');
  assert.equal(CR.classDraftError(draft), null, 'and it is a class that can be saved');
});

test('drag: "all days" swaps that weekday and leaves the others alone', () => {
  const draft = CR.movedDraft(dragged(), {
    fromDate: WED,
    toDate: THU,
    startTime: '17:00',
    scope: 'all',
  });
  assert.equal(draft.id, 'c1', 'the same class moves');
  assert.equal(draft.once_date, null);
  assert.deepEqual(draft.days, [0, 3], 'Wednesday becomes Thursday, Monday stays');
  assert.equal(CR.classDraftError(draft), null);
});

test('drag: dropping on the same weekday only changes the time', () => {
  const draft = CR.movedDraft(dragged(), {
    fromDate: WED,
    toDate: WED,
    startTime: '18:00',
    scope: 'all',
  });
  assert.deepEqual(draft.days, [0, 2], 'the days are untouched');
  assert.equal(draft.start_time, '18:00');
});

test('drag: a one-off class moves whatever scope is asked for', () => {
  const once = dragged({ days: [], once_date: WED });
  for (const scope of ['day', 'all']) {
    const draft = CR.movedDraft(once, { fromDate: WED, toDate: THU, startTime: '17:00', scope });
    assert.equal(draft.once_date, THU, scope);
    assert.deepEqual(draft.days, [], scope);
  }
});

test('drag: a drop that lands where it started is a tap, not a move', () => {
  const cls = dragged();
  assert.equal(CR.movedAnything(cls, { fromDate: WED, toDate: WED, startTime: '16:00' }), false);
  assert.equal(CR.movedAnything(cls, { fromDate: WED, toDate: WED, startTime: '16:15' }), true);
  assert.equal(CR.movedAnything(cls, { fromDate: WED, toDate: THU, startTime: '16:00' }), true);
});

test('drag: the moved class is still checked for a clash', () => {
  const others = [
    dragged({ id: 'c1' }),
    { id: 'c2', days: [3], start_time: '17:30', duration_hours: 1, active: true },
  ];
  const onto = CR.movedDraft(dragged(), {
    fromDate: WED,
    toDate: THU,
    startTime: '17:00',
    scope: 'day',
  });
  assert.equal(CR.findClash(others, onto)?.id, 'c2', 'it lands on the Thursday class');

  const clear = CR.movedDraft(dragged(), {
    fromDate: WED,
    toDate: THU,
    startTime: '19:00',
    scope: 'day',
  });
  assert.equal(CR.findClash(others, clear), null);
});

test('drag: moving one session does not clash with the day it is leaving', () => {
  // The repeating class is cancelled on the old date, so dragging a Wednesday
  // session to later the same Wednesday must not report the class it came from.
  const original = dragged();
  const draft = CR.movedDraft(original, {
    fromDate: WED,
    toDate: WED,
    startTime: '17:00',
    scope: 'day',
  });
  const naive = CR.findClash([original], draft);
  assert.ok(naive, 'without the pending cancellation it looks like a clash');

  const withSkip = [{ ...original, skips: [WED] }];
  assert.equal(CR.findClash(withSkip, draft), null, 'with it, the slot is free');
});

test('drag: the parent is told which class moved, and from when to when', () => {
  const text = message(
    'moved',
    {
      teacher: 'Nimal Sir',
      student: 'Kasun',
      class: 'Grade 11 Maths',
      from: 'Wednesday 18 Mar · 4:00 PM',
      to: 'Thursday 19 Mar · 5:00 PM',
    },
    'en',
  );
  assert.match(text, /Hi, this is Nimal Sir\./);
  assert.match(text, /Kasun's Grade 11 Maths has moved/);
  assert.match(text, /from Wednesday 18 Mar · 4:00 PM to Thursday 19 Mar · 5:00 PM/);

  const ta = message(
    'moved',
    { teacher: 'Nimal Sir', student: 'Kasun', class: 'Maths', from: 'A', to: 'B' },
    'ta',
  );
  assert.match(ta, /Kasun/);
  assert.match(ta, /Maths/);
});

test('drag: the label the message and the sheet both use', () => {
  assert.equal(CR.whenLabel(THU, '17:00'), 'Thursday 19 Mar · 5:00 PM');
});

test('drag: nothing is saved or sent until the sheet is confirmed', () => {
  const teacher = read('app/screens/teacher.js');
  const forms = read('app/screens/teacher-forms.js');

  // The drag opens the sheet. It must not post anything by itself.
  const drop = teacher.slice(teacher.indexOf("grid.addEventListener('pointerup'"));
  assert.doesNotMatch(drop.slice(0, 2000), /teacherDo/, 'the drop itself writes nothing');
  assert.match(drop, /FORM_ACTIONS\['class\.moved'\]/);

  // Only the confirm button posts, and the message can be turned off.
  assert.match(forms, /'class\.movesave':/);
  assert.match(forms, /api\.teacherDo\('class\.move'/);
  assert.match(forms, /notify: moveForm\.notify/);
  assert.match(forms, /'class\.movenotify':/);
});

test('drag: a class that already happened cannot be dragged', () => {
  const teacher = read('app/screens/teacher.js');
  assert.match(teacher, /const movable = !session\.done && session\.date >= S\.today;/);
  assert.match(teacher, /\$\{movable \? ' data-move="1"' : ''\}/);
  assert.match(teacher, /\.blk\[data-move\]/, 'and only those blocks are wired');
});

test('drag: press and hold, so a scroll is never a reschedule', () => {
  const teacher = read('app/screens/teacher.js');
  assert.match(teacher, /const HOLD_MS = 320/);
  assert.match(teacher, /const SLOP_PX = 10/);
  assert.match(teacher, /if \(Math\.abs\(dx\) > SLOP_PX \|\| Math\.abs\(dy\) > SLOP_PX\) stop\(\);/);
  // The click that follows a real drag must not also open the class.
  assert.match(teacher, /function suppressNextClick\(\)/);
  assert.match(CSS, /\.blk\[data-move\]\s*\{[\s\S]*?touch-action: none/);
});
