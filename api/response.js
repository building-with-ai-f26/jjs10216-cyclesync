// POST /api/response  { userId, checkinId, response }
// Saves what she tapped on the recommendation card, attached to that check-in.
import { saveResponse } from '../lib/db.js';
import { isValidUserId } from '../lib/profile.js';

export const RESPONSES = ['do_this', 'original_plan', 'something_else', 'rest'];

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error(400, 'Could not read the request.');
  }
  if (!isValidUserId(body?.userId)) return error(400, 'Invalid user ID.');
  if (typeof body.checkinId !== 'string') return error(400, 'Missing check-in ID.');
  if (!RESPONSES.includes(body.response)) return error(400, 'Unknown response.');

  const saved = await saveResponse(body.userId, body.checkinId, body.response);
  if (!saved) return error(404, 'Check-in not found.');
  return Response.json({ ok: true, response: saved.response });
}

function error(status, message) {
  return Response.json({ error: message }, { status });
}
