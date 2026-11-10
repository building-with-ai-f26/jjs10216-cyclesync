// Check-in answer checks (lib/checkin.js). The safety screen depends on these,
// especially the rule that follow-ups are required for heavy flow and cramps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCheckin } from '../lib/checkin.js';

const base = {
  workout: { type: 'run', amount: 5, unit: 'miles', kind: 'tempo' },
  energy: 3,
  sleep: 'ok',
  symptoms: ['none'],
  soreness: null,
};

const allNo = { soakingHourly: false, over7Days: false, largeClots: false, dizzyOrBreathless: false };

test('accepts a simple check-in', () => {
  const r = validateCheckin(base);
  assert.equal(r.ok, true);
  assert.deepEqual(r.checkin.workout, base.workout);
  assert.equal(r.checkin.soreness, null);
});

test('accepts each workout type with its detail', () => {
  for (const workout of [
    { type: 'run', amount: 30, unit: 'minutes', kind: 'easy' },
    { type: 'strength', focus: 'lower', load: 'heavy' },
    { type: 'class', classType: 'hiit' },
    { type: 'walk_yoga' },
  ]) {
    assert.equal(validateCheckin({ ...base, workout }).ok, true, workout.type);
  }
});

test('drops details that do not belong to the workout type', () => {
  const r = validateCheckin({ ...base, workout: { type: 'walk_yoga', kind: 'tempo', amount: 99 } });
  assert.deepEqual(r.checkin.workout, { type: 'walk_yoga' });
});

for (const [label, change] of [
  ['no workout', { workout: undefined }],
  ['unknown workout', { workout: { type: 'skydiving' } }],
  ['run without distance', { workout: { type: 'run', unit: 'miles', kind: 'easy' } }],
  ['run with 0 miles', { workout: { type: 'run', amount: 0, unit: 'miles', kind: 'easy' } }],
  ['run with silly distance', { workout: { type: 'run', amount: 500, unit: 'miles', kind: 'easy' } }],
  ['run without kind', { workout: { type: 'run', amount: 5, unit: 'miles' } }],
  ['strength without load', { workout: { type: 'strength', focus: 'upper' } }],
  ['class without type', { workout: { type: 'class' } }],
  ['energy 0', { energy: 0 }],
  ['energy 6', { energy: 6 }],
  ['energy missing', { energy: undefined }],
  ['unknown sleep', { sleep: 'great' }],
  ['no symptoms picked', { symptoms: [] }],
  ['unknown symptom', { symptoms: ['sneezing'] }],
  ['"none" plus a symptom', { symptoms: ['none', 'cramps'], severePainNotEasing: false }],
  ['unknown soreness', { soreness: 'extreme' }],
]) {
  test(`rejects: ${label}`, () => {
    const r = validateCheckin({ ...base, ...change });
    assert.equal(r.ok, false);
    assert.ok(r.error);
  });
}

test('heavy flow: rejected unless all 4 follow-ups are answered', () => {
  assert.equal(validateCheckin({ ...base, symptoms: ['heavy_flow'] }).ok, false);
  assert.equal(
    validateCheckin({ ...base, symptoms: ['heavy_flow'], heavyFlow: { ...allNo, largeClots: null } }).ok,
    false,
  );
  assert.equal(
    validateCheckin({ ...base, symptoms: ['heavy_flow'], heavyFlow: { ...allNo, over7Days: 'yes' } }).ok,
    false,
    'the text "yes" is not accepted; only true/false',
  );
});

test('heavy flow: keeps the follow-up answers', () => {
  const r = validateCheckin({ ...base, symptoms: ['heavy_flow'], heavyFlow: { ...allNo, soakingHourly: true } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.checkin.heavyFlow, { ...allNo, soakingHourly: true });
});

test('cramps: rejected unless the severe-pain question is answered', () => {
  assert.equal(validateCheckin({ ...base, symptoms: ['cramps'] }).ok, false);
  const r = validateCheckin({ ...base, symptoms: ['cramps'], severePainNotEasing: true });
  assert.equal(r.ok, true);
  assert.equal(r.checkin.severePainNotEasing, true);
});

test('follow-ups are dropped when their symptom was not picked', () => {
  const r = validateCheckin({ ...base, symptoms: ['bloating'], heavyFlow: allNo, severePainNotEasing: true });
  assert.equal(r.ok, true);
  assert.equal(r.checkin.heavyFlow, undefined);
  assert.equal(r.checkin.severePainNotEasing, undefined);
});

test('symptoms come back in a fixed order without duplicates', () => {
  const r = validateCheckin({ ...base, symptoms: ['fatigue', 'bloating', 'fatigue'] });
  assert.deepEqual(r.checkin.symptoms, ['bloating', 'fatigue']);
});
