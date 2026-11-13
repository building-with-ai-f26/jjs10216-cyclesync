// Output checks (lib/checks.js, spec section 7): one pass and one fail per rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOutput, parseOutput, BANNED_PHRASES, isHardSession } from '../lib/checks.js';

const good = {
  verdict: 'ADJUST',
  headline: 'Easy 3 miles instead of 5-mile tempo',
  prescription: '3 miles at conversational pace (effort 4/10), then 10 minutes of hip mobility.',
  reason: 'Low energy and poor sleep today, so an easier run keeps you moving without draining you.',
  extra_tip: '',
};
const tempo = { workout: { type: 'run', amount: 5, unit: 'miles', kind: 'tempo' }, symptoms: ['none'] };
const crampsTempo = { ...tempo, symptoms: ['cramps'] };

test('a good answer passes and keeps only the five fields', () => {
  const r = checkOutput({ ...good, extra: 'dropped' }, tempo);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.recommendation), ['verdict', 'headline', 'prescription', 'reason', 'extra_tip']);
  assert.equal(r.recommendation.extra_tip, null); // empty tip → none
});

test('verdict must be KEEP, ADJUST, SWAP or REST', () => {
  for (const v of ['KEEP', 'ADJUST', 'SWAP', 'REST']) assert.equal(checkOutput({ ...good, verdict: v }, tempo).ok, true, v);
  for (const v of ['MAYBE', 'keep', '', undefined]) assert.equal(checkOutput({ ...good, verdict: v }, tempo).ok, false, String(v));
});

test('prescription must contain a number', () => {
  assert.equal(checkOutput({ ...good, prescription: 'An easy jog, nice and slow.' }, tempo).ok, false);
  assert.equal(checkOutput({ ...good, prescription: 'An easy 20-minute jog.' }, tempo).ok, true);
});

for (const phrase of BANNED_PHRASES) {
  test(`banned phrase "${phrase}" fails, in any capitals and any field`, () => {
    assert.equal(checkOutput({ ...good, reason: `Okay so ${phrase.toUpperCase()} stuff.` }, tempo).ok, false);
    assert.equal(checkOutput({ ...good, extra_tip: `Note: ${phrase}.` }, tempo).ok, false);
  });
}

test("curly apostrophes don't sneak past the banned phrases", () => {
  assert.equal(checkOutput({ ...good, reason: 'Take it easy because you’re in your luteal days.' }, tempo).ok, false);
});

test('no mention of ovulation, fertility or pregnancy', () => {
  for (const word of ['ovulation', 'Ovulatory', 'fertile window', 'infertility', 'pregnant', 'pregnancy']) {
    assert.equal(checkOutput({ ...good, headline: `About ${word}` }, tempo).ok, false, word);
  }
});

test('cramps + KEEP + a hard session fails; gentler verdicts pass', () => {
  const restOk = { ...good, extra_tip: 'Resting is just as good a choice today.' }; // cramps days must offer rest
  assert.match(checkOutput({ ...restOk, verdict: 'KEEP' }, crampsTempo).errors.join(), /KEEP on a hard session with cramps/);
  assert.equal(checkOutput({ ...restOk, verdict: 'SWAP' }, crampsTempo).ok, true);
  // KEEP on an easy run with cramps isn't blocked by this rule.
  assert.equal(checkOutput({ ...restOk, verdict: 'KEEP' }, { ...crampsTempo, workout: { ...tempo.workout, kind: 'easy' } }).ok, true);
});

test('hard sessions: tempo, intervals, HIIT, heavy lifting', () => {
  assert.equal(isHardSession({ type: 'run', kind: 'tempo' }), true);
  assert.equal(isHardSession({ type: 'run', kind: 'intervals' }), true);
  assert.equal(isHardSession({ type: 'class', classType: 'hiit' }), true);
  assert.equal(isHardSession({ type: 'strength', load: 'heavy' }), true);
  assert.equal(isHardSession({ type: 'run', kind: 'long' }), false);
  assert.equal(isHardSession({ type: 'strength', load: 'light' }), false);
  assert.equal(isHardSession({ type: 'class', classType: 'pilates' }), false);
  assert.equal(isHardSession({ type: 'walk_yoga' }), false);
});

test('missing headline or reason fails', () => {
  assert.equal(checkOutput({ ...good, headline: '' }, tempo).ok, false);
  assert.equal(checkOutput({ ...good, reason: '   ' }, tempo).ok, false);
});

test('reading JSON from the reply text', () => {
  assert.deepEqual(parseOutput(JSON.stringify(good)), good);
  assert.deepEqual(parseOutput('Here you go:\n```json\n' + JSON.stringify(good) + '\n```'), good);
  assert.equal(parseOutput('Sorry, I cannot help.'), null);
  assert.equal(checkOutput(parseOutput('not json'), tempo).ok, false);
});

// ---------- Never longer or harder than planned (rule 7) ----------
import { checkWithinPlan, stridesAllowed } from '../lib/checks.js';

const run = (amount, unit, kind) => ({ type: 'run', amount, unit, kind });
const day = (workout, over = {}) => ({ workout, energy: 3, sleep: 'ok', symptoms: ['none'], soreness: null, ...over });
const greatDay = (workout) => day(workout, { energy: 5, sleep: 'good' });
const problems = (prescription, checkin, extra_tip = null) => checkWithinPlan({ prescription, extra_tip }, checkin);
const passes = (...args) => assert.deepEqual(problems(...args), []);
const fails = (pattern, ...args) => assert.match(problems(...args).join(' | '), pattern);

test('real case 5 answer: 3 + 1.5 + 3 = 7.5 miles on a 5-mile plan → longer', () => {
  fails(/longer than planned \(7\.5 miles vs 5 planned\)/,
    '3 miles easy to start, then 1.5 miles at a comfortable tempo (effort 6/10), finishing with 3 miles at conversational pace (effort 4/10); keep the tempo block shorter than planned.',
    day(run(5, 'miles', 'tempo'), { energy: 5, sleep: 'poor' }));
});

test('real case 7 answer: "the last 2 miles" is part of the 10, not extra → passes', () => {
  passes('10 miles at conversational pace (effort 4/10), with the last 2 miles allowed to settle to effort 5/10 if you feel good; walk breaks are fine if needed.',
    day(run(10, 'miles', 'long'), { energy: 4, sleep: 'good' }));
});

test('real case 4 answer: middle 3 miles + warm-up/cool-down + 4 strides on a great day → passes', () => {
  passes('5 miles with a 10-minute easy warm-up, tempo effort around 7/10 for the middle 3 miles, then 10 minutes easy cooldown. Optional: finish with 4 short strides (15 seconds each) at relaxed speed.',
    greatDay(run(5, 'miles', 'tempo')));
});

test('real case 3 answer: "or a 30-minute walk" and "skip all tempo or hard intervals" → passes', () => {
  passes('3 easy miles at conversational pace (effort 3/10), or a 30-minute walk if cramps feel worse once you start; skip all tempo or hard intervals today.',
    day(run(5, 'miles', 'tempo'), { symptoms: ['cramps'] }));
});

test('real case 9 answer: strides on an energy-3 day → not allowed', () => {
  fails(/strides are only allowed/,
    '3 miles at conversational pace (effort 4/10), with 4 short 20-second strides at the end at effort 6/10, walking 1 minute between each.',
    day(run(5, 'miles', 'tempo')));
});

test('a breakdown with a colon or "total" is read as the whole', () => {
  passes('5 miles: 1 mile easy, 3 miles at effort 7/10, 1 mile easy.', day(run(5, 'miles', 'tempo')));
  passes('1 mile warm-up, 3 miles at tempo (effort 7/10), 1 mile cool-down (5 miles total).', day(run(5, 'miles', 'tempo')));
  fails(/longer/, '6 miles total at effort 4/10.', day(run(5, 'miles', 'easy')));
});

test('distances in other units are converted', () => {
  fails(/longer than planned \(6 km/, '6 km easy (effort 4/10).', day(run(5, 'km', 'easy')));
  passes('3 miles easy (effort 4/10).', day(run(5, 'km', 'easy'))); // 4.8 km
  fails(/longer/, '10 km easy (effort 4/10).', day(run(5, 'miles', 'easy'))); // 6.2 miles
});

test('a run planned in minutes: more running time is longer; stretching/walking time is not', () => {
  const plan = day(run(30, 'minutes', 'easy'));
  fails(/longer than planned \(40 minutes/, '40 minutes easy (effort 4/10).', plan);
  fails(/longer than planned \(60 minutes/, '1 hour easy (effort 4/10).', plan);
  passes('25 minutes easy (effort 4/10), then 10 minutes of stretching.', plan);
  passes('20 minutes easy (effort 4/10) with a 10-minute warm-up walk.', plan);
});

test('harder: effort above what the plan involves', () => {
  fails(/harder than planned \(effort 7\/10/, '3 miles at effort 7/10.', day(run(5, 'miles', 'easy')));
  passes('3 miles at effort 4-5/10.', day(run(5, 'miles', 'easy')));
  fails(/harder/, 'Your usual session at effort 8/10.', day({ type: 'strength', focus: 'upper', load: 'light' }));
  fails(/harder/, 'Take the class at 8 out of 10.', day({ type: 'class', classType: 'pilates' }));
  passes('Ride at effort 7-8/10 on the climbs.', day({ type: 'class', classType: 'spin' }));
});

test('harder: a harder session type than planned (unless it says to skip it)', () => {
  fails(/harder than planned \("intervals"\)/, '3 miles easy, then 4 x 1-minute intervals (effort 5/10).', day(run(5, 'miles', 'easy')));
  passes('3 miles easy (effort 4/10). Skip the intervals today.', day(run(5, 'miles', 'easy')));
  passes('Easy 3 miles instead of your tempo (effort 4/10).', day(run(5, 'miles', 'easy')));
  fails(/harder than planned \("jog"\)/, 'A 20-minute easy jog (effort 4/10).', day({ type: 'walk_yoga' }));
  fails(/harder than planned \("heavy"\)/, 'Go heavy on squats: 3 sets of 5.', day({ type: 'strength', focus: 'lower', load: 'light' }));
  fails(/harder than planned \("jumps"\)/, 'Add some jumps between sets (effort 6/10).', day({ type: 'class', classType: 'barre' }));
});

test('extras are never allowed ("skip any extras" is fine)', () => {
  fails(/adds an extra \("extra"\)/, 'Do your session as planned (effort 6/10), plus an extra set.', day({ type: 'strength', focus: 'full', load: 'heavy' }));
  fails(/adds an extra/, '5 miles (effort 4/10).', greatDay(run(5, 'miles', 'easy')), 'If you feel good, add a bonus mile.');
  passes('5 miles as planned (effort 4/10).', day(run(5, 'miles', 'easy')), 'Skip any extras today.');
});

test('strides: 4-6, on a run, only on a great day', () => {
  const great = greatDay(run(5, 'miles', 'easy'));
  passes('5 miles easy (effort 4/10). Optional: add 4-6 short strides of 20 seconds at the end.', great);
  fails(/more than 6 strides/, '5 miles easy (effort 4/10), then 8 strides.', great);
  fails(/only allowed/, '5 miles easy (effort 4/10), then 4 strides.', { ...great, sleep: 'poor' });
  fails(/only allowed/, '5 miles easy (effort 4/10), then 4 strides.', { ...great, energy: 3 });
  fails(/only allowed/, '5 miles easy (effort 4/10), then 4 strides.', { ...great, soreness: 'a_lot' });
  fails(/only allowed/, '5 miles easy (effort 4/10), then 4 strides.', { ...great, symptoms: ['headache'] });
  passes('5 miles easy (effort 4/10), then 4 strides.', { ...great, symptoms: ['bloating'], soreness: 'some' });
  fails(/only allowed/, 'Your session as planned (effort 6/10), then 4 strides.', greatDay({ type: 'strength', focus: 'full', load: 'heavy' }));
  passes('5 miles easy (effort 4/10). No strides today.', day(run(5, 'miles', 'easy'), { sleep: 'poor' }));
});

test('stridesAllowed: energy 4-5, good sleep, no significant symptoms, soreness at most some', () => {
  const r = run(5, 'miles', 'easy');
  assert.equal(stridesAllowed({ workout: r, energy: 4, sleep: 'good', symptoms: ['none'], soreness: null }), true);
  assert.equal(stridesAllowed({ workout: r, energy: 3, sleep: 'good', symptoms: ['none'], soreness: null }), false);
  assert.equal(stridesAllowed({ workout: r, energy: 5, sleep: 'ok', symptoms: ['none'], soreness: null }), false);
});

test('a failing plan check fails the whole answer (so the pipeline retries)', () => {
  const r = checkOutput({ ...good, prescription: '7 miles at effort 4/10.' }, day(run(5, 'miles', 'tempo')));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /longer than planned/);
});

// ---------- No phase names in the card (rule 10) ----------
test('phase names and terms fail in any card field', () => {
  for (const text of ['Estimated luteal phase plus a long run: bring water.', 'Great follicular energy!', 'At this phase of your cycle, rest.', 'Your menstrual phase is here.']) {
    assert.equal(checkOutput({ ...good, extra_tip: text }, tempo).ok, false, text);
    assert.equal(checkOutput({ ...good, reason: text }, tempo).ok, false, text);
  }
  assert.equal(checkOutput({ ...good, extra_tip: 'Some women run a little warmer at this point in their cycle, so bring water.' }, tempo).ok, true);
  assert.equal(checkOutput({ ...good, reason: 'Menstrual cramps today, so keep it gentle.', extra_tip: 'Resting is just as good.' }, { ...tempo, symptoms: ['cramps'] }).ok, true);
});

test('"don\'t", "do not", "never" and "hold off on" count as skipping', () => {
  const plan = day(run(5, 'miles', 'tempo'), { energy: 5, sleep: 'poor' });
  passes("5 miles at effort 6/10. Don't add strides or extra miles today.", plan);
  passes('5 miles at effort 6/10. Do not add any extra distance.', plan);
  passes('5 miles at effort 6/10; never add strides on a short night.', plan);
  passes('5 miles at effort 6/10. Hold off on strides today.', plan);
  passes('5 miles at effort 6/10. Don’t add extra miles.', plan); // curly apostrophe
});

// ---------- Cramps day: rest as an equal choice ----------
import { offersRestAsEqual } from '../lib/checks.js';

test('cramps day: rest must be offered as an equal choice', () => {
  for (const ok of ['20 minutes of gentle yoga (effort 3/10), or rest. Both are good choices.', 'Resting is just as good today.', 'Rest is an equally good choice today.', 'An easy walk or rest: either is a good call.']) {
    assert.equal(offersRestAsEqual(ok), true, ok);
  }
  for (const bad of ['If cramps feel worse at any point, stop and take the day off instead.', 'A short walk or gentle yoga is an equally good option.', '3 easy miles (effort 3/10).', 'If it gets too uncomfortable, resting is just as good.']) {
    assert.equal(offersRestAsEqual(bad), false, bad);
  }
});

test('cramps day without rest as an equal choice fails the whole answer; a REST verdict is fine', () => {
  const cramps = { workout: { type: 'run', amount: 5, unit: 'miles', kind: 'tempo' }, energy: 3, sleep: 'ok', symptoms: ['cramps'], soreness: null };
  const easy = { verdict: 'ADJUST', headline: 'Easy 3 miles', prescription: '3 miles at effort 3/10. If cramps feel worse, stop and walk home.', reason: 'Cramps today.', extra_tip: '' };
  assert.match(checkOutput(easy, cramps).errors.join(), /offer rest as an equally good choice/);
  assert.equal(checkOutput({ ...easy, extra_tip: 'Resting is just as good a choice today.' }, cramps).ok, true);
  assert.equal(checkOutput({ ...easy, verdict: 'REST', prescription: 'Rest today, or a 15-minute walk (effort 2/10).' }, cramps).ok, true);
  assert.equal(checkOutput(easy, { ...cramps, symptoms: ['none'] }).ok, true); // not a cramps day
});
