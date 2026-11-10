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

const DB_FILE =
  process.env.CYCLESYNC_DB_FILE || join(import.meta.dirname, '..', 'data', 'cyclesync-db.json');

function emptyDb() {
  return { profiles: {}, checkins: {} };
}

function load() {
  try {
    return JSON.parse(readFileSync(DB_FILE, 'utf8'));
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

// Onboarding answers for one anonymous user.
export async function saveProfile(userId, profile) {
  const db = load();
  const now = new Date().toISOString();
  db.profiles[userId] = {
    ...profile,
    createdAt: db.profiles[userId]?.createdAt ?? now,
    updatedAt: now,
  };
  save(db);
  return db.profiles[userId];
}

export async function getProfile(userId) {
  return load().profiles[userId] ?? null;
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
