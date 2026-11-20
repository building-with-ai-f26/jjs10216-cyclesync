// Local storage for development: one JSON file on this laptop,
// data/cyclesync-db.json (ignored by Git, so health data never reaches GitHub).
// Only lib/db.js uses this file. The live site uses lib/db-supabase.js instead,
// with the same functions.
//
// Tests point CYCLESYNC_DB_FILE at a temporary file so they never touch real data.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const DB_FILE =
  process.env.CYCLESYNC_DB_FILE || join(import.meta.dirname, '..', 'data', 'cyclesync-db.json');

// Safety net (added after a test wrote to the real file on Nov 17): under
// `node --test`, refuse to use the real data file. Tests must set
// CYCLESYNC_DB_FILE to a temporary file before importing this.
if (process.env.NODE_TEST_CONTEXT && !process.env.CYCLESYNC_DB_FILE) {
  throw new Error('Tests must set CYCLESYNC_DB_FILE to a temporary file before importing lib/db.js.');
}

function emptyDb() {
  return { invites: {}, profiles: {}, checkins: {}, aiCalls: [], writeCalls: [] };
}

function load() {
  try {
    // Files from before Build 3 have no invites list yet.
    return { invites: {}, aiCalls: [], writeCalls: [], ...JSON.parse(readFileSync(DB_FILE, 'utf8')) };
  } catch (err) {
    if (err.code === 'ENOENT') return emptyDb();
    throw err;
  }
}

// Write to a temporary file first, then swap it in, so a crash mid-write
// can't leave a half-written data file.
function save(db) {
  mkdirSync(dirname(DB_FILE), { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, DB_FILE);
}

// ---------- Invites (lib/invites.js) ----------
// Stored by the SHA-256 hash of the code, never the code itself.

// { id, label } for a hash that exists and isn't revoked, otherwise null.
export async function findInviteByHash(codeHash) {
  const invite = Object.values(load().invites).find((i) => i.codeHash === codeHash);
  if (!invite || invite.revokedAt) return null;
  return { id: invite.id, label: invite.label };
}

// Local file only (npm run invite -- --local <label>). Live invites are added
// with the SQL line the invite script prints.
export async function addInvite(label, codeHash) {
  const db = load();
  const id = randomUUID();
  db.invites[id] = { id, codeHash, label, createdAt: new Date().toISOString(), revokedAt: null };
  save(db);
  return id;
}

// Onboarding answers for one anonymous user, tied to the invite that made them.
export async function saveProfile(userId, profile, inviteId = null) {
  const db = load();
  const now = new Date().toISOString();
  const existing = db.profiles[userId];
  db.profiles[userId] = {
    ...profile,
    inviteId: existing?.inviteId ?? inviteId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  save(db);
  return db.profiles[userId];
}

export async function getProfile(userId) {
  return load().profiles[userId] ?? null;
}

// ---------- Rate limit on AI check-ins (Plan.md B3-5) ----------
// Same rules as take_ai_slot() in supabase/schema.sql. Only check-ins that
// reach the AI count (safety-screen check-ins never do).
export const AI_LIMITS = { per10Min: 5, perDay: 20, globalPerDay: 300 };

// Records one AI check-in for this invite if every limit allows it.
// Returns 'ok', or why not: 'invalid_invite', 'per_10_min', 'per_day', 'global_day'.
// Locally, reading, counting and saving happen with no pause in between, so
// many calls at once are still counted one by one.
export async function takeAiSlot(inviteId) {
  const db = load();
  const invite = db.invites[inviteId];
  if (!invite || invite.revokedAt) return 'invalid_invite';

  const now = Date.now();
  const since = (ms) => (c) => Date.parse(c.createdAt) > now - ms;
  db.aiCalls = db.aiCalls.filter(since(DAY_MS)); // older calls never count again
  const mine = db.aiCalls.filter((c) => c.inviteId === inviteId);
  if (mine.filter(since(10 * 60_000)).length >= AI_LIMITS.per10Min) return 'per_10_min';
  if (mine.length >= AI_LIMITS.perDay) return 'per_day';
  if (db.aiCalls.length >= AI_LIMITS.globalPerDay) return 'global_day';

  db.aiCalls.push({ inviteId, createdAt: new Date(now).toISOString() });
  save(db);
  return 'ok';
}
const DAY_MS = 24 * 60 * 60_000;

// ---------- Rate limit on every route that saves data (Build 3) ----------
// Same rules as take_write_slot() in supabase/schema.sql: 30 saves per 10
// minutes and 100 per day per invite, across onboarding, check-in, response
// and period. Returns 'ok', or why not: 'invalid_invite', 'writes_10_min', 'writes_day'.
export const WRITE_LIMITS = { per10Min: 30, perDay: 100 };

export async function takeWriteSlot(inviteId, route) {
  const db = load();
  const invite = db.invites[inviteId];
  if (!invite || invite.revokedAt) return 'invalid_invite';

  const now = Date.now();
  const since = (ms) => (c) => Date.parse(c.createdAt) > now - ms;
  db.writeCalls = db.writeCalls.filter(since(DAY_MS)); // older saves never count again
  const mine = db.writeCalls.filter((c) => c.inviteId === inviteId);
  if (mine.filter(since(10 * 60_000)).length >= WRITE_LIMITS.per10Min) return 'writes_10_min';
  if (mine.length >= WRITE_LIMITS.perDay) return 'writes_day';

  db.writeCalls.push({ inviteId, route, createdAt: new Date(now).toISOString() });
  save(db);
  return 'ok';
}

// Gives a pre-Build 3 local profile (no invite yet) to an invite.
export async function setProfileInvite(userId, inviteId) {
  const db = load();
  if (!db.profiles[userId]) return;
  db.profiles[userId].inviteId = inviteId;
  save(db);
}

// One check-in: her answers, cycle day/phase, the safety result or the
// recommendation, and (for the AI) model, tokens and cost. Returns its new ID.
export async function saveCheckin(record) {
  const db = load();
  const id = randomUUID();
  db.checkins[id] = { id, ...record, response: null, createdAt: new Date().toISOString() };
  save(db);
  return id;
}

export async function getCheckin(checkinId) {
  return load().checkins[checkinId] ?? null;
}

// Her answer to the card: do_this / original_plan / something_else / rest.
// Only for her own check-ins that showed a recommendation (not a safety message).
// Returns the updated check-in, or null if that isn't allowed.
export async function saveResponse(userId, checkinId, response) {
  const db = load();
  const checkin = db.checkins[checkinId];
  if (!checkin || checkin.userId !== userId || !checkin.recommendation) return null;
  checkin.response = response;
  checkin.respondedAt = new Date().toISOString();
  save(db);
  return checkin;
}

// "My period started": set a new last period start. Returns null if she hasn't onboarded.
export async function updatePeriodStart(userId, date) {
  const db = load();
  const profile = db.profiles[userId];
  if (!profile) return null;
  profile.lastPeriodStart = date;
  profile.updatedAt = new Date().toISOString();
  save(db);
  return profile;
}
