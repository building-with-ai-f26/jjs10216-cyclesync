// The mock coach (lib/mock-ai.js) and the prompt (lib/prompt.js).
// Uses the spec's seed cases (section 8) where they apply.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockRecommendation } from '../lib/mock-ai.js';
import { checkOutput, parseOutput } from '../lib/checks.js';
import { SYSTEM_PROMPT, buildUserMessage, describeWorkout } from '../lib/prompt.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tempo = { type: 'run', amount: 5, unit: 'miles', kind: 'tempo' };
const ctx = (over = {}) => ({
  workout: tempo, energy: 3, sleep: 'ok', symptoms: ['none'], soreness: null,
  cycleDay: 10, phase: 'follicular', periodSoon: false,
  patterns: { energyLowerBeforePeriod: 'no', crampsAffectWorkouts: 'no' }, goal: 'stay_consistent',
  ...over,
});
// Run the mock, then the real output checks, as the pipeline does.
function recommend(over) {
  const c = ctx(over);
  const result = checkOutput(parseOutput(JSON.stringify(mockRecommendation(c))), { workout: c.workout, energy: c.energy, sleep: c.sleep, symptoms: c.symptoms, soreness: c.soreness }, { phase: c.phase });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return result.recommendation;
}

test('case 3: cramps, energy 3, 5-mile tempo → gentle SWAP, rest offered, no hard session', () => {
  const r = recommend({ symptoms: ['cramps'] });
  assert.ok(['SWAP', 'ADJUST'].includes(r.verdict));
  assert.match(r.prescription, /rest/i);
  assert.doesNotMatch(r.prescription, /tempo|interval/i);
});

test('cramps + energy 1 → REST', () => {
  assert.equal(recommend({ symptoms: ['cramps'], energy: 1 }).verdict, 'REST');
});

test('cramps: "you mentioned" when she said cramps affect her workouts', () => {
  const r = recommend({ symptoms: ['cramps'], patterns: { crampsAffectWorkouts: 'sometimes' } });
  assert.match(r.reason, /You mentioned cramps/);
});

test('case 4: energy 5, good sleep, no symptoms, tempo → KEEP with a small optional add', () => {
  const r = recommend({ energy: 5, sleep: 'good' });
  assert.equal(r.verdict, 'KEEP');
  assert.match(r.prescription, /Optional: add 4-6 short strides/);
});

test('case 5: energy 5 but poor sleep → no increase', () => {
  const r = recommend({ energy: 5, sleep: 'poor' });
  assert.equal(r.verdict, 'KEEP');
  assert.doesNotMatch(r.prescription, /optional|add|extra/i);
});

test('no increase with soreness or symptoms either', () => {
  assert.doesNotMatch(recommend({ energy: 5, sleep: 'good', soreness: 'some' }).prescription, /optional/i);
  assert.doesNotMatch(recommend({ energy: 5, sleep: 'good', symptoms: ['bloating'] }).prescription, /optional/i);
});

test('case 6: energy 2, poor sleep, heavy lower-body → SWAP to mobility with numbers', () => {
  const r = recommend({ energy: 2, sleep: 'poor', workout: { type: 'strength', focus: 'lower', load: 'heavy' } });
  assert.equal(r.verdict, 'SWAP');
  assert.match(r.headline, /Mobility/);
  assert.match(r.reason, /Low energy and poor sleep/);
});

test('energy 2 (sleep OK) on a heavy lift → ADJUST lighter, with sets and reps', () => {
  const r = recommend({ energy: 2, workout: { type: 'strength', focus: 'upper', load: 'heavy' } });
  assert.equal(r.verdict, 'ADJUST');
  assert.match(r.prescription, /2 sets of 10/);
});

test('low energy run → shorter, easier distance', () => {
  const r = recommend({ energy: 2 });
  assert.equal(r.verdict, 'ADJUST');
  assert.equal(r.headline, 'Easy 3 miles instead of your 5-mile tempo run');
});

test('case 7: estimated luteal + long run → hydration tip, no phase claim', () => {
  const r = recommend({ phase: 'luteal', energy: 4, workout: { type: 'run', amount: 10, unit: 'miles', kind: 'long' } });
  assert.ok(['KEEP', 'ADJUST'].includes(r.verdict));
  assert.match(r.extra_tip, /water/);
});

test('no hydration tip on a short run or outside the luteal estimate', () => {
  assert.equal(recommend({ phase: 'luteal', workout: { type: 'run', amount: 3, unit: 'miles', kind: 'easy' }, energy: 4, sleep: 'good' }).extra_tip, null);
  assert.doesNotMatch(recommend({ phase: 'follicular', workout: { type: 'run', amount: 10, unit: 'miles', kind: 'long' } }).extra_tip ?? '', /water/);
});

test('case 8: estimated follicular, energy 2 → driven by low energy, not the phase', () => {
  const r = recommend({ phase: 'follicular', energy: 2 });
  assert.equal(r.verdict, 'ADJUST');
  assert.match(r.reason, /Low energy/);
  assert.doesNotMatch(JSON.stringify(r), /follicular|phase/i);
});

test('energy 1 → REST', () => {
  assert.equal(recommend({ energy: 1 }).verdict, 'REST');
});

test('"you mentioned" energy dips before her period, when it\'s soon and energy is low', () => {
  const r = recommend({ energy: 2, periodSoon: true, phase: 'luteal', patterns: { energyLowerBeforePeriod: 'yes' } });
  assert.match(r.reason, /You mentioned energy often dips before your period/);
});

test('every combination passes the section 7 checks (case 10)', () => {
  const workouts = [
    tempo, { type: 'run', amount: 30, unit: 'minutes', kind: 'easy' }, { type: 'run', amount: 1, unit: 'km', kind: 'intervals' },
    { type: 'run', amount: 12, unit: 'km', kind: 'long' },
    { type: 'strength', focus: 'full', load: 'heavy' }, { type: 'strength', focus: 'lower', load: 'light' },
    ...['spin', 'hiit', 'pilates', 'barre', 'other'].map((classType) => ({ type: 'class', classType })),
    { type: 'walk_yoga' },
  ];
  const symptomSets = [['none'], ['cramps'], ['bloating'], ['headache', 'fatigue'], ['heavy_flow'], ['cramps', 'heavy_flow']];
  let n = 0;
  for (const workout of workouts) for (const energy of [1, 2, 3, 4, 5]) for (const sleep of ['good', 'ok', 'poor'])
    for (const symptoms of symptomSets) for (const soreness of [null, 'some', 'a_lot']) for (const phase of [null, 'menstrual', 'luteal']) {
      recommend({ workout, energy, sleep, symptoms, soreness, phase, periodSoon: phase === 'luteal', patterns: { energyLowerBeforePeriod: 'yes', crampsAffectWorkouts: 'yes' } });
      n++;
    }
  assert.equal(n, 9720); // 12 workouts × 5 energy × 3 sleep × 6 symptom sets × 3 soreness × 3 phases
});

test('the system prompt contains section 5 of the spec word for word', () => {
  const spec = readFileSync(join(import.meta.dirname, '..', 'research', 'recommendation-spec.md'), 'utf8');
  const section5 = spec.split('## 5. AI instructions (the core of the system prompt)')[1].split('Note: the numbers')[0].trim();
  assert.ok(SYSTEM_PROMPT.startsWith(section5));
});

test('case 9: no phase in the message when there is none (hormonal contraception)', () => {
  const msg = buildUserMessage(ctx({ phase: null }));
  assert.doesNotMatch(msg, /phase/i);
  assert.match(msg, /Cycle day: 10/);
});

test('the message includes the phase when there is one, and never "ovulation"', () => {
  for (const phase of ['menstrual', 'follicular', 'luteal', null]) {
    const msg = buildUserMessage(ctx({ phase }));
    if (phase) assert.match(msg, new RegExp(`Estimated phase: ${phase}`));
    assert.doesNotMatch(msg, /ovulat/i);
  }
});

test('workouts in plain words', () => {
  assert.equal(describeWorkout(tempo), '5-mile tempo run');
  assert.equal(describeWorkout({ type: 'run', amount: 30, unit: 'minutes', kind: 'easy' }), '30-minute easy run');
  assert.equal(describeWorkout({ type: 'strength', focus: 'lower', load: 'heavy' }), 'heavy lower-body session');
  assert.equal(describeWorkout({ type: 'class', classType: 'hiit' }), 'HIIT class');
});

test('no "energy dips before your period" when the period is not soon', () => {
  const r = recommend({ energy: 2, periodSoon: false, phase: 'luteal', patterns: { energyLowerBeforePeriod: 'yes' } });
  assert.doesNotMatch(r.reason, /before your period/);
});

test('great day: KEEP with one optional extra that fits the workout (none for walk or yoga)', () => {
  assert.match(recommend({ workout: { type: 'strength', focus: 'full', load: 'light' }, energy: 5, sleep: 'good' }).prescription, /Optional: 1 extra set/);
  assert.match(recommend({ workout: { type: 'class', classType: 'pilates' }, energy: 5, sleep: 'good' }).prescription, /Optional: take the harder option on one round/);
  assert.doesNotMatch(recommend({ workout: { type: 'walk_yoga' }, energy: 5, sleep: 'good' }).prescription, /extra|optional|stride/i);
});

test('the system prompt never contains the word "ovulation" (spec section 4)', () => {
  assert.doesNotMatch(SYSTEM_PROMPT, /ovulat/i);
});

test('the period pattern is only sent when the period is expected within about 5 days', () => {
  const patterns = { energyLowerBeforePeriod: 'yes', crampsAffectWorkouts: 'sometimes' };
  const soon = buildUserMessage(ctx({ periodSoon: true, phase: 'luteal', patterns }));
  assert.match(soon, /Energy usually lower in the days before her period: yes/);
  assert.match(soon, /expected within about 5 days/);
  const notSoon = buildUserMessage(ctx({ periodSoon: false, phase: 'luteal', patterns }));
  assert.doesNotMatch(notSoon, /before her period|expected within/);
  assert.doesNotMatch(notSoon, /Cramps usually affect/); // no cramps today
  assert.match(buildUserMessage(ctx({ symptoms: ['cramps'], patterns })), /Cramps usually affect her workouts: sometimes/);
});

test('skipped soreness is left out of the message entirely', () => {
  assert.doesNotMatch(buildUserMessage(ctx({ soreness: null })), /sore/i);
  assert.match(buildUserMessage(ctx({ soreness: 'some' })), /Soreness: some/);
});
