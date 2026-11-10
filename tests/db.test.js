// Saving and loading (lib/db.js), using a temporary file instead of real data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cyclesync-test-'));
const file = join(dir, 'db.json');
let db;

before(async () => {
  process.env.CYCLESYNC_DB_FILE = file;
  db = await import('../lib/db.js');
});

after(() => rmSync(dir, { recursive: true, force: true }));

const userId = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';

test('returns null for someone who has not onboarded', async () => {
  assert.equal(await db.getProfile(userId), null);
});

test('saves a profile and reads it back', async () => {
  await db.saveProfile(userId, { cycleLength: 28 });
  const saved = await db.getProfile(userId);
  assert.equal(saved.cycleLength, 28);
  assert.ok(saved.createdAt);
  assert.ok(JSON.parse(readFileSync(file, 'utf8')).profiles[userId]);
});

test('"My period started" updates only the period date', async () => {
  await db.updatePeriodStart(userId, '2026-11-10');
  const saved = await db.getProfile(userId);
  assert.equal(saved.lastPeriodStart, '2026-11-10');
  assert.ok(saved.cycleLength);
});

test('"My period started" does nothing for someone who has not onboarded', async () => {
  assert.equal(await db.updatePeriodStart('00000000-0000-4000-8000-000000000000', '2026-11-10'), null);
});

test('editing keeps the original created date', async () => {
  const first = await db.getProfile(userId);
  await db.saveProfile(userId, { cycleLength: 30 });
  const second = await db.getProfile(userId);
  assert.equal(second.cycleLength, 30);
  assert.equal(second.createdAt, first.createdAt);
});
