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

  const phaseTerm = all.match(PHASE_TERMS);
  if (phaseTerm) errors.push(`uses a phase term ("${phaseTerm[0]}")`);

  errors.push(...checkWithinPlan(rec, checkin));

  return errors.length ? { ok: false, errors } : { ok: true, recommendation: rec };
}

// ---------- Phase terms (spec section 5, rule 10) ----------
// The card's Day line already shows the estimated phase; the text never names it.
// ("menstrual cramps" is fine; "menstrual phase" is caught by "phase".)
const PHASE_TERMS = /\b(follicular|luteal|phases?)\b/i;

// ---------- Never longer or harder than planned (spec section 5, rule 7) ----------
// A code check on free text, so it uses simple, conservative rules:
//   - Distances (miles, km) and run times (minutes, hours) are added up within
//     each alternative ("3 miles easy, or a 30-minute walk" = two alternatives).
//     "the last 2 miles" / "the middle 3 miles" are part of the run, not extra.
//     A number followed by "total" or ":" is treated as the whole.
//   - Warm-up, cool-down, stretching, mobility, walking and yoga minutes don't
//     count as "longer" (they're easier than the planned training).
//   - Effort numbers (e.g. "effort 7/10") can't go above what the planned session
//     usually involves (EFFORT_CAP).
//   - Harder session types (tempo, intervals, sprints, heavy...) are only allowed
//     when the planned workout already was one.
//   - "extra", "additional" and "bonus" aren't allowed. Strides are the only
//     extra: 4-6 of them, on a run, on a great day (stridesAllowed).
//   - Mentions after "skip", "no", "instead of", "avoid"... don't count.
// Known limits: a breakdown like "5 miles: 1 easy, 3 tempo, 1 easy" is read
// correctly only with the colon or "total"; text that hides an increase in
// unusual wording can slip past. The real-AI run (npm run test:ai) is the backstop.

// Highest effort (1-10) a planned session usually involves.
const EFFORT_CAP = {
  run: { easy: 5, long: 6, tempo: 8, intervals: 9 },
  strength: { light: 6, heavy: 8 },
  class: { spin: 8, hiit: 9, pilates: 7, barre: 7, other: 7 },
  walk_yoga: 5,
};

// Session types that would make the planned workout harder.
function harderPattern(w) {
  if (w.type === 'run') {
    if (w.kind === 'easy' || w.kind === 'long') return /\b(tempo|intervals?|sprints?|race pace|threshold|fartlek|hill repeats?)\b/gi;
    if (w.kind === 'tempo') return /\b(intervals?|sprints?|race pace)\b/gi;
    return null;
  }
  if (w.type === 'strength') {
    return w.load === 'light'
      ? /\b(heavy|heavier|max(?:imal)? (?:load|weight|effort)|1RM|PR|personal best)\b/gi
      : /\b(heavier|max(?:imal)? (?:load|weight)|1RM|PR|personal best)\b/gi;
  }
  if (w.type === 'class') {
    if (w.classType === 'hiit') return null;
    if (w.classType === 'spin') return /\bhiit\b/gi;
    return /\b(hiit|sprints?|plyo\w*|jump(?:s|ing)?)\b/gi;
  }
  return /\b(run|running|jog|jogging|hiit|sprints?|tempo)\b/gi; // walk or yoga
}

// "Significant" = anything but bloating (spec section 5, rule 7).
export function stridesAllowed(c) {
  return (
    c.workout?.type === 'run' &&
    c.energy >= 4 &&
    c.sleep === 'good' &&
    (c.symptoms ?? []).every((s) => s === 'none' || s === 'bloating') &&
    (c.soreness == null || c.soreness === 'none' || c.soreness === 'some')
  );
}

const NEGATED = /\b(no|not|don[’']t|do not|never|skip|skipping|avoid|without|instead of|rather than|drop|dropping|leave out|hold off on|pass on|cut|save|swap|replace|replacing|forget)\b[^.;:]{0,30}$/i;
const isNegated = (text, index) => NEGATED.test(text.slice(Math.max(0, index - 45), index));

// First mention of `re` that isn't negated, or null.
function firstMention(text, re) {
  for (const m of text.matchAll(re)) if (!isNegated(text, m.index)) return m;
  return null;
}

const SUBSET_BEFORE = /\b(last|first|final|middle|including|of which|of those|of these)\s+$/i;
const RECOVERY_NEAR = /warm|cool|stretch|mobility|walk|yoga|foam|breath|recover|rest\b/i;
const KM_PER_MILE = 1.609;

// Adds up amounts in one alternative. Returns the total (in `unit`).
function totalAmount(text, unit) {
  const re = unit === 'minutes'
    ? /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?[\s-]*(hours?|hrs?|minutes?|mins?)\b/gi
    : /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?[\s-]*(?:[a-z]+\s+){0,2}?(miles?|mi|kilomet(?:er|re)s?|km|k)\b/gi;
  let sum = 0;
  let whole = 0;
  for (const m of text.matchAll(re)) {
    if (isNegated(text, m.index)) continue;
    const before = text.slice(Math.max(0, m.index - 20), m.index);
    if (SUBSET_BEFORE.test(before)) continue;
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 30);
    if (unit === 'minutes' && RECOVERY_NEAR.test(before.slice(-15) + m[0] + after)) continue;

    let amount = Math.max(Number(m[1]), Number(m[2] ?? 0)); // a range counts as its top end
    const u = m[3].toLowerCase();
    if (unit === 'minutes' && u.startsWith('h')) amount *= 60;
    if (unit === 'miles' && u.startsWith('k')) amount /= KM_PER_MILE;
    if (unit === 'km' && u.startsWith('mi')) amount *= KM_PER_MILE;

    if (/^\s*(total|in total|overall)\b|^\s*:/i.test(after) || /\b(total of|in total)\s+$/i.test(before)) whole = Math.max(whole, amount);
    else sum += amount;
  }
  return whole || sum;
}

function maxEffort(text) {
  let max = 0;
  // Effort in a sentence about strides is the strides' own effort, not the run's.
  for (const clause of text.split(/[.;]/)) {
    if (/stride/i.test(clause)) continue;
    for (const m of clause.matchAll(/(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(?:\/|out of)\s*10\b/gi)) {
      max = Math.max(max, Number(m[1]), Number(m[2] ?? 0));
    }
  }
  return max;
}

export function checkWithinPlan(rec, checkin) {
  const w = checkin.workout;
  if (!w) return [];
  const errors = [];
  const rx = rec.prescription;
  const rxAndTip = [rec.prescription, rec.extra_tip ?? ''].join('\n');
  const fmt = (n) => String(Math.round(n * 10) / 10);

  // Longer (runs have a planned distance or time).
  if (w.type === 'run') {
    const unit = w.unit === 'minutes' ? 'minutes' : w.unit;
    const longest = Math.max(...rx.split(/\s+or\s+/i).map((alt) => totalAmount(alt, unit)));
    if (longest > w.amount + 0.05) errors.push(`longer than planned (${fmt(longest)} ${unit} vs ${fmt(w.amount)} planned)`);
  }

  // Harder: effort numbers.
  const cap = w.type === 'walk_yoga' ? EFFORT_CAP.walk_yoga : EFFORT_CAP[w.type][w.type === 'run' ? w.kind : w.type === 'strength' ? w.load : w.classType];
  const effort = maxEffort(rx);
  if (effort > cap) errors.push(`harder than planned (effort ${fmt(effort)}/10; the plan tops out around ${cap}/10)`);

  // Harder: session types.
  const pattern = harderPattern(w);
  const harder = pattern && firstMention(rx, pattern);
  if (harder) errors.push(`harder than planned ("${harder[0]}")`);

  // Extras.
  const extra = firstMention(rxAndTip, /\b(extra|additional|bonus)\b/gi);
  if (extra) errors.push(`adds an extra ("${extra[0]}")`);

  // Strides: the only allowed extra.
  if (firstMention(rxAndTip, /\bstrides?\b/gi)) {
    if (!stridesAllowed(checkin)) errors.push('strides are only allowed on a run, on a great day');
    for (const m of rxAndTip.matchAll(/(\d+)(?:\s*(?:-|–|to)\s*(\d+))?\s+(?:[a-z0-9-]+\s+){0,3}?strides/gi)) {
      if (Math.max(Number(m[1]), Number(m[2] ?? 0)) > 6) errors.push('more than 6 strides');
    }
  }

  return errors;
}
