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
// `context` (optional): { phase } for the hydration-tip rule.
export function checkOutput(output, checkin, context = {}) {
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

  if (checkin.symptoms.includes('cramps') && rec.verdict !== 'REST' && !offersRestAsEqual(all)) {
    errors.push('on a cramps day, offer rest as an equally good choice (not only "if cramps get worse")');
  }

  const phaseTerm = all.match(PHASE_TERMS);
  if (phaseTerm) errors.push(`uses a phase term ("${phaseTerm[0]}")`);

  errors.push(...checkWithinPlan(rec, checkin));

  // Length (rule 9).
  for (const [field, limit] of Object.entries(LIMITS)) {
    const value = rec[field];
    if (!value) continue;
    const n = countSentences(value);
    const words = countWords(value);
    if (n > limit.sentences || words > limit.words) {
      errors.push(`${field} too long (${n} sentences, ${words} words; max ${limit.sentences} sentence${limit.sentences > 1 ? 's' : ''} and about ${limit.words} words)`);
    }
  }

  // Hydration tips only for long runs or estimated luteal days (rule 11).
  if (rec.extra_tip && /\b(hydrat\w*|water|fluids?|sip|drink\w*)\b/i.test(rec.extra_tip) && !((checkin.workout && isLongSession(checkin.workout)) || context.phase === 'luteal')) {
    errors.push('hydration tip on a day that is not a long session or an estimated luteal day');
  }

  // Words that fit the workout type (rule 12).
  const wrong = WRONG_WORDS[checkin.workout?.type] && all.match(WRONG_WORDS[checkin.workout.type]);
  if (wrong) errors.push(`wording doesn't fit a ${checkin.workout.type} session ("${wrong[0]}")`);

  // Skipped soreness isn't mentioned (rule 13).
  if (checkin.soreness == null && /\bsore(?:ness)?\b/i.test(all)) errors.push('mentions soreness, which she skipped');

  return errors.length ? { ok: false, errors } : { ok: true, recommendation: rec };
}

// ---------- Cramps day: rest offered as an equal choice (spec section 5, rule 4) ----------
// Some sentence must put rest on equal footing ("...or rest. Both are good
// choices.", "Resting is just as good."). A sentence that only offers rest
// as a bail-out ("if cramps get worse, rest") doesn't count.
const REST_WORD = /\b(rest(?:ing)?|day off)\b/i;
const EQUAL_WORDS = /\b(or (?:a |an |take a |take the )?(?:\w+ )?(?:rest(?:ing)?|day off)|equally|just as (?:good|valid|fine|helpful)|both are|either (?:is|one is)|as good a choice|choose (?:one|either)|whichever|your call|your choice)\b/i;
const ONLY_IF_WORSE = /\bif\b[^.;]*\b(worse|worsen|hurt|bad|uncomfortable|too much|flare)/i;

export function offersRestAsEqual(text) {
  return text.split(/(?<=[.!?;])\s+/).some((s) => REST_WORD.test(s) && EQUAL_WORDS.test(s) && !ONLY_IF_WORSE.test(s));
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
//   - "extra", "additional" and "bonus" aren't allowed, except one small extra
//     labeled "optional" on a great day (isGreatDay): runs, 4-6 strides;
//     strength, one extra set or effort up 1 point; classes, the harder option
//     on one round (isAllowedExtra).
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

// A great day (spec section 5, rule 7): energy 4-5, good sleep, no significant
// symptoms ("significant" = anything but bloating), soreness no more than some.
// Only then is one small, optional extra allowed.
export function isGreatDay(c) {
  return (
    c.energy >= 4 &&
    c.sleep === 'good' &&
    (c.symptoms ?? []).every((s) => s === 'none' || s === 'bloating') &&
    (c.soreness == null || c.soreness === 'none' || c.soreness === 'some')
  );
}

export function stridesAllowed(c) {
  return c.workout?.type === 'run' && isGreatDay(c);
}

// Long runs: where a hydration tip makes sense (spec section 5, rules 5 and 11).
export function isLongSession(w) {
  if (w.type !== 'run') return false;
  return w.kind === 'long' || (w.unit === 'minutes' && w.amount >= 75) || (w.unit === 'miles' && w.amount >= 8) || (w.unit === 'km' && w.amount >= 13);
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

const OPTIONAL = /\boptional(?:ly)?\b/i;
const EFFORT_RE = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(?:\/|out of)\s*10\b/gi;
const clausesOf = (text) => text.split(/(?<=[.;!?])\s+|\n/).filter((c) => c.trim());

// Is this clause the one allowed optional extra for this workout, on a great day?
//   runs: 4-6 strides; strength: one extra set or effort up 1; classes: harder option on one round.
function isAllowedExtra(clause, w, great) {
  if (!great || !OPTIONAL.test(clause)) return false;
  if (w.type === 'run') return /\bstrides?\b/i.test(clause);
  if (w.type === 'strength') {
    if (/\b([2-9]|two|three|four)\s+(?:extra|additional|more)\s+sets?\b/i.test(clause)) return false;
    return /\bsets?\b|\beffort\b|\/\s*10\b|out of 10/i.test(clause);
  }
  if (w.type === 'class') {
    if (/\b([2-9]|two|three|all|every|each)\s+(?:of the\s+)?rounds?\b/i.test(clause)) return false;
    return /\b(rounds?|harder option|advanced option|harder version|level up)\b/i.test(clause);
  }
  return false;
}

function maxEffortIn(text) {
  let max = 0;
  for (const m of text.matchAll(EFFORT_RE)) max = Math.max(max, Number(m[1]), Number(m[2] ?? 0));
  return max;
}

export function checkWithinPlan(rec, checkin) {
  const w = checkin.workout;
  if (!w) return [];
  const errors = [];
  const great = isGreatDay(checkin);
  const fmt = (n) => String(Math.round(n * 10) / 10);
  const rxClauses = clausesOf(rec.prescription);
  const allClauses = clausesOf([rec.prescription, rec.extra_tip ?? ''].join('\n'));
  const extraClauses = allClauses.filter((c) => isAllowedExtra(c, w, great));
  const isExtra = (c) => extraClauses.includes(c);
  const mainRx = rxClauses.filter((c) => !isExtra(c)).join(' ');

  // Longer (runs have a planned distance or time). The optional extra isn't counted.
  if (w.type === 'run') {
    const unit = w.unit === 'minutes' ? 'minutes' : w.unit;
    const longest = Math.max(...mainRx.split(/\s+or\s+/i).map((alt) => totalAmount(alt, unit)));
    if (longest > w.amount + 0.05) errors.push(`longer than planned (${fmt(longest)} ${unit} vs ${fmt(w.amount)} planned)`);
  }

  // Harder: effort numbers. Strides carry their own effort; the optional extra may go 1 point higher.
  const cap = w.type === 'walk_yoga' ? EFFORT_CAP.walk_yoga : EFFORT_CAP[w.type][w.type === 'run' ? w.kind : w.type === 'strength' ? w.load : w.classType];
  const mainEffort = maxEffortIn(rxClauses.filter((c) => !isExtra(c) && !/stride/i.test(c)).join(' '));
  if (mainEffort > cap) errors.push(`harder than planned (effort ${fmt(mainEffort)}/10; the plan tops out around ${cap}/10)`);
  const extraEffort = w.type === 'run' ? 0 : maxEffortIn(extraClauses.join(' '));
  if (extraEffort > cap + 1) errors.push(`the optional extra is too hard (effort ${fmt(extraEffort)}/10; at most ${cap + 1}/10)`);

  // Harder: session types. A light strength session never becomes heavy, even as an extra;
  // a class's optional harder round may name its harder moves.
  const pattern = harderPattern(w);
  const checkedForHarder = w.type === 'class' ? rxClauses.filter((c) => !isExtra(c)).join(' ') : rec.prescription;
  const harder = pattern && firstMention(checkedForHarder, pattern);
  if (harder) errors.push(`harder than planned ("${harder[0]}")`);

  // Extras: only the one allowed optional extra.
  if (extraClauses.length > 1) errors.push('more than one optional extra');
  const otherText = allClauses.filter((c) => !isExtra(c)).join(' ');
  const extra = firstMention(otherText, /\b(extra|additional|bonus|one more set)\b/gi);
  if (extra) errors.push(`adds an extra ("${extra[0]}"); only one small extra labeled "optional", on a great day`);

  // Strides: runs only, great day only, labeled optional, 4-6 of them.
  if (firstMention(otherText, /\bstrides?\b/gi)) {
    errors.push('strides are only allowed as an optional extra on a run, on a great day');
  }
  for (const m of allClauses.join(' ').matchAll(/(\d+)(?:\s*(?:-|–|to)\s*(\d+))?\s+(?:[a-z0-9-]+\s+){0,3}?strides/gi)) {
    if (Math.max(Number(m[1]), Number(m[2] ?? 0)) > 6) errors.push('more than 6 strides');
  }

  return errors;
}

// ---------- Card length (spec section 5, rule 9) ----------
// The AI is asked for less (rule 9: 2 sentences / about 35 words); the checks
// allow some slack so a good answer isn't thrown away over a few words.
export const LIMITS = {
  prescription: { sentences: 3, words: 45 },
  reason: { sentences: 2, words: 45 },
  extra_tip: { sentences: 1, words: 30 },
};
export const countSentences = (t) => t.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).filter((x) => x.trim()).length;
export const countWords = (t) => t.split(/\s+/).filter(Boolean).length;

// ---------- Words that fit the workout (spec section 5, rule 12) ----------
const WRONG_WORDS = {
  strength: /\b(conversational pace|miles?|km|strides?|tempo)\b/i,
  class: /\b(conversational pace|miles?|km|strides?)\b/i,
};
