// The check-in pipeline (research/recommendation-spec.md section 1), in this order:
//   1. Collect: the check-in has already passed validateCheckin (lib/checkin.js).
//   2. Safety screen in code (lib/safety.js). If a rule fires: save, stop.
//      The AI is NEVER called.
//   3. Build context: cycle day, estimated phase (or none), her patterns, today.
//   4. Call the AI (lib/ai.js) with the section 5 instructions.
//   5. Check the output (lib/checks.js). Fails → retry once. Fails again → the
//      safe fallback below.
//   6. Save the check-in and recommendation under a check-in ID. Her response
//      (Do this / Original plan / Something else / Rest) attaches to it later.

import { safetyScreen } from './safety.js';
import { cycleContext } from './cycle.js';
import { SYSTEM_PROMPT, buildContext, buildUserMessage } from './prompt.js';
import { parseOutput, checkOutput } from './checks.js';
import { getRecommendation } from './ai.js';
import { saveCheckin } from './db.js';

// Section 1, step 5: shown when the AI's answer fails the checks twice.
export const FALLBACK_MESSAGE = 'Go with an easy version of your planned workout and listen to your body today';

const MAX_ATTEMPTS = 2; // first try + one retry

// `ai` can be swapped in tests (for example, a fake that records whether it was called).
export async function runCheckin({ userId, profile, checkin, today }, { ai = getRecommendation } = {}) {
  const cycle = cycleContext(profile, today);
  const cycleSummary = { cycleDay: cycle.cycleDay, phase: cycle.phase };

  // 2. Safety screen first.
  const safety = safetyScreen(checkin);
  if (safety) {
    const checkinId = await saveCheckin({
      userId, date: today, checkin, cycle: cycleSummary,
      safety: safety.rules.map((r) => r.rule),
      recommendation: null, source: 'safety', attempts: 0,
    });
    return { checkinId, safety: safety.rules };
  }

  // 3. Context, 4. AI, 5. checks (retry once).
  const context = buildContext(profile, checkin, cycle);
  const user = buildUserMessage(context);
  let recommendation = null;
  let model = null;
  const usage = { tokensIn: 0, tokensOut: 0, cost: 0 };
  const failures = [];
  const rejected = []; // answers that failed the checks, kept so they can be reviewed
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS && !recommendation) {
    attempts++;
    try {
      const reply = await ai({ system: SYSTEM_PROMPT, user, context });
      model = reply.model;
      usage.tokensIn += reply.usage?.tokensIn ?? 0;
      usage.tokensOut += reply.usage?.tokensOut ?? 0;
      usage.cost += reply.usage?.cost ?? 0;
      const result = checkOutput(parseOutput(reply.text), checkin);
      if (result.ok) recommendation = result.recommendation;
      else {
        failures.push(result.errors);
        rejected.push({ text: reply.text, problems: result.errors });
      }
    } catch (err) {
      failures.push([`AI call failed: ${err.message}`]);
    }
    // A note in the server window (never the key or her answers) so problems are visible.
    if (!recommendation) console.warn(`[CycleSync] AI attempt ${attempts} failed: ${failures.at(-1).join('; ')}`);
  }

  const source = recommendation ? (model === 'mock' ? 'mock' : 'ai') : 'fallback';
  if (!recommendation) {
    recommendation = { verdict: null, headline: FALLBACK_MESSAGE, prescription: null, reason: null, extra_tip: null };
  }

  // 6. Save.
  const checkinId = await saveCheckin({
    userId, date: today, checkin, cycle: cycleSummary,
    safety: null, recommendation, source, attempts, failures, rejected, model, usage,
  });
  return { checkinId, recommendation, cycle: cycleSummary };
}
