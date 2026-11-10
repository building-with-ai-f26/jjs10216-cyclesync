// POST /api/period  { userId, date }  → "My period started" (updates her last period start)
import { updatePeriodStart } from '../lib/db.js';
import { isValidUserId, isValidPeriodDate } from '../lib/profile.js';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error(400, 'Could not read the request.');
  }
  if (!isValidUserId(body?.userId)) return error(400, 'Invalid user ID.');
  if (!isValidPeriodDate(body.date)) return error(400, 'Invalid date.');

  const profile = await updatePeriodStart(body.userId, body.date);
  if (!profile) return error(400, 'Please finish setup first.');
  return Response.json({ ok: true, lastPeriodStart: profile.lastPeriodStart });
}

function error(status, message) {
  return Response.json({ error: message }, { status });
}
