// Rate limit on AI check-ins (Plan.md B3-5), local version in lib/db.js.
// The live version is take_ai_slot() in supabase/schema.sql, with the same rules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cyclesync-ratelimit-'));
const file = join(dir, 'db.json');
let db, invites, checkinApi, runCheckin;

const today = new Date().toISOString().slice(0, 10);
const profile = {
  lastPeriodStart: today, cycleLength: 28, contraception: 'no',
  patterns: { energyLowerBeforePeriod: 'yes', crampsAffectWorkouts: 'sometimes' },
  workoutDays: ['mon'], goal: 'stay_consistent',
};
const normal = { workout: { type: 'run', amount: 5, unit: 'miles', kind: 'easy' }, energy: 3, sleep: 'ok', symptoms: ['none'], soreness: null };
const heavy = { ...normal, symptoms: ['heavy_flow'], heavyFlow: { soakingHourly: true, over7Days: false, largeClots: false, dizzyOrBreathless: false } };
const good = { verdict: 'KEEP', headline: 'Easy 5 miles as planned', prescription: '5 easy miles at effort 4/10.', reason: 'You feel OK today.', extra_tip: '' };

before(async () => {
  process.env.CYCLESYNC_DB_FILE = file;
  process.env.AI_MODE = 'mock';
  db = await import('../lib/db.js');
  invites = await import('../lib/invites.js');
  checkinApi = await import('../api/checkin.js');
  ({ runCheckin } = await import('../lib/pipeline.js'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

// A fresh invite with its own user, so tests don't share counts.
let n = 0;
async function newTester() {
  n++;
  const code = invites.makeInviteCode();
  const inviteId = await db.addInvite(`tester-${n}`, invites.hashInviteCode(code));
  const userId = `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
  await db.saveProfile(userId, profile, inviteId);
  return { code, inviteId, userId };
}
const send = ({ code, userId }, checkin = normal) =>
  checkinApi.POST(new Request('http://x/api/checkin', {
    method: 'POST', headers: { 'x-invite-code': code }, body: JSON.stringify({ userId, today, checkin }),
  }));

// Adds past AI calls straight into the data file.
function addPastCalls(inviteId, count, minutesAgo) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const createdAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  for (let i = 0; i < count; i++) data.aiCalls.push({ inviteId, createdAt });
  writeFileSync(file, JSON.stringify(data));
}

test('the limits match the plan and supabase/schema.sql', () => {
  assert.deepEqual(db.AI_LIMITS, { per10Min: 5, perDay: 20, globalPerDay: 300 });
  const sql = readFileSync(join(import.meta.dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  assert.match(sql, /recent_count >= 5/);
  assert.match(sql, /day_count >= 20/);
  assert.match(sql, /global_count >= 300/);
});

test('30 check-ins fired at once → only 5 get through, the other 25 get 429', async () => {
  const t = await newTester();
  const results = await Promise.all(Array.from({ length: 30 }, () => send(t)));
  const statuses = results.map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 200).length, 5);
  assert.equal(statuses.filter((s) => s === 429).length, 25);
  const body = await results.find((r) => r.status === 429).json();
  assert.equal(body.error, "You've checked in a lot just now. Try again in a few minutes.");
  const saved = Object.values(JSON.parse(readFileSync(file, 'utf8')).checkins).filter((c) => c.userId === t.userId);
  assert.equal(saved.length, 5, 'refused check-ins are not saved');
});

test('over the limit, the AI is never called', async () => {
  const t = await newTester();
  let aiCalls = 0;
  const ai = async () => { aiCalls++; return { text: JSON.stringify(good), model: 'fake', usage: { tokensIn: 0, tokensOut: 0, cost: 0 } }; };
  const outcomes = await Promise.all(Array.from({ length: 30 }, () =>
    runCheckin({ userId: t.userId, inviteId: t.inviteId, profile, checkin: normal, today }, { ai })));
  assert.equal(aiCalls, 5);
  assert.equal(outcomes.filter((o) => o.rateLimited === 'per_10_min').length, 25);
});

test('safety-screen check-ins never count and still work over the limit', async () => {
  const t = await newTester();
  for (let i = 0; i < 8; i++) assert.equal((await send(t, heavy)).status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await send(t, normal)).status, 200);
  assert.equal((await send(t, normal)).status, 429);
  const res = await send(t, heavy);
  assert.equal(res.status, 200, 'the safety message is never blocked');
  assert.ok((await res.json()).safety);
});

test('one tester hitting the limit does not block another', async () => {
  const a = await newTester();
  const b = await newTester();
  addPastCalls(a.inviteId, 5, 1);
  assert.equal((await send(a)).status, 429);
  assert.equal((await send(b)).status, 200);
});

test('10 minutes later she can check in again, up to 20 a day', async () => {
  const t = await newTester();
  addPastCalls(t.inviteId, 5, 11); // 11 minutes ago: no longer "recent"
  assert.equal((await send(t)).status, 200);
  addPastCalls(t.inviteId, 14, 60); // now 20 today
  const res = await send(t);
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, "You've reached today's check-in limit. Try again tomorrow.");
});

test('calls older than 24 hours no longer count', async () => {
  const t = await newTester();
  addPastCalls(t.inviteId, 20, 25 * 60);
  assert.equal((await send(t)).status, 200);
});

test('300 AI check-ins in a day across everyone → everyone gets 429', async () => {
  const others = await newTester();
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const sofar = data.aiCalls.filter((c) => Date.parse(c.createdAt) > Date.now() - 86_400_000).length;
  addPastCalls(others.inviteId, 300 - sofar, 30);
  const t = await newTester();
  const res = await send(t);
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, 'CycleSync has reached its limit for today. Please try again tomorrow.');
});

test('a revoked invite gets no AI slot', async () => {
  const t = await newTester();
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.invites[t.inviteId].revokedAt = new Date().toISOString();
  writeFileSync(file, JSON.stringify(data));
  assert.equal(await db.takeAiSlot(t.inviteId), 'invalid_invite');
});
