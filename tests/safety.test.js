// Safety screen (lib/safety.js, spec section 3) and how the check-in API uses it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safetyScreen, SAFETY_MESSAGES } from '../lib/safety.js';
import { validateCheckin } from '../lib/checkin.js';

// Exact wording from research/recommendation-spec.md section 3.
const HEAVY = 'That sounds like heavier bleeding than usual. Please check in with a doctor before training today, and rest is a good call.';
const PAIN = "Severe pain that isn't easing is worth a call to your doctor. Skip training today.";

const allNo = { soakingHourly: false, over7Days: false, largeClots: false, dizzyOrBreathless: false };
const base = {
  workout: { type: 'run', amount: 5, unit: 'miles', kind: 'tempo' },
  energy: 3,
  sleep: 'ok',
  symptoms: ['none'],
  soreness: null,
};
// Run through the real answer checks first, as the server does.
function screen(checkin) {
  const r = validateCheckin(checkin);
  assert.equal(r.ok, true, r.error);
  return safetyScreen(r.checkin);
}

test('messages match the spec word for word', () => {
  assert.equal(SAFETY_MESSAGES.heavy_bleeding, HEAVY);
  assert.equal(SAFETY_MESSAGES.severe_pain, PAIN);
});

for (const sign of Object.keys(allNo)) {
  test(`heavy flow + "${sign}" = yes → heavy-bleeding message`, () => {
    const r = screen({ ...base, symptoms: ['heavy_flow'], heavyFlow: { ...allNo, [sign]: true } });
    assert.deepEqual(r, { stop: true, rules: [{ rule: 'heavy_bleeding', message: HEAVY }] });
  });
}

test('heavy flow with all four signs = yes → one heavy-bleeding message', () => {
  const all = { soakingHourly: true, over7Days: true, largeClots: true, dizzyOrBreathless: true };
  const r = screen({ ...base, symptoms: ['heavy_flow'], heavyFlow: all });
  assert.equal(r.rules.length, 1);
  assert.equal(r.rules[0].message, HEAVY);
});

test('cramps + severe pain not easing → severe-pain message', () => {
  const r = screen({ ...base, symptoms: ['cramps'], severePainNotEasing: true });
  assert.deepEqual(r, { stop: true, rules: [{ rule: 'severe_pain', message: PAIN }] });
});

test('both rules fire → both messages, in the spec\'s order', () => {
  const r = screen({ ...base, symptoms: ['cramps', 'heavy_flow'], severePainNotEasing: true, heavyFlow: { ...allNo, largeClots: true } });
  assert.deepEqual(r.rules.map((x) => x.rule), ['heavy_bleeding', 'severe_pain']);
});

test('normal check-in passes through (no safety message)', () => {
  assert.equal(screen(base), null);
});

test('heavy flow with every sign "no" ("None of these") passes through', () => {
  assert.equal(screen({ ...base, symptoms: ['heavy_flow'], heavyFlow: allNo }), null);
});

test('cramps that are not severe pass through', () => {
  assert.equal(screen({ ...base, symptoms: ['cramps'], severePainNotEasing: false }), null);
});

test('other symptoms (bloating, headache, tired) pass through', () => {
  assert.equal(screen({ ...base, symptoms: ['bloating', 'headache', 'fatigue'] }), null);
});

test('only an explicit yes counts (follow-ups for unpicked symptoms are ignored)', () => {
  // validateCheckin drops follow-ups whose symptom wasn't picked, so these can't fire.
  assert.equal(screen({ ...base, symptoms: ['none'], severePainNotEasing: true, heavyFlow: { ...allNo, soakingHourly: true } }), null);
  // And the rule file itself ignores them too, even if handed raw input.
  assert.equal(safetyScreen({ symptoms: ['bloating'], severePainNotEasing: true }), null);
});

test('the Build 3 rules are not in Build 2: heavy flow + tired with no signs passes through', () => {
  assert.equal(screen({ ...base, symptoms: ['heavy_flow', 'fatigue'], heavyFlow: allNo }), null);
});

// ---------- The check-in API (api/checkin.js) ----------
const dir = mkdtempSync(join(tmpdir(), 'cyclesync-safety-'));
const userId = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
let POST;

before(async () => {
  process.env.CYCLESYNC_DB_FILE = join(dir, 'db.json');
  const db = await import('../lib/db.js');
  await db.saveProfile(userId, {
    lastPeriodStart: '2026-11-07', cycleLength: 28, contraception: 'no',
    patterns: { energyLowerBeforePeriod: 'yes', crampsAffectWorkouts: 'sometimes' },
    workoutDays: ['mon'], goal: 'stay_consistent',
  });
  ({ POST } = await import('../api/checkin.js'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const send = (checkin) =>
  POST(new Request('http://x/api/checkin', { method: 'POST', body: JSON.stringify({ userId, checkin }) })).then(async (r) => ({ status: r.status, data: await r.json() }));

test('API: soaking hourly → only the safety message comes back, no workout', async () => {
  const { status, data } = await send({ ...base, symptoms: ['heavy_flow'], heavyFlow: { ...allNo, soakingHourly: true } });
  assert.equal(status, 200);
  assert.deepEqual(data, { ok: true, safety: [{ rule: 'heavy_bleeding', message: HEAVY }] });
});

test('API: severe pain → only the safety message comes back, no workout', async () => {
  const { data } = await send({ ...base, symptoms: ['cramps'], severePainNotEasing: true });
  assert.deepEqual(data, { ok: true, safety: [{ rule: 'severe_pain', message: PAIN }] });
});

test('API: normal check-in → no safety message', async () => {
  const { data } = await send(base);
  assert.equal(data.ok, true);
  assert.equal(data.safety, undefined);
});

test('API: heavy flow with the follow-ups unanswered is rejected, not waved through', async () => {
  const { status } = await send({ ...base, symptoms: ['heavy_flow'] });
  assert.equal(status, 400);
});
