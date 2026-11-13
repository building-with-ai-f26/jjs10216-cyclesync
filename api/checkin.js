// POST /api/checkin  { userId, checkin }
// Step 5 (for now): checks the answers, then runs the safety screen.
//   - A safety rule fires → { ok, safety: [{ rule, message }] }. Nothing else runs.
//   - No rule fires       → { ok, checkin }  (step 6 adds the AI recommendation here)
// Step 6 also saves every check-in with an ID.
import { getProfile } from '../lib/db.js';
import { isValidUserId } from '../lib/profile.js';
import { validateCheckin } from '../lib/checkin.js';
import { safetyScreen } from '../lib/safety.js';

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

  // Safety screen FIRST (spec section 3). If it fires, stop here: no workout
  // advice, and the AI must never be called.
  const safety = safetyScreen(result.checkin);
  if (safety) return Response.json({ ok: true, safety: safety.rules });

  return Response.json({ ok: true, checkin: result.checkin });
}

function error(status, message) {
  return Response.json({ error: message }, { status });
}
