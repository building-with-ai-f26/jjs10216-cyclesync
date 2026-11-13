// The full pipeline (lib/pipeline.js, spec section 1) and the response API,
// using a temporary data file and fake AIs that record every call.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cyclesync-pipeline-'));
const file = join(dir, 'db.json');
let runCheckin, FALLBACK_MESSAGE, getCheckin, responseApi, checkinApi;

before(async () => {
  process.env.CYCLESYNC_DB_FILE = file;
  process.env.AI_MODE = 'mock'; // never call the real AI from npm test
  ({ runCheckin, FALLBACK_MESSAGE } = await import('../lib/pipeline.js'));
  ({ getCheckin } = await import('../lib/db.js'));
  const db = await import('../lib/db.js');
  await db.saveProfile(userId, profile);
  responseApi = await import('../api/response.js');
  checkinApi = await import('../api/checkin.js');
});
after(() => rmSync(dir, { recursive: true, force: true }));

const userId = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const profile = {
  lastPeriodStart: daysAgo(9), cycleLength: 28, contraception: 'no',
  patterns: { energyLowerBeforePeriod: 'yes', crampsAffectWorkouts: 'sometimes' },
  workoutDays: ['mon'], goal: 'stay_consistent',
};
const allNo = { soakingHourly: false, over7Days: false, largeClots: false, dizzyOrBreathless: false };
const normal = { workout: { type: 'run', amount: 5, unit: 'miles', kind: 'tempo' }, energy: 2, sleep: 'poor', symptoms: ['none'], soreness: null };

const good = { verdict: 'ADJUST', headline: 'Easy 3 miles', prescription: '3 easy miles (effort 4/10).', reason: 'Low energy today.', extra_tip: '' };
const bad = { ...good, prescription: 'Just go easy.' }; // no number → fails section 7

// A fake AI that returns the given replies in order and counts its calls.
function fakeAi(...replies) {
  const ai = async (input) => {
    ai.calls.push(input);
    const next = replies[Math.min(ai.calls.length - 1, replies.length - 1)];
    if (next instanceof Error) throw next;
    return { text: typeof next === 'string' ? next : JSON.stringify(next), model: 'fake', usage: { tokensIn: 100, tokensOut: 50, cost: 0.0001 } };
  };
  ai.calls = [];
  return ai;
}

// ---------- Safety: the AI is never called ----------
for (const [label, checkin] of [
  ['heavy flow + soaking hourly (case 1)', { ...normal, symptoms: ['heavy_flow'], heavyFlow: { ...allNo, soakingHourly: true } }],
  ['heavy flow + bleeding over 7 days', { ...normal, symptoms: ['heavy_flow'], heavyFlow: { ...allNo, over7Days: true } }],
  ['heavy flow + large clots', { ...normal, symptoms: ['heavy_flow'], heavyFlow: { ...allNo, largeClots: true } }],
  ['heavy flow + dizzy or breathless', { ...normal, symptoms: ['heavy_flow'], heavyFlow: { ...allNo, dizzyOrBreathless: true } }],
  ['unusual cramps (case 2)', { ...normal, symptoms: ['cramps'], crampsUnusual: true }],
  ['both rules at once', { ...normal, symptoms: ['cramps', 'heavy_flow'], crampsUnusual: true, heavyFlow: { ...allNo, largeClots: true } }],
]) {
  test(`safety: ${label} → safety message, the AI is NEVER called, no recommendation`, async () => {
    const ai = fakeAi(good);
    const out = await runCheckin({ userId, profile, checkin, today }, { ai });
    assert.equal(ai.calls.length, 0, 'the AI was called');
    assert.ok(out.safety.length >= 1);
    assert.equal(out.recommendation, undefined);
    const saved = await getCheckin(out.checkinId);
    assert.equal(saved.source, 'safety');
    assert.equal(saved.recommendation, null);
    assert.deepEqual(saved.safety, out.safety.map((r) => r.rule));
  });
}

test('safety: usual cramps and heavy flow with "None of these" DO go to the AI', async () => {
  for (const checkin of [
    { ...normal, symptoms: ['cramps'], crampsUnusual: false },
    { ...normal, symptoms: ['heavy_flow'], heavyFlow: allNo },
  ]) {
    const ai = fakeAi(good);
    const out = await runCheckin({ userId, profile, checkin, today }, { ai });
    assert.equal(ai.calls.length, 1);
    assert.equal(out.safety, undefined);
  }
});

// ---------- AI, checks, retry, fallback ----------
test('a good answer is used after one call, and the AI gets the section 5 prompt + context', async () => {
  const ai = fakeAi(good);
  const out = await runCheckin({ userId, profile, checkin: normal, today }, { ai });
  assert.equal(ai.calls.length, 1);
  assert.equal(out.recommendation.verdict, 'ADJUST');
  assert.deepEqual(out.cycle, { cycleDay: 10, phase: 'follicular' });
  assert.match(ai.calls[0].system, /^You are a supportive, practical workout coach/);
  assert.match(ai.calls[0].user, /Planned workout: 5-mile tempo run/);
  assert.match(ai.calls[0].user, /Estimated phase: follicular/);
});

test('fails the checks once → retries once → uses the good second answer', async () => {
  const ai = fakeAi(bad, good);
  const out = await runCheckin({ userId, profile, checkin: normal, today }, { ai });
  assert.equal(ai.calls.length, 2);
  assert.equal(out.recommendation.headline, 'Easy 3 miles');
  const saved = await getCheckin(out.checkinId);
  assert.equal(saved.attempts, 2);
  assert.deepEqual(saved.failures, [['prescription has no number']]);
  assert.equal(saved.usage.tokensIn, 200); // both calls counted
});

test('fails twice → the exact section 1 fallback, no third call', async () => {
  const ai = fakeAi(bad, { ...good, reason: 'Science says rest.' });
  const out = await runCheckin({ userId, profile, checkin: normal, today }, { ai });
  assert.equal(ai.calls.length, 2);
  assert.equal(FALLBACK_MESSAGE, 'Go with an easy version of your planned workout and listen to your body today');
  assert.deepEqual(out.recommendation, { verdict: null, headline: FALLBACK_MESSAGE, prescription: null, reason: null, extra_tip: null });
  assert.equal((await getCheckin(out.checkinId)).source, 'fallback');
});

test('an AI error or non-JSON reply counts as a failure, then falls back', async () => {
  const ai = fakeAi(new Error('timeout'), 'Sorry, I cannot help with that.');
  const out = await runCheckin({ userId, profile, checkin: normal, today }, { ai });
  assert.equal(ai.calls.length, 2);
  assert.equal(out.recommendation.headline, FALLBACK_MESSAGE);
});

test('hormonal contraception (case 9): no phase is sent or returned', async () => {
  const ai = fakeAi(good);
  const out = await runCheckin({ userId, profile: { ...profile, contraception: 'yes' }, checkin: normal, today }, { ai });
  assert.equal(out.cycle.phase, null);
  assert.doesNotMatch(ai.calls[0].user, /phase/i);
});

test('the default (mock) AI gives a checked recommendation, saved as "mock"', async () => {
  const out = await runCheckin({ userId, profile, checkin: { ...normal, energy: 5, sleep: 'good' }, today });
  assert.equal(out.recommendation.verdict, 'KEEP');
  const saved = await getCheckin(out.checkinId);
  assert.equal(saved.source, 'mock');
  assert.equal(saved.model, 'mock');
  assert.deepEqual(saved.usage, { tokensIn: 0, tokensOut: 0, cost: 0 });
});

// ---------- Saving: check-in, recommendation and response linked by one ID ----------
const post = (api, body) => api.POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) })).then(async (r) => ({ status: r.status, data: await r.json() }));

test('API: check-in → card → response, all saved under one check-in ID', async () => {
  const { data } = await post(checkinApi, { userId, today, checkin: normal });
  assert.equal(data.ok, true);
  assert.match(data.checkinId, /^[0-9a-f-]{36}$/);
  assert.ok(data.recommendation.verdict);

  const r = await post(responseApi, { userId, checkinId: data.checkinId, response: 'do_this' });
  assert.deepEqual(r.data, { ok: true, response: 'do_this' });

  const saved = JSON.parse(readFileSync(file, 'utf8')).checkins[data.checkinId];
  assert.equal(saved.userId, userId);
  assert.equal(saved.date, today);
  assert.deepEqual(saved.checkin, normal);
  assert.deepEqual(saved.recommendation, data.recommendation);
  assert.equal(saved.response, 'do_this');
  assert.ok(saved.respondedAt);

  // She can change her mind.
  await post(responseApi, { userId, checkinId: data.checkinId, response: 'rest' });
  assert.equal((await getCheckin(data.checkinId)).response, 'rest');
});

test('API: only the four responses are accepted', async () => {
  const { data } = await post(checkinApi, { userId, today, checkin: normal });
  for (const response of ['do_this', 'original_plan', 'something_else', 'rest']) {
    assert.equal((await post(responseApi, { userId, checkinId: data.checkinId, response })).status, 200, response);
  }
  assert.equal((await post(responseApi, { userId, checkinId: data.checkinId, response: 'maybe' })).status, 400);
});

test("API: can't respond to someone else's check-in, an unknown ID, or a safety message", async () => {
  const { data } = await post(checkinApi, { userId, today, checkin: normal });
  assert.equal((await post(responseApi, { userId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', checkinId: data.checkinId, response: 'rest' })).status, 404);
  assert.equal((await post(responseApi, { userId, checkinId: 'nope', response: 'rest' })).status, 404);
  const safety = await post(checkinApi, { userId, today, checkin: { ...normal, symptoms: ['cramps'], crampsUnusual: true } });
  assert.ok(safety.data.safety);
  assert.equal(safety.data.recommendation, undefined);
  assert.equal((await post(responseApi, { userId, checkinId: safety.data.checkinId, response: 'rest' })).status, 404);
});

test("API: a wrong or missing today's date is rejected", async () => {
  assert.equal((await post(checkinApi, { userId, checkin: normal })).status, 400);
  assert.equal((await post(checkinApi, { userId, today: '2020-01-01', checkin: normal })).status, 400);
});
