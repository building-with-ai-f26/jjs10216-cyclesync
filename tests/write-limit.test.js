// Rate limit on every route that saves data (lib/rate-limit.js), local version.
// The live version is take_write_slot() in supabase/schema.sql, with the same rules:
// 30 saves per 10 minutes and 100 per day per invite, across onboarding,
// check-in, response and period.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cyclesync-writelimit-'));
const file = join(dir, 'db.json');
let db, invites, api;

const today = new Date().toISOString().slice(0, 10);
const profile = {
  lastPeriodStart: today, cycleLength: 28, contraception: 'no',
  patterns: { energyLowerBeforePeriod: 'yes', crampsAffectWorkouts: 'sometimes' },
  workoutDays: ['mon'], goal: 'stay_consistent',
};
const normal = { workout: { type: 'walk_yoga' }, energy: 3, sleep: 'ok', symptoms: ['none'], soreness: null };
const heavy = { ...normal, symptoms: ['heavy_flow'], heavyFlow: { soakingHourly: true, over7Days: false, largeClots: false, dizzyOrBreathless: false } };
const TOO_MANY = "You've made a lot of changes just now. Try again in a few minutes.";

// Every test file sets a temporary data file BEFORE importing lib/ (AGENTS.md).
before(async () => {
  process.env.CYCLESYNC_DB_FILE = file;
  process.env.AI_MODE = 'mock';
  db = await import('../lib/db.js');
  invites = await import('../lib/invites.js');
  api = {
    onboarding: (await import('../api/onboarding.js')).POST,
    checkin: (await import('../api/checkin.js')).POST,
    response: (await import('../api/response.js')).POST,
    period: (await import('../api/period.js')).POST,
  };
});
after(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
async function newTester() {
  n++;
  const code = invites.makeInviteCode();
  const inviteId = await db.addInvite(`writer-${n}`, invites.hashInviteCode(code));
  const userId = `${String(n).padStart(8, '0')}-1111-4000-8000-000000000000`;
  await db.saveProfile(userId, profile, inviteId);
  return { code, inviteId, userId };
}
const call = (route, { code }, body) =>
  api[route](new Request(`http://x/api/${route}`, { method: 'POST', headers: { 'x-invite-code': code }, body: JSON.stringify(body) }));

// One valid request body per route.
async function bodyFor(route, t) {
  if (route === 'onboarding') return { userId: t.userId, profile };
  if (route === 'checkin') return { userId: t.userId, today, checkin: heavy };
  if (route === 'period') return { userId: t.userId, date: today };
  // response: needs a check-in with a recommendation (mock AI)
  const res = await call('checkin', t, { userId: t.userId, today, checkin: normal });
  return { userId: t.userId, checkinId: (await res.json()).checkinId, response: 'rest' };
}

function addPastWrites(inviteId, count, minutesAgo) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const createdAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  for (let i = 0; i < count; i++) data.writeCalls.push({ inviteId, route: 'period', createdAt });
  writeFileSync(file, JSON.stringify(data));
}
const savedCheckins = (userId) => Object.values(JSON.parse(readFileSync(file, 'utf8')).checkins).filter((c) => c.userId === userId).length;

test('the limits match supabase/schema.sql', () => {
  assert.deepEqual(db.WRITE_LIMITS, { per10Min: 30, perDay: 100 });
  const sql = readFileSync(join(import.meta.dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  assert.match(sql, /interval '10 minutes'\) >= 30 then return 'writes_10_min'/);
  assert.match(sql, /interval '24 hours'\) >= 100 then return 'writes_day'/);
  assert.match(sql, /route in \('onboarding','checkin','response','period'\)/);
});

for (const route of ['onboarding', 'response', 'period']) {
  test(`${route}: over 30 saves in 10 minutes → 429 with a clear message, nothing saved`, async () => {
    const t = await newTester();
    const body = await bodyFor(route, t);
    const used = route === 'response' ? 1 : 0; // the check-in it needed took one slot
    addPastWrites(t.inviteId, 30 - used - 1, 1);
    assert.equal((await call(route, t, body)).status, 200, 'the 30th save is allowed');
    const before = readFileSync(file, 'utf8');
    const res = await call(route, t, { ...body, ...(route === 'period' ? { date: profile.lastPeriodStart } : {}) });
    assert.equal(res.status, 429);
    assert.equal((await res.json()).error, TOO_MANY);
    const after = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(after.profiles, JSON.parse(before).profiles, 'profile unchanged');
    assert.deepEqual(after.checkins, JSON.parse(before).checkins, 'check-ins unchanged');
  });
}

test('40 setup saves fired at once → exactly 30 get through, 10 get 429', async () => {
  const t = await newTester();
  const results = await Promise.all(Array.from({ length: 40 }, () => call('onboarding', t, { userId: t.userId, profile })));
  const statuses = results.map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 200).length, 30);
  assert.equal(statuses.filter((s) => s === 429).length, 10);
});

test('check-ins: over the save limit → 429, nothing saved, AI never called', async () => {
  const t = await newTester();
  addPastWrites(t.inviteId, 30, 1);
  const before = savedCheckins(t.userId);
  const aiBefore = JSON.parse(readFileSync(file, 'utf8')).aiCalls.length;
  const res = await call('checkin', t, { userId: t.userId, today, checkin: normal });
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, TOO_MANY);
  assert.equal(savedCheckins(t.userId), before);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).aiCalls.length, aiBefore, 'no AI slot taken');
});

test('a safety message is never blocked: over the save limit it still shows, just not saved', async () => {
  const t = await newTester();
  addPastWrites(t.inviteId, 30, 1);
  const res = await call('checkin', t, { userId: t.userId, today, checkin: heavy });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.safety?.length, 'the safety message is sent');
  assert.equal(data.checkinId, null);
  assert.equal(savedCheckins(t.userId), 0);
});

test('saves are counted across routes, per invite', async () => {
  const a = await newTester();
  const b = await newTester();
  addPastWrites(a.inviteId, 30, 1);
  assert.equal((await call('period', a, { userId: a.userId, date: today })).status, 429);
  assert.equal((await call('onboarding', a, { userId: a.userId, profile })).status, 429);
  assert.equal((await call('period', b, { userId: b.userId, date: today })).status, 200, 'another tester is not blocked');
});

test('10 minutes later she can save again, up to 100 a day; older than 24 hours no longer counts', async () => {
  const t = await newTester();
  addPastWrites(t.inviteId, 30, 11);
  assert.equal((await call('period', t, { userId: t.userId, date: today })).status, 200);
  addPastWrites(t.inviteId, 69, 60); // now 100 today
  const res = await call('period', t, { userId: t.userId, date: today });
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, "You've reached today's limit. Try again tomorrow.");

  const fresh = await newTester();
  addPastWrites(fresh.inviteId, 100, 25 * 60);
  assert.equal((await call('period', fresh, { userId: fresh.userId, date: today })).status, 200);
});

test('a revoked invite gets no write slot', async () => {
  const t = await newTester();
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.invites[t.inviteId].revokedAt = new Date().toISOString();
  writeFileSync(file, JSON.stringify(data));
  assert.equal(await db.takeWriteSlot(t.inviteId, 'period'), 'invalid_invite');
});
