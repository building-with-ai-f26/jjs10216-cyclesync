// POST /api/checkin  { userId, today: "YYYY-MM-DD", checkin }
// Needs a valid invite code (lib/invites.js). Checks the answers, then runs the full pipeline (lib/pipeline.js):
// safety screen → context → AI → output checks (retry once → fallback) → save.
//   - A safety rule fires → { ok, checkinId, safety: [{ rule, message }] }. The AI never runs.
//   - Otherwise           → { ok, checkinId, recommendation, cycle: { cycleDay, phase } }
//   - Over the rate limit → 429 { error }. Nothing saved, no AI call.
import { readJson } from '../lib/request.js';
import { getProfile } from '../lib/db.js';
import { isValidUserId } from '../lib/profile.js';
import { validateCheckin } from '../lib/checkin.js';
import { isValidToday } from '../lib/cycle.js';
import { runCheckin } from '../lib/pipeline.js';
import { inviteFor, inviteRequired, otherInvite, ownsProfile } from '../lib/invites.js';

export async function POST(request) {
  const invite = await inviteFor(request);
  if (!invite) return inviteRequired(request);
  const { body, problem } = await readJson(request);
  if (problem) return problem;
  if (!isValidUserId(body?.userId)) return error(400, 'Invalid user ID.');
  if (!isValidToday(body.today)) return error(400, "Today's date looks wrong. Please reload the page.");
  const profile = await getProfile(body.userId);
  if (!profile) return error(400, 'Please finish setup first.');
  if (!(await ownsProfile(profile, invite, body.userId))) return otherInvite();

  const result = validateCheckin(body.checkin);
  if (!result.ok) return error(400, result.error);

  const outcome = await runCheckin({ userId: body.userId, inviteId: invite.id, profile, checkin: result.checkin, today: body.today });
  if (outcome.rateLimited === 'invalid_invite') return inviteRequired(request);
  if (outcome.rateLimited) return error(429, RATE_LIMIT_MESSAGES[outcome.rateLimited]);
  return Response.json({ ok: true, ...outcome });
}

// Rate limit (Plan.md B3-5): 5 per 10 minutes and 20 per day per invite, 300 per day overall.
export const RATE_LIMIT_MESSAGES = {
  per_10_min: "You've checked in a lot just now. Try again in a few minutes.",
  per_day: "You've reached today's check-in limit. Try again tomorrow.",
  global_day: 'CycleSync has reached its limit for today. Please try again tomorrow.',
};

function error(status, message) {
  return Response.json({ error: message }, { status });
}
