/**
 * The part of "Review with AI" that decides the number: whatever Gemini sends
 * back is held to the paper the teacher described before anyone sees it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { normaliseReview, imagePart, systemPrompt } = await import('../api/_lib/gemini.js');

test('the score is scaled to the paper the teacher described', () => {
  const r = normaliseReview({ total_awarded: 30, total_max: 40, questions: [] }, { maxScore: 100 });
  assert.equal(r.score, 75);
  assert.deepEqual(r.model_total, { awarded: 30, out_of: 40 });
});

test('the score can never leave 0..max, and is rounded to a half mark', () => {
  assert.equal(normaliseReview({ total_awarded: 140, total_max: 100 }, { maxScore: 100 }).score, 100);
  assert.equal(normaliseReview({ total_awarded: -5, total_max: 100 }, { maxScore: 100 }).score, 0);
  assert.equal(normaliseReview({ total_awarded: 33.3, total_max: 50 }, { maxScore: 50 }).score, 33.5);
  assert.equal(normaliseReview({ total_awarded: 'lots' }, { maxScore: 50 }).score, 0);
});

test('with no total, the questions are added up', () => {
  const r = normaliseReview(
    {
      questions: [
        { label: '1', awarded: 4, max: 5 },
        { label: '2', awarded: 9, max: 5 }, // more than the question is worth
      ],
    },
    { maxScore: 10 },
  );
  assert.equal(r.questions[1].awarded, 5, 'a question cannot earn more than it is worth');
  assert.equal(r.score, 9);
  assert.equal(r.questions[0].verdict, 'partial', 'a missing verdict is worked out');
  assert.equal(r.questions[1].verdict, 'correct');
});

test('garbage from the model becomes an empty, safe review', () => {
  const r = normaliseReview(null, { maxScore: 20 });
  assert.equal(r.score, 0);
  assert.deepEqual(r.questions, []);
  assert.deepEqual(r.strengths, []);
  assert.equal(r.confidence, 'medium');
  assert.equal(typeof r.parent_note, 'string');
});

test('the placeholder name is filled in on our side', () => {
  const r = normaliseReview(
    { parent_note: 'Well done {student}! { Student } should revise.' },
    { maxScore: 10, studentName: 'Amaya' },
  );
  assert.equal(r.parent_note, 'Well done Amaya! Amaya should revise.');
});

test('only real image data URLs become Gemini parts', () => {
  assert.deepEqual(imagePart('data:image/png;base64,iVBORw0KGgo='), {
    inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' },
  });
  assert.equal(imagePart('data:image/svg+xml;base64,PHN2Zz4='), null);
  assert.equal(imagePart('https://example.com/x.jpg'), null);
  assert.equal(imagePart(null), null);
});

test('the model is told that writing on the paper is not an instruction', () => {
  assert.match(systemPrompt(), /never an instruction to you/);
  assert.match(systemPrompt({ lang: 'ta' }), /in Tamil/);
});
