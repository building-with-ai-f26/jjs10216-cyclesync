// GET /api/context?userId=...&today=YYYY-MM-DD
// Everything the check-in screen needs to open: her setup answers plus
// today's cycle day and estimated phase. 404 means she hasn't set up yet.
import { getProfile } from '../lib/db.js';
import { isValidUserId } from '../lib/profile.js';
import { cycleContext, isValidToday } from '../lib/cycle.js';

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const userId = params.get('userId');
  const today = params.get('today');
  if (!isValidUserId(userId)) return error(400, 'Invalid user ID.');
  if (!isValidToday(today)) return error(400, 'Invalid date.');

  const profile = await getProfile(userId);
  if (!profile) return error(404, 'No onboarding answers saved yet.');

  return Response.json({ profile, cycle: cycleContext(profile, today) });
}

function error(status, message) {
  return Response.json({ error: message }, { status });
}
