// Rate limit on every route that saves data (Build 3).
// Each save first takes a "write slot" for her invite (lib/db.js →
// take_write_slot() in supabase/schema.sql). Over the limit → 429, nothing saved.
// AI check-ins also have their own, tighter limit (take_ai_slot).
import { takeWriteSlot } from './db.js';
import { inviteRequired } from './invites.js';

export const WRITE_LIMIT_MESSAGES = {
  writes_10_min: "You've made a lot of changes just now. Try again in a few minutes.",
  writes_day: "You've reached today's limit. Try again tomorrow.",
};

// Returns null when the save may go ahead, or the Response to send instead.
export async function limitWrite(request, inviteId, route) {
  const slot = await takeWriteSlot(inviteId, route);
  if (slot === 'ok') return null;
  if (slot === 'invalid_invite') return inviteRequired(request);
  return Response.json({ error: WRITE_LIMIT_MESSAGES[slot] }, { status: 429 });
}
