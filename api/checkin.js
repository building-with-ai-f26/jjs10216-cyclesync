// POST /api/checkin  { userId, today: "YYYY-MM-DD", checkin }
// Checks the answers, then runs the full pipeline (lib/pipeline.js):
// safety screen → context → AI → output checks (retry once → fallback) → save.
//   - A safety rule fires → { ok, checkinId, safety: [{ rule, message }] }. The AI never runs.
//   - Otherwise           → { ok, checkinId, recommendation, cycle: { cycleDay, phase } }
import { getProfile } from '../lib/db.js';
import { isValidUserId } from '../lib/profile.js';
import { validateCheckin } from '../lib/checkin.js';
import { isValidToday } from '../lib/cycle.js';
import { runCheckin } from '../lib/pipeline.js';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error(400, 'Could not read the request.');
  }
  if (!isValidUserId(body?.userId)) return error(400, 'Invalid user ID.');
  if (!isValidToday(body.today)) return error(400, "Today's date looks wrong. Please reload the page.");
  const profile = await getProfile(body.userId);
  if (!profile) return error(400, 'Please finish setup first.');

  const result = validateCheckin(body.checkin);
  if (!result.ok) return error(400, result.error);

  const outcome = await runCheckin({ userId: body.userId, profile, checkin: result.checkin, today: body.today });
  return Response.json({ ok: true, ...outcome });
}

function error(status, message) {
  return Response.json({ error: message }, { status });
}
