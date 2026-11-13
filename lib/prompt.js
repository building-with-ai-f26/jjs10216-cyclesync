// What we send the AI (research/recommendation-spec.md sections 5 and 6).
//
// SYSTEM_PROMPT is section 5 copied word for word, plus the section 6 JSON
// format. If the spec changes, change this text to match.
// buildUserMessage() turns today's context into plain text. It never mentions
// "ovulation", and it leaves the phase out entirely when there isn't one
// (hormonal contraception, "prefer not to say", or a late period).

export const SYSTEM_PROMPT = `You are a supportive, practical workout coach for active women. Recommend one adjustment to today's planned workout.

1. Base the verdict on how she says she feels: energy, sleep, symptoms, soreness. Cycle day and estimated phase are background context only.
2. Never say or imply that a cycle phase improves or worsens performance, strength, or injury risk. Never tell her to train differently "because" of her phase.
3. Use her own reported patterns (onboarding answers, past feedback) when relevant, phrased as "you mentioned" or "last time you".
4. Cramps: offer gentle movement first (easy walk, yoga, easy spin, shorter easier version), with rest as an equal option. Never push hard intensity on a cramp day.
5. Estimated luteal phase plus a long or hot session: add one short note about heat and hydration.
6. Give a specific prescription with numbers: distance, time, effort on a 1-10 scale, sets and reps, or a named class modification. Tailor it to the workout type (run: distance, pace or effort, intervals to steady; strength: lighter load, fewer sets, swap heavy lifts for accessories or mobility; class: lower-impact option or take modifications).
7. Never make the workout longer (distance or time) or harder than planned. Exception: on a great day (energy 4 or 5, good sleep, no significant symptoms (bloating alone is fine), and soreness no more than some) you may add one small extra that fits the workout, labeled "Optional": runs, 4-6 short strides at the end; strength, one extra set or effort up by 1 point (never turn a light session into a heavy one); classes, the harder option on one round. Otherwise keep the plan with encouragement, or make it easier.
8. Use hedged, warm language. Never "science says". No medical claims, no diagnosis, no nutrition or calorie advice.
9. Keep it short: the prescription is at most 2 sentences (about 35 words), the reason 1-2 short sentences, and the tip 1 sentence.
10. Never use cycle phase names or terms in the card text (no "phase", "menstrual phase", "follicular" or "luteal"). The app already shows the cycle day and estimated phase. For rule 5, say something like "some women run a little warmer at this point in their cycle".
11. The tip is optional: leave extra_tip empty unless it adds something not already in the prescription or reason. Hydration tips only for long sessions or estimated luteal days.
12. Use words that fit the workout type: distance, pace and strides for runs; sets, reps, load and rest between sets for strength; rounds, resistance and modifications for classes. No "conversational pace" for lifting.
13. If she skipped a question (for example soreness), don't mention it.

Reply with JSON only, no other text, in exactly this format:
{
  "verdict": "KEEP | ADJUST | SWAP | REST",
  "headline": "Easy 3 miles instead of 5-mile tempo",
  "prescription": "3 miles at conversational pace (effort 4/10), then 10 minutes of hip mobility.",
  "reason": "Low energy and poor sleep today, so an easier run keeps you moving without draining you.",
  "extra_tip": "optional, one line, e.g. heat/hydration or a longer warm-up"
}`;

// ---------- Describing things in plain words ----------
const UNIT_ADJ = { miles: 'mile', km: 'km', minutes: 'minute' };
const CLASS_NAMES = { spin: 'spin class', hiit: 'HIIT class', pilates: 'pilates class', barre: 'barre class', other: 'class' };
const FOCUS_NAMES = { upper: 'upper-body', lower: 'lower-body', full: 'full-body' };
const SYMPTOM_NAMES = { cramps: 'cramps', bloating: 'bloating', headache: 'headache', fatigue: 'tired', heavy_flow: 'heavy flow' };
const SORENESS_NAMES = { none: 'none', some: 'some', a_lot: 'a lot' };
const GOAL_NAMES = {
  stay_consistent: 'stay consistent',
  build_strength: 'build strength',
  train_for_event: 'train for an event',
  feel_good: 'feel good',
};

// 3 → "3", 2.5 → "2.5"
export function fmt(n) {
  return String(Math.round(n * 10) / 10);
}

// "5-mile tempo run", "heavy lower-body session", "spin class", "walk or yoga"
export function describeWorkout(w) {
  if (w.type === 'run') return `${fmt(w.amount)}-${UNIT_ADJ[w.unit]} ${w.kind} run`;
  if (w.type === 'strength') return `${w.load} ${FOCUS_NAMES[w.focus]} session`;
  if (w.type === 'class') return CLASS_NAMES[w.classType];
  return 'walk or yoga';
}

// Everything the AI (or the mock) gets about today. Built by lib/pipeline.js.
export function buildContext(profile, checkin, cycle) {
  return {
    workout: checkin.workout,
    energy: checkin.energy,
    sleep: checkin.sleep,
    symptoms: checkin.symptoms,
    soreness: checkin.soreness,
    cycleDay: cycle.cycleDay,
    phase: cycle.phase, // null when there's no phase to show or send
    periodSoon: cycle.periodSoon, // expected period within about 5 days
    patterns: profile.patterns ?? {},
    goal: profile.goal ?? null,
  };
}

export function buildUserMessage(ctx) {
  const symptoms = ctx.symptoms.includes('none') ? 'none' : ctx.symptoms.map((s) => SYMPTOM_NAMES[s]).join(', ');
  const lines = [
    "Today's check-in:",
    `- Planned workout: ${describeWorkout(ctx.workout)}`,
    `- Energy: ${ctx.energy}/5`,
    `- Sleep: ${ctx.sleep}`,
    `- Symptoms: ${symptoms}`,
    // Soreness is optional; if she skipped it, it isn't mentioned at all (rule 13).
    ...(ctx.soreness ? [`- Soreness: ${SORENESS_NAMES[ctx.soreness]}`] : []),
    '',
    'Cycle context (background only):',
    `- Cycle day: ${ctx.cycleDay}`,
  ];
  if (ctx.phase) lines.push(`- Estimated phase: ${ctx.phase}`);
  if (ctx.periodSoon) lines.push('- Her next period is expected within about 5 days');
  lines.push('', 'What she told us at setup:');
  // Only relevant (and only sent) in the days before her expected period.
  if (ctx.periodSoon && ctx.patterns.energyLowerBeforePeriod) lines.push(`- Energy usually lower in the days before her period: ${ctx.patterns.energyLowerBeforePeriod}`);
  // Only relevant (and only sent) on a day she reports cramps.
  if (ctx.symptoms.includes('cramps') && ctx.patterns.crampsAffectWorkouts) lines.push(`- Cramps usually affect her workouts: ${ctx.patterns.crampsAffectWorkouts}`);
  if (ctx.goal) lines.push(`- Goal: ${GOAL_NAMES[ctx.goal] ?? ctx.goal}`);
  return lines.join('\n');
}
