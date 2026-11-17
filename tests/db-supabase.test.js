// lib/db-supabase.js (live storage) against a stand-in for Supabase's REST API
// that keeps tables in memory. Nothing goes online.
//
// The same behaviour tests run against the local file (lib/db-local.js), so
// the two can't drift apart: the rest of the app must not be able to tell
// which one it's using.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupabaseDb } from '../lib/db-supabase.js';

const URL_ = 'https://example-project.supabase.co';
const KEY = 'sb_secret_TEST_ONLY_not_a_real_key';

// ---------- A tiny in-memory PostgREST ----------
function fakeSupabase() {
  const tables = { invites: [], profiles: [], checkins: [], ai_calls: [] };
  const requests = [];
  const reply = (data, status = 200) => new Response(data === null ? '' : JSON.stringify(data), { status });

  async function fetchFn(url, options) {
    requests.push({ url, ...options });
    const u = new URL(url);
    const path = u.pathname.replace('/rest/v1/', '');
    const body = options.body ? JSON.parse(options.body) : undefined;
    const wantRows = options.headers.Prefer === 'return=representation';

    if (path === 'rpc/take_ai_slot') {
      if (!tables.invites.some((i) => i.id === body.p_invite_id && !i.revoked_at)) return reply('invalid_invite');
      tables.ai_calls.push({ id: randomUUID(), invite_id: body.p_invite_id, created_at: new Date().toISOString() });
      return reply('ok');
    }
    const rows = tables[path];
    if (!rows) return reply({ code: 'PGRST205', message: 'not found' }, 404);
    const filters = [...u.searchParams].filter(([k]) => k !== 'select');
    const match = (r) => filters.every(([k, v]) => (v === 'is.null' ? r[k] == null : v.startsWith('eq.') && String(r[k]) === v.slice(3)));

    if (options.method === 'GET') return reply(rows.filter(match));
    if (options.method === 'POST') {
      const now = new Date().toISOString();
      const row = { created_at: now, ...(path === 'profiles' ? {} : { id: randomUUID() }), response: null, responded_at: null, revoked_at: null, ...body };
      if (path === 'profiles' && rows.some((r) => r.user_id === row.user_id)) return reply({ code: '23505', message: 'duplicate key' }, 409);
      rows.push(row);
      return wantRows ? reply([row], 201) : reply(null, 201);
    }
    if (options.method === 'PATCH') {
      const changed = rows.filter(match);
      for (const r of changed) Object.assign(r, body);
      return wantRows ? reply(changed) : reply(null, 204);
    }
    return reply({ message: 'unsupported' }, 400);
  }
  return { tables, requests, fetchFn };
}

// ---------- The two backends, set up the same way ----------
// The temporary file is set BEFORE lib/db-local.js (or lib/db.js, which loads
// it) is imported, so the real data/cyclesync-db.json is never touched.
const dir = mkdtempSync(join(tmpdir(), 'cyclesync-dbcontract-'));
let local, storageMode;
before(async () => {
  process.env.CYCLESYNC_DB_FILE = join(dir, 'db.json');
  local = await import('../lib/db-local.js');
  ({ storageMode } = await import('../lib/db.js'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const backends = {
  'local file': () => ({ db: local, seedInvite: (label, hash) => local.addInvite(label, hash) }),
  'Supabase (stand-in)': () => {
    const fake = fakeSupabase();
    const db = createSupabaseDb({ url: URL_, key: KEY, fetchFn: fake.fetchFn });
    const seedInvite = async (label, code_hash) => {
      const id = randomUUID();
      fake.tables.invites.push({ id, code_hash, label, created_at: new Date().toISOString(), revoked_at: null });
      return id;
    };
    return { db, seedInvite, fake };
  },
};

const answers = {
  lastPeriodStart: '2026-11-01', cycleLength: 28, contraception: 'no',
  patterns: { energyLowerBeforePeriod: 'yes', crampsAffectWorkouts: 'sometimes' },
  workoutDays: ['mon'], goal: 'stay_consistent',
};
const rec = { verdict: 'ADJUST', headline: 'Easy 3 miles', prescription: '3 easy miles (effort 4/10).', reason: 'Low energy.', extra_tip: null };
const hex = (c) => c.repeat(64);

for (const [name, make] of Object.entries(backends)) {
  test(`${name}: invites are found by hash; unknown ones are not`, async () => {
    const { db, seedInvite } = make();
    const id = await seedInvite('tester-1', hex('a'));
    assert.deepEqual(await db.findInviteByHash(hex('a')), { id, label: 'tester-1' });
    assert.equal(await db.findInviteByHash(hex('b')), null);
  });

  test(`${name}: profiles save, read back, and keep their invite and created date`, async () => {
    const { db, seedInvite } = make();
    const inviteId = await seedInvite('tester-2', hex('c'));
    const userId = randomUUID();
    assert.equal(await db.getProfile(userId), null);
    const saved = await db.saveProfile(userId, answers, inviteId);
    assert.equal(saved.cycleLength, 28);
    assert.equal(saved.inviteId, inviteId);
    const first = await db.getProfile(userId);
    assert.deepEqual(first.patterns, answers.patterns);
    assert.ok(first.createdAt);

    await db.saveProfile(userId, { ...answers, cycleLength: 30 }, randomUUID());
    const second = await db.getProfile(userId);
    assert.equal(second.cycleLength, 30);
    assert.equal(second.inviteId, inviteId, 'the invite never changes');
    assert.equal(second.createdAt, first.createdAt);
  });

  test(`${name}: "My period started" changes only the period date`, async () => {
    const { db, seedInvite } = make();
    const inviteId = await seedInvite('tester-3', hex('d'));
    const userId = randomUUID();
    await db.saveProfile(userId, answers, inviteId);
    const updated = await db.updatePeriodStart(userId, '2026-11-15');
    assert.equal(updated.lastPeriodStart, '2026-11-15');
    const p = await db.getProfile(userId);
    assert.equal(p.lastPeriodStart, '2026-11-15');
    assert.equal(p.cycleLength, 28);
    assert.equal(p.inviteId, inviteId);
    assert.equal(await db.updatePeriodStart(randomUUID(), '2026-11-15'), null);
  });

  test(`${name}: check-ins save and read back the same; responses only on her own recommendation cards`, async () => {
    const { db, seedInvite } = make();
    const inviteId = await seedInvite('tester-4', hex('e'));
    const userId = randomUUID();
    await db.saveProfile(userId, answers, inviteId);
    const record = {
      userId, inviteId, date: '2026-11-17', checkin: { energy: 2 }, cycle: { cycleDay: 17, phase: 'luteal' },
      safety: null, recommendation: rec, source: 'ai', attempts: 1, failures: [], rejected: [], model: 'm', usage: { tokensIn: 1, tokensOut: 2, cost: 0.001 },
    };
    const id = await db.saveCheckin(record);
    assert.match(id, /^[0-9a-f-]{36}$/);
    const saved = await db.getCheckin(id);
    for (const [k, v] of Object.entries(record)) assert.deepEqual(saved[k], v, k);
    assert.equal(saved.response, null);

    assert.equal(await db.saveResponse(randomUUID(), id, 'rest'), null, "someone else's check-in");
    assert.equal(await db.saveResponse(userId, randomUUID(), 'rest'), null, 'unknown check-in');
    assert.equal(await db.getCheckin('nope'), null);
    const safetyId = await db.saveCheckin({ ...record, safety: ['heavy_bleeding'], recommendation: null, source: 'safety' });
    assert.equal(await db.saveResponse(userId, safetyId, 'rest'), null, 'safety message');

    const answered = await db.saveResponse(userId, id, 'do_this');
    assert.equal(answered.response, 'do_this');
    assert.equal((await db.getCheckin(id)).response, 'do_this');
    assert.ok((await db.getCheckin(id)).respondedAt);
  });

  test(`${name}: an AI slot for a known invite is "ok", for an unknown one "invalid_invite"`, async () => {
    const { db, seedInvite } = make();
    const inviteId = await seedInvite('tester-5', hex('f'));
    assert.equal(await db.takeAiSlot(inviteId), 'ok');
    assert.equal(await db.takeAiSlot(randomUUID()), 'invalid_invite');
  });
}

// ---------- Supabase only: how the key is used ----------
test('Supabase: every request sends the secret key only in the apikey header', async () => {
  const { db, seedInvite, fake } = backends['Supabase (stand-in)']();
  const inviteId = await seedInvite('tester-6', hex('1'));
  const userId = randomUUID();
  await db.saveProfile(userId, answers, inviteId);
  await db.getProfile(userId);
  await db.takeAiSlot(inviteId);
  assert.ok(fake.requests.length >= 4);
  for (const r of fake.requests) {
    assert.ok(r.url.startsWith(`${URL_}/rest/v1/`));
    assert.equal(r.headers.apikey, KEY);
    assert.equal(r.headers.Authorization, undefined);
    assert.ok(!r.url.includes(KEY), 'never in the URL');
    assert.ok(!(r.body || '').includes(KEY), 'never in the body');
  }
});

test('Supabase: errors are plain and never contain the key', async () => {
  const fetchFn = async () => new Response(JSON.stringify({ code: '42501', message: 'permission denied for table profiles' }), { status: 401 });
  const db = createSupabaseDb({ url: URL_, key: KEY, fetchFn });
  await assert.rejects(db.getProfile(randomUUID()), (err) => {
    assert.match(err.message, /Database error 401 \(42501\): permission denied/);
    assert.ok(!err.message.includes(KEY));
    return true;
  });
  const down = createSupabaseDb({ url: URL_, key: KEY, fetchFn: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(down.getProfile(randomUUID()), /Could not reach the database/);
});

test('Supabase: refuses to start with the wrong kind of key or URL', () => {
  assert.throws(() => createSupabaseDb({ url: URL_, key: 'sb_publishable_abc' }), /secret key/);
  assert.throws(() => createSupabaseDb({ url: URL_, key: '' }), /secret key/);
  assert.throws(() => createSupabaseDb({ url: 'http://example.com', key: KEY }), /SUPABASE_URL/);
});

test('storage choice: secret key → Supabase; laptop → local file; Vercel without the key → clear error', async () => {
  assert.equal(storageMode({ SUPABASE_URL: URL_ }), 'local', 'URL alone (for the security test) keeps the laptop on the local file');
  assert.equal(storageMode({ SUPABASE_URL: URL_, SUPABASE_SECRET_KEY: KEY }), 'supabase');
  assert.equal(storageMode({ VERCEL: '1' }), 'missing');
});
