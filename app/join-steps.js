/**
 * The rules behind the four-step sign-up form (improvement plan point 8).
 *
 * These are pure functions over a plain answers object. They live apart from
 * join.js so the wizard's logic can be tested without a browser, and so the
 * screen itself stays about drawing rather than deciding.
 */

import { lkMobileError } from './rules.js';

export const TOTAL = 4;

/** The step headings, in order. */
export const STEPS = [
  { title: 'tell_us_student', name: 'step_about' },
  { title: 'what_will_you_study', name: 'step_classes' },
  { title: 'your_parent', name: 'step_parent' },
  { title: 'almost_done', name: 'step_check' },
];

/** A blank set of answers. */
export const emptyAnswers = () => ({
  name: '',
  call_name: '',
  grade: '',
  school: '',
  curriculum: '',
  wanted: [],
  ambition: '',
  parent_name: '',
  phone: '',
  parent_occupation: '',
  /* what the teacher offers, which decides whether step 2 asks at all */
  curricula: [],
});

/**
 * What is wrong with one step, as { fieldId: messageKey }.
 *
 * Next only ever checks the step the person is on, so an unanswered question
 * three steps away never blocks the one in front of them.
 */
export function problems(answers, step) {
  const bad = {};
  const text = (value) => String(value ?? '').trim();

  if (step === 1) {
    if (text(answers.name).length < 2) bad['j-name'] = 'enter_name';
    if (!text(answers.call_name)) bad['j-call'] = 'enter_name';
    const grade = Number(answers.grade);
    if (!Number.isInteger(grade) || grade < 1 || grade > 13) bad['j-grade'] = 'pick_grade';
  }

  if (step === 2) {
    // The question is hidden, and so not asked, when the teacher offers one.
    if ((answers.curricula || []).length > 1 && !answers.curriculum) {
      bad.curriculum = 'curriculum';
    }
    if (!(answers.wanted || []).length) bad.subjects = 'pick_subject';
  }

  if (step === 3) {
    if (text(answers.parent_name).length < 2) bad['j-parent'] = 'enter_parent_name';
    const tel = lkMobileError(answers.phone);
    // An empty box and a half-typed one get the same short instruction.
    if (tel) bad['j-phone'] = tel === 'empty' ? 'tel_nine' : tel;
  }

  // Step 4 is the check page and the optional photo: it asks for nothing.
  return bad;
}

export const stepOk = (answers, step) => Object.keys(problems(answers, step)).length === 0;

/** The first step that still needs an answer, or null when all of them are done. */
export function firstUnfinished(answers) {
  for (let step = 1; step <= TOTAL; step += 1) {
    if (!stepOk(answers, step)) return step;
  }
  return null;
}

/**
 * "What should we call you?" follows the first name until the person edits it
 * themselves - after that it is theirs and is left alone.
 */
export function suggestCallName(answers) {
  if (answers.callTouched) return answers.call_name;
  const first = String(answers.name || '').trim().split(/\s+/)[0] || '';
  return first || answers.call_name;
}
