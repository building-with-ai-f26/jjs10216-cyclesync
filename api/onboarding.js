// GET  /api/onboarding?userId=...   → her saved onboarding answers (or 404)
// POST /api/onboarding  { userId, profile }  → checks and saves them
// Both need a valid invite code in the x-invite-code header (lib/invites.js).
import { readJson } from '../lib/request.js';
import { getProfile, saveProfile } from '../lib/db.js';
import { isValidUserId, validateProfile } from '../lib/profile.js';
import { inviteFor, inviteRequired, otherInvite, ownsProfile } from '../lib/invites.js';

export async function GET(request) {
  const invite = await inviteFor(request);
  if (!invite) return inviteRequired(request);
  const userId = new URL(request.url).searchParams.get('userId');
  if (!isValidUserId(userId)) return error(400, 'Invalid user ID.');

  const profile = await getProfile(userId);
  if (!profile) return error(404, 'No onboarding answers saved yet.');
  if (!(await ownsProfile(profile, invite, userId))) return otherInvite();
  return Response.json({ profile });
}

export async function POST(request) {
  const invite = await inviteFor(request);
  if (!invite) return inviteRequired(request);
  const { body, problem } = await readJson(request);
  if (problem) return problem;
  if (!isValidUserId(body?.userId)) return error(400, 'Invalid user ID.');

  const result = validateProfile(body.profile);
  if (!result.ok) return error(400, result.error);

  const existing = await getProfile(body.userId);
  if (existing && !(await ownsProfile(existing, invite, body.userId))) return otherInvite();

  const profile = await saveProfile(body.userId, result.profile, invite.id);
  return Response.json({ ok: true, profile });
}

function error(status, message) {
  return Response.json({ error: message }, { status });
}
