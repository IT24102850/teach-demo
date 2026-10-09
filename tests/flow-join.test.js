/**
 * The four-step sign-up form, driven end to end (improvement plan point 8).
 *
 * This boots the real join.js against a small DOM and a stubbed /api, then
 * walks the four steps the way a family would: type, tap Next, go Back, fix a
 * bad number, and Submit. It asserts the screen that comes out and the request
 * that finally goes to the server.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installFetch } from './dom.js';

const dom = installDom();
dom.seed('join', 'toast', 'sheet');

let submitted = null;
let failNext = false;

const calls = installFetch({
  'GET /api/join?r=config': {
    teacher: { name: 'Nimal', title: 'Sir' },
    subjects: ['Maths', 'Science', 'English'],
    curricula: ['Local', 'Cambridge', 'Edexcel'],
  },
  'POST /api/join?r=submit': (body) => {
    if (failNext) {
      failNext = false;
      return { __status: 500, body: { error: 'The network went away' } };
    }
    submitted = body;
    return { saved: true, teacher: 'Nimal Sir' };
  },
});

await import('../app/join.js');
const screen = () => dom.get('join').innerHTML;
const settle = () => new Promise((r) => setTimeout(r, 5));
await settle();

/* ------------------------------------------------------------- step 1 --- */

test('step 1 opens on the student questions with Next dimmed', () => {
  const html = screen();
  assert.match(html, /Tell us about the student/);
  assert.match(html, /Step 1 of 4/);
  assert.match(html, /About you/);
  assert.match(html, /id="j-name"/);
  assert.match(html, /id="j-grade"/);
  assert.doesNotMatch(html, /data-a="step\.back"/, 'there is nowhere to go back to');
  assert.match(html, /aria-disabled="true"/, 'Next is dimmed until the step is answered');
});

test('Next on an unanswered step explains what is missing instead of moving on', async () => {
  await dom.click('step.next');
  const html = screen();
  assert.match(html, /Step 1 of 4/, 'still on step 1');
  assert.match(html, /Please enter the full name/);
  assert.match(html, /Pick a grade/);
  assert.match(html, /aria-invalid="true"/, 'the missing boxes are outlined');
  assert.equal(dom.get('toast').textContent, 'Please finish this step first');
});

test('answering step 1 moves on, and the short name is suggested', async () => {
  dom.type('j-name', 'Kasun Perera');
  dom.type('j-grade', '11');
  dom.type('j-school', 'Royal College');
  await dom.click('step.next');

  const html = screen();
  assert.match(html, /What will you study\?/);
  assert.match(html, /Step 2 of 4/);
  assert.match(html, /Nimal Sir teaches these subjects/);
});

/* ------------------------------------------------------------- step 2 --- */

test('step 2 asks for the curriculum and at least one subject', async () => {
  await dom.click('step.next');
  assert.match(screen(), /Step 2 of 4/, 'nothing picked yet, so no moving on');
  assert.match(screen(), /Pick at least one subject/);

  await dom.click('curriculum', 'Local');
  await dom.click('subject', 'Maths');
  await dom.click('subject', 'Science');
  const html = screen();
  assert.match(html, /✓ Maths/);
  assert.match(html, /✓ Science/);
  assert.doesNotMatch(html, /✓ English/);

  // Tapping a chosen subject again removes it.
  await dom.click('subject', 'Science');
  assert.doesNotMatch(screen(), /✓ Science/);
  await dom.click('subject', 'Science');

  dom.type('j-ambition', 'Doctor');
  await dom.click('step.next');
  assert.match(screen(), /Step 3 of 4/);
});

/* ------------------------------------------------------------- step 3 --- */

test('step 3 refuses a number that WhatsApp could not use', async () => {
  dom.type('j-parent', 'Nadeesha Perera');
  dom.type('j-phone', '12345');
  await dom.click('step.next');

  const html = screen();
  assert.match(html, /Step 3 of 4/, 'still here');
  assert.match(html, /starts with 7/);
});

test('step 3 accepts a number typed with the leading zero', async () => {
  dom.type('j-phone', '077 123 4567');
  dom.type('j-job', 'Engineer');
  await dom.click('step.next');
  assert.match(screen(), /Step 4 of 4/);
});

/* ------------------------------------------------------------- step 4 --- */

test('the check page lists the answers, with the number written for people', () => {
  const html = screen();
  assert.match(html, /Almost done/);
  assert.match(html, /Kasun Perera/);
  assert.match(html, /Grade 11 · Local/);
  assert.match(html, /Maths, Science/);
  assert.match(html, /Royal College/);
  assert.match(html, /Doctor/);
  assert.match(html, /Nadeesha Perera/);
  assert.match(html, /\+94 77 123 4567/, 'shown as +94 77 123 4567');
  assert.match(html, /Engineer/);
  assert.match(html, /Submit/);
  assert.match(html, /Add a photo \(optional\)/);
});

test('Back keeps every answer, all the way to step 1 and forward again', async () => {
  await dom.click('step.back');
  assert.match(screen(), /Step 3 of 4/);
  assert.match(screen(), /value="Nadeesha Perera"/);
  assert.match(screen(), /value="77 123 4567"/, 'the number is still in the box');

  await dom.click('step.back');
  assert.match(screen(), /Step 2 of 4/);
  assert.match(screen(), /✓ Maths/);

  await dom.click('step.back');
  assert.match(screen(), /Step 1 of 4/);
  assert.match(screen(), /value="Kasun Perera"/);
  assert.match(screen(), /value="Royal College"/);

  await dom.click('step.next');
  await dom.click('step.next');
  await dom.click('step.next');
  assert.match(screen(), /Step 4 of 4/);
});

/* ------------------------------------------------------------- submit --- */

test('a failed Submit keeps everything and offers Try again', async () => {
  failNext = true;
  await dom.click('submit');

  const html = screen();
  assert.match(html, /Could not send\. Nothing you typed was lost\./);
  assert.match(html, /The network went away/);
  assert.match(html, /Try again/);
  assert.match(html, /Kasun Perera/, 'the answers are still on the check page');
});

test('Submit sends the whole form, with the number stored as 94771234567', async () => {
  await dom.click('submit');

  assert.ok(submitted, 'the form reached the server');
  assert.equal(submitted.name, 'Kasun Perera');
  assert.equal(submitted.call_name, 'Kasun', 'suggested from the first name');
  assert.equal(submitted.grade, 11);
  assert.equal(submitted.school, 'Royal College');
  assert.equal(submitted.curriculum, 'Local');
  assert.deepEqual(submitted.subjects, ['Maths', 'Science']);
  assert.equal(submitted.ambition, 'Doctor');
  assert.equal(submitted.parent_name, 'Nadeesha Perera');
  assert.equal(submitted.parent_occupation, 'Engineer');
  assert.equal(submitted.parent_phone, '94771234567', 'point 3: stored without the 0, with 94');
  assert.equal(submitted.t, 'nimal');
});

test('the success screen says what happens next', () => {
  const html = screen();
  assert.match(html, /Sent to Nimal Sir/);
  assert.match(html, /code on WhatsApp/);
  assert.doesNotMatch(html, /Submit/, 'there is nothing left to send');
});

test('the form was only ever sent when Submit was pressed', () => {
  const submits = calls.filter((c) => c.method === 'POST');
  assert.equal(submits.length, 2, 'one failure and one success, and nothing while typing');
});
