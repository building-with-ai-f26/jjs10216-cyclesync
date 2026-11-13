// Output checks (research/recommendation-spec.md section 7).
// Every AI answer (real or mock) goes through these before she sees it.
// If an answer fails, lib/pipeline.js retries once, then shows the safe fallback.

export const VERDICTS = ['KEEP', 'ADJUST', 'SWAP', 'REST'];

export const BANNED_PHRASES = [
  "because you're in your",
  'your hormones',
  'science says',
  'follicular phase is best',
  'luteal phase means',
  'calorie',
  'diet',
];

// "No mention of ovulation, fertility, or pregnancy" (catches ovulate,
// ovulatory, fertile, infertility, pregnant...).
const FORBIDDEN_TOPICS = /ovulat|fertil|pregnan/i;

// Hard sessions for the cramps rule: tempo, intervals, HIIT, heavy lifting.
export function isHardSession(workout) {
  return (
    (workout.type === 'run' && (workout.kind === 'tempo' || workout.kind === 'intervals')) ||
    (workout.type === 'class' && workout.classType === 'hiit') ||
    (workout.type === 'strength' && workout.load === 'heavy')
  );
}

// The AI replies with text. Read the JSON out of it (tolerating stray text
// around it), or return null.
export function parseOutput(text) {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text.trim());
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

// Returns { ok: true, recommendation } with only the five allowed fields,
// or { ok: false, errors: [...] } listing every rule it broke.
export function checkOutput(output, checkin) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { ok: false, errors: ['not valid JSON'] };
  }
  const errors = [];
  const text = (v) => (typeof v === 'string' ? v.trim() : '');

  const rec = {
    verdict: output.verdict,
    headline: text(output.headline),
    prescription: text(output.prescription),
    reason: text(output.reason),
    extra_tip: text(output.extra_tip) || null,
  };

  if (!VERDICTS.includes(rec.verdict)) errors.push('verdict is not KEEP, ADJUST, SWAP or REST');
  if (!rec.headline) errors.push('headline is missing');
  if (!rec.reason) errors.push('reason is missing');
  if (!/\d/.test(rec.prescription)) errors.push('prescription has no number');

  const all = [rec.headline, rec.prescription, rec.reason, rec.extra_tip ?? ''].join('\n');
  const lower = all.toLowerCase().replace(/[‘’]/g, "'"); // curly apostrophes count too
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) errors.push(`banned phrase: "${phrase}"`);
  }
  if (FORBIDDEN_TOPICS.test(all)) errors.push('mentions ovulation, fertility or pregnancy');

  if (checkin.symptoms.includes('cramps') && rec.verdict === 'KEEP' && isHardSession(checkin.workout)) {
    errors.push('KEEP on a hard session with cramps');
  }

  return errors.length ? { ok: false, errors } : { ok: true, recommendation: rec };
}
