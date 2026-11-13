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
  assert.equal(checkOutput({ ...good, verdict: 'KEEP' }, crampsTempo).ok, false);
  assert.equal(checkOutput({ ...good, verdict: 'SWAP' }, crampsTempo).ok, true);
  // KEEP on an easy run with cramps isn't blocked by this rule.
  assert.equal(checkOutput({ ...good, verdict: 'KEEP' }, { ...crampsTempo, workout: { ...tempo.workout, kind: 'easy' } }).ok, true);
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
