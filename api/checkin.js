// POST /api/checkin  { userId, checkin }
// Step 3 (for now): checks the answers and sends them back. Nothing is saved yet.
// Step 6 replaces this with the full pipeline: safety screen → AI → checks → save.
import { getProfile } from '../lib/db.js';
import { isValidUserId } from '../lib/profile.js';
import { validateCheckin } from '../lib/checkin.js';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error(400, 'Could not read the request.');
  }
  if (!isValidUserId(body?.userId)) return error(400, 'Invalid user ID.');
  if (!(await getProfile(body.userId))) return error(400, 'Please finish setup first.');

  const result = validateCheckin(body.checkin);
  if (!result.ok) return error(400, result.error);

  return Response.json({ ok: true, checkin: result.checkin });
}

function error(status, message) {
  return Response.json({ error: message }, { status });
}
