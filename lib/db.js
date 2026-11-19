// The ONLY file the rest of the app uses to read or write saved data.
//
// Two places data can live, with the same functions:
//   - Local (laptop):   data/cyclesync-db.json        → lib/db-local.js
//   - Live (Vercel):    Supabase Postgres, via REST    → lib/db-supabase.js
//
// Supabase is used only when SUPABASE_SECRET_KEY is set. That key lives only
// in Vercel's environment settings, never in the local .env, so the laptop
// always uses the local file (even though .env has SUPABASE_URL for the
// security test).
// On Vercel without the key, every call stops with a clear error instead of
// trying to write a file (Vercel can't keep files between requests).

import * as local from './db-local.js';
import { createSupabaseDb } from './db-supabase.js';

export const AI_LIMITS = local.AI_LIMITS; // same numbers as take_ai_slot() in supabase/schema.sql
export const WRITE_LIMITS = local.WRITE_LIMITS; // same numbers as take_write_slot()

let supabase = null;

export function storageMode(env = process.env) {
  if (env.SUPABASE_SECRET_KEY) return 'supabase';
  if (env.VERCEL) return 'missing';
  return 'local';
}

function backend() {
  const mode = storageMode();
  if (mode === 'local') return local;
  if (mode === 'missing') {
    throw new Error('No database is set up: add SUPABASE_URL and SUPABASE_SECRET_KEY in Vercel → Settings → Environment Variables.');
  }
  supabase ??= createSupabaseDb({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY });
  return supabase;
}

// Invites (lib/invites.js)
export const findInviteByHash = (codeHash) => backend().findInviteByHash(codeHash);
export const addInvite = (label, codeHash) => backend().addInvite(label, codeHash);

// Onboarding answers
export const saveProfile = (userId, profile, inviteId) => backend().saveProfile(userId, profile, inviteId);
export const getProfile = (userId) => backend().getProfile(userId);
export const setProfileInvite = (userId, inviteId) => backend().setProfileInvite(userId, inviteId);
export const updatePeriodStart = (userId, date) => backend().updatePeriodStart(userId, date);

// Check-ins and her response
export const saveCheckin = (record) => backend().saveCheckin(record);
export const getCheckin = (checkinId) => backend().getCheckin(checkinId);
export const saveResponse = (userId, checkinId, response) => backend().saveResponse(userId, checkinId, response);

// Rate limit
export const takeAiSlot = (inviteId) => backend().takeAiSlot(inviteId);
export const takeWriteSlot = (inviteId, route) => backend().takeWriteSlot(inviteId, route);
