// The ONLY file that reads or writes saved data.
//
// Build 2: everything lives in one JSON file on this laptop: data/cyclesync-db.json
// (ignored by Git, so health data never reaches GitHub).
// When we deploy, only the insides of these functions change to use a hosted
// database. Every other file keeps calling them the same way.
//
// Tests point CYCLESYNC_DB_FILE at a temporary file so they never touch real data.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const DB_FILE =
  process.env.CYCLESYNC_DB_FILE || join(import.meta.dirname, '..', 'data', 'cyclesync-db.json');

function emptyDb() {
  return { invites: {}, profiles: {}, checkins: {} };
}

function load() {
  try {
    // Files from before Build 3 have no invites list yet.
    return { invites: {}, ...JSON.parse(readFileSync(DB_FILE, 'utf8')) };
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
