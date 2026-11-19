// POST /api/response  { userId, checkinId, response }
// Saves what she tapped on the recommendation card, attached to that check-in.
// Needs a valid invite code (lib/invites.js). Rate limited (lib/rate-limit.js).
import { readJson } from '../lib/request.js';
import { getProfile, saveResponse } from '../lib/db.js';
import { isValidUserId } from '../lib/profile.js';
import { inviteFor, inviteRequired, otherInvite, ownsProfile } from '../lib/invites.js';
import { limitWrite } from '../lib/rate-limit.js';

export const RESPONSES = ['do_this', 'original_plan', 'something_else', 'rest'];

export async function POST(request) {
  const invite = await inviteFor(request);
  if (!invite) return inviteRequired(request);
  const { body, problem } = await readJson(request);
  if (problem) return problem;
  if (!isValidUserId(body?.userId)) return error(400, 'Invalid user ID.');
  if (typeof body.checkinId !== 'string') return error(400, 'Missing check-in ID.');
  if (!RESPONSES.includes(body.response)) return error(400, 'Unknown response.');

  const profile = await getProfile(body.userId);
  if (!profile) return error(404, 'Check-in not found.');
  if (!(await ownsProfile(profile, invite, body.userId))) return otherInvite();

  const limited = await limitWrite(request, invite.id, 'response');
  if (limited) return limited;
  const saved = await saveResponse(body.userId, body.checkinId, body.response);
  if (!saved) return error(404, 'Check-in not found.');
  return Response.json({ ok: true, response: saved.response });
}

function error(status, message) {
  return Response.json({ error: message }, { status });
}
