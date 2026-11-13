// Safety screen (research/recommendation-spec.md, section 3).
//
// Runs in code, on the server, BEFORE any AI call. If a rule fires, the app
// shows that rule's fixed message, gives no workout advice, and stops: the AI
// is never called. The message text lives here (never AI-written) so it can be
// reviewed by a professional. Copy it exactly from the spec when it changes.
//
// Build 2 has the two "stop" rules. The two Build 3 rules in section 3 (iron
// check after repeated heavy flow + fatigue; long cycles) are not here yet.

export const SAFETY_MESSAGES = {
  heavy_bleeding:
    'That sounds like heavier bleeding than usual. Please check in with a doctor before training today, and rest is a good call.',
  severe_pain:
    "Severe pain that isn't easing is worth a call to your doctor. Skip training today.",
};

// The four heavy-flow follow-ups (spec section 2). Any one "yes" fires the rule.
const HEAVY_FLOW_SIGNS = ['soakingHourly', 'over7Days', 'largeClots', 'dizzyOrBreathless'];

// Takes a check-in that has already passed validateCheckin (lib/checkin.js).
// Returns null when no rule fires (the check-in can go on to the AI), or the
// rules that fired, in the spec's table order:
//   { stop: true, rules: [{ rule: 'heavy_bleeding', message: '...' }, ...] }
export function safetyScreen(checkin) {
  const rules = [];

  const symptoms = checkin?.symptoms ?? [];
  if (symptoms.includes('heavy_flow') && HEAVY_FLOW_SIGNS.some((sign) => checkin.heavyFlow?.[sign] === true)) {
    rules.push({ rule: 'heavy_bleeding', message: SAFETY_MESSAGES.heavy_bleeding });
  }
  if (symptoms.includes('cramps') && checkin.severePainNotEasing === true) {
    rules.push({ rule: 'severe_pain', message: SAFETY_MESSAGES.severe_pain });
  }

  return rules.length ? { stop: true, rules } : null;
}
