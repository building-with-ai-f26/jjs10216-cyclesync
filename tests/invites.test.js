// Invite codes (lib/invites.js, Plan.md B3-4): every data route needs a valid,
// unrevoked code, and one invite can't reach another invite's data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cyclesync-invites-'));
const file = join(dir, 'db.json');
let db, invites, api;
let codeA, codeB, inviteA;

const userA = 'aaaaaaaa-1111-4111-8111-111111111111';
const legacyUser = 'cccccccc-3333-4333-8333-333333333333';
const today = new Date().toISOString().slice(0, 10);
const profile = {
  lastPeriodStart: today, cycleLength: 28, contraception: 'no',
  patterns: { energyLowerBeforePeriod: 'yes', crampsAffectWorkouts: 'sometimes' },
  workoutDays: ['mon'], goal: 'stay_consistent',
};
const checkin = { workout: { type: 'run', amount: 3, unit: 'miles', kind: 'easy' }, energy: 3, sleep: 'ok', symptoms: ['none'], soreness: null };

before(async () => {
  process.env.CYCLESYNC_DB_FILE = file;
  process.env.AI_MODE = 'mock';
  db = await import('../lib/db.js');
  invites = await import('../lib/invites.js');
  codeA = invites.makeInviteCode();
  codeB = invites.makeInviteCode();
  inviteA = await db.addInvite('tester-a', invites.hashInviteCode(codeA));
  await db.addInvite('tester-b', invites.hashInviteCode(codeB));
  await db.saveProfile(userA, profile, inviteA);
  api = {
    onboarding: await import('../api/onboarding.js'),
    context: await import('../api/context.js'),
    period: await import('../api/period.js'),
    checkin: await import('../api/checkin.js'),
    response: await import('../api/response.js'),
  };
});
after(() => rmSync(dir, { recursive: true, force: true }));

function get(route, query, code) {
  const headers = code === undefined ? {} : { 'x-invite-code': code };
  return route.GET(new Request(`http://x/api?${new URLSearchParams(query)}`, { headers }));
}
function post(route, body, code) {
  const headers = code === undefined ? {} : { 'x-invite-code': code };
  return route.POST(new Request('http://x/api', { method: 'POST', headers, body: JSON.stringify(body) }));
}

// Every data route, called as user A. `code` is whatever invite is sent.
const calls = (code) => ({
  'GET onboarding': () => get(api.onboarding, { userId: userA }, code),
  'POST onboarding': () => post(api.onboarding, { userId: userA, profile }, code),
  'GET context': () => get(api.context, { userId: userA, today }, code),
  'POST period': () => post(api.period, { userId: userA, date: today }, code),
  'POST checkin': () => post(api.checkin, { userId: userA, today, checkin }, code),
  'POST response': () => post(api.response, { userId: userA, checkinId: '00000000-0000-4000-8000-000000000000', response: 'rest' }, code),
});

test('codes are 22 URL-safe characters, random, and stored only as a hash', () => {
  assert.match(codeA, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(codeA, codeB);
  assert.match(invites.hashInviteCode(codeA), /^[0-9a-f]{64}$/);
  const saved = readFileSync(file, 'utf8');
  assert.ok(!saved.includes(codeA), 'the code itself is never saved');
  assert.ok(saved.includes(invites.hashInviteCode(codeA)));
});

for (const [label, code] of [['no code', undefined], ['an empty code', ''], ['a malformed code', 'abc'], ['an unknown code', 'x'.repeat(22)]]) {
  test(`${label} → 401 "invite-only" on every data route`, async () => {
    for (const [name, call] of Object.entries(calls(code))) {
      const res = await call();
      assert.equal(res.status, 401, name);
      assert.equal((await res.json()).invite, 'required', name);
    }
  });
}

test('health and config stay open (no data in them)', async () => {
  assert.equal((await (await import('../api/health.js')).GET()).status, 200);
  assert.equal((await (await import('../api/config.js')).GET()).status, 200);
});

test('with her own code, every route works', async () => {
  const c = calls(codeA);
  assert.equal((await c['GET onboarding']()).status, 200);
  assert.equal((await c['GET context']()).status, 200);
  assert.equal((await c['POST period']()).status, 200);
  const res = await c['POST checkin']();
  assert.equal(res.status, 200);
  const { checkinId } = await res.json();
  assert.equal((await db.getCheckin(checkinId)).inviteId, inviteA, 'check-in saved with her invite');
  assert.equal((await post(api.response, { userId: userA, checkinId, response: 'rest' }, codeA)).status, 200);
  assert.equal((await c['POST onboarding']()).status, 200);
  assert.equal((await db.getProfile(userA)).inviteId, inviteA, 'editing setup keeps her invite');
});

test("another tester's code + her browser ID → 403 on every route, nothing changed", async () => {
  const before = readFileSync(file, 'utf8');
  for (const [name, call] of Object.entries(calls(codeB))) {
    if (name === 'POST response') continue; // checked below with a real check-in
    assert.equal((await call()).status, 403, name);
  }
  assert.equal(readFileSync(file, 'utf8'), before, 'the data file is unchanged');

  const { checkinId } = await (await post(api.checkin, { userId: userA, today, checkin }, codeA)).json();
  assert.equal((await post(api.response, { userId: userA, checkinId, response: 'rest' }, codeB)).status, 403);
  assert.equal((await db.getCheckin(checkinId)).response, null);
});

test('a revoked code → 401', async () => {
  const code = invites.makeInviteCode();
  const id = await db.addInvite('tester-revoked', invites.hashInviteCode(code));
  assert.equal((await get(api.context, { userId: userA, today }, code)).status, 403); // valid, but not hers
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.invites[id].revokedAt = new Date().toISOString();
  writeFileSync(file, JSON.stringify(data));
  assert.equal((await get(api.context, { userId: userA, today }, code)).status, 401);
});

test('a local profile from before Build 3 is claimed by the first invite, then locked to it', async () => {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.profiles[legacyUser] = { ...profile, createdAt: today, updatedAt: today }; // no inviteId
  writeFileSync(file, JSON.stringify(data));

  assert.equal((await get(api.context, { userId: legacyUser, today }, codeB)).status, 200);
  assert.ok((await db.getProfile(legacyUser)).inviteId);
  assert.equal((await get(api.context, { userId: legacyUser, today }, codeA)).status, 403);
});

test('labels must be nicknames: lowercase, numbers and dashes only', () => {
  for (const ok of ['tester-3', 'dev', 'a1']) assert.match(ok, invites.LABEL_FORMAT);
  for (const bad of ['Julia Simon', "x'); drop table invites;--", '', 'a'.repeat(31)]) assert.doesNotMatch(bad, invites.LABEL_FORMAT);
});
