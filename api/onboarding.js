// GET  /api/onboarding?userId=...   → her saved onboarding answers (or 404)
// POST /api/onboarding  { userId, profile }  → checks and saves them
import { getProfile, saveProfile } from '../lib/db.js';
import { isValidUserId, validateProfile } from '../lib/profile.js';

export async function GET(request) {
  const userId = new URL(request.url).searchParams.get('userId');
  if (!isValidUserId(userId)) return error(400, 'Invalid user ID.');

  const profile = await getProfile(userId);
  if (!profile) return error(404, 'No onboarding answers saved yet.');
  return Response.json({ profile });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error(400, 'Could not read the request.');
  }
  if (!isValidUserId(body?.userId)) return error(400, 'Invalid user ID.');

  const result = validateProfile(body.profile);
  if (!result.ok) return error(400, result.error);

  const profile = await saveProfile(body.userId, result.profile);
  return Response.json({ ok: true, profile });
}

function error(status, message) {
  return Response.json({ error: message }, { status });
}
