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

// Nov 17: a test imported lib/db.js before setting CYCLESYNC_DB_FILE and wrote
// test rows into the real data/cyclesync-db.json. Now lib/db-local.js refuses.
test('under node --test, the real data file is refused unless a temporary one is set', async () => {
  const { spawnSync } = await import('node:child_process');
  const env = { ...process.env, NODE_TEST_CONTEXT: 'child-v8' };
  delete env.CYCLESYNC_DB_FILE;
  const r = spawnSync(process.execPath, ['-e', "import('./lib/db-local.js').then(() => console.log('LOADED'), (e) => console.log('REFUSED', e.message))"], { cwd: join(import.meta.dirname, '..'), env, encoding: 'utf8' });
  assert.match(r.stdout, /REFUSED Tests must set CYCLESYNC_DB_FILE/);
});
