// Mock AI: a pretend coach that answers like the real one (spec sections 5 and 6),
// using simple rules instead of a model. It costs nothing and lets every screen
// be tested before there's an OpenRouter key. Its answers go through the same
// output checks (lib/checks.js) as the real AI's.
//
// Rough logic, in order (feelings first; the phase only adds a hydration tip):
//   1. Cramps          → gentle movement (SWAP/ADJUST), rest as an equal option.
//                        Energy 1 → REST. Never hard intensity.
//   2. Energy 1        → REST, with an optional short easy walk.
//   3. Feeling rough   → ADJUST to an easier version (SWAP to mobility for heavy
//                        strength on a very rough day). "Rough" = energy 2, poor
//                        sleep with energy 3 or less, a lot of soreness, or a
//                        headache / tired / heavy flow.
//   4. Great day       → KEEP. On a run, optional 4-6 strides (the only extra
//                        ever allowed). "Great" = energy 4-5, good sleep, no
//                        symptoms, no soreness.
//   5. Everything else → KEEP as planned, no extras on poor sleep or soreness.
// The numbers are coaching heuristics chosen for the product, not research.

import { describeWorkout, fmt } from './prompt.js';

const UNIT_WORDS = { miles: ['mile', 'miles'], km: ['km', 'km'], minutes: ['minute', 'minutes'] };
const EFFORT = { easy: '4/10', long: '4-5/10', tempo: '7/10', intervals: '8/10 on the hard parts' };

const unit = (amount, u) => `${fmt(amount)} ${UNIT_WORDS[u][amount === 1 ? 0 : 1]}`;

// About 60% of the planned run: whole/half miles or km, or 5-minute steps.
function easierAmount(w) {
  if (w.unit === 'minutes') return Math.max(15, Math.round((w.amount * 0.6) / 5) * 5);
  return Math.max(1, Math.round(w.amount * 0.6 * 2) / 2);
}

function isLongSession(w) {
  if (w.type !== 'run') return false;
  return w.kind === 'long' || (w.unit === 'minutes' && w.amount >= 75) || (w.unit === 'miles' && w.amount >= 8) || (w.unit === 'km' && w.amount >= 13);
}

const SYMPTOM_PHRASES = { headache: 'a headache', fatigue: 'feeling tired', heavy_flow: 'a heavier flow' };

// "low energy, poor sleep and a headache"
function joinWords(list) {
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function mockRecommendation(ctx) {
  const { workout: w, energy, sleep, symptoms, soreness, patterns } = ctx;
  const planned = describeWorkout(w);
  const cramps = symptoms.includes('cramps');
  const otherSymptoms = symptoms.filter((s) => s in SYMPTOM_PHRASES);
  const poorSleep = sleep === 'poor';
  const veryRough = energy <= 2 && poorSleep;

  let rec;
  if (cramps) rec = crampsDay(w, planned, energy, patterns);
  else if (energy === 1) rec = restDay(planned, poorSleep);
  else {
    const rough = [];
    if (energy === 2) rough.push('low energy');
    if (poorSleep && energy <= 3) rough.push('poor sleep');
    if (soreness === 'a_lot') rough.push('a lot of soreness');
    for (const s of otherSymptoms) rough.push(SYMPTOM_PHRASES[s]);

    if (rough.length) rec = easierDay(w, planned, rough, veryRough);
    else if (energy >= 4 && sleep === 'good' && symptoms.includes('none') && (soreness === null || soreness === 'none')) rec = greatDay(w, planned);
    else rec = steadyDay(w, planned, { poorSleep, soreness });
  }

  // You mentioned... (spec section 5, rule 3)
  const lowBeforePeriod = ['yes', 'sometimes'].includes(patterns.energyLowerBeforePeriod);
  if (!cramps && energy <= 2 && ctx.periodSoon && lowBeforePeriod) {
    rec.reason += ' You mentioned your energy is often lower in the days before your period.';
  }

  // Estimated luteal + long session: one short heat and hydration note (rule 5).
  if (ctx.phase === 'luteal' && isLongSession(w)) {
    rec.extra_tip = 'Some women run a little warmer in this part of their cycle, so bring water and sip regularly, especially if it is hot.';
  }

  return { extra_tip: '', ...rec };
}

function crampsDay(w, planned, energy, patterns) {
  const mentioned = ['yes', 'sometimes'].includes(patterns.crampsAffectWorkouts)
    ? ' You mentioned cramps sometimes get in the way of your workouts.'
    : '';
  if (energy === 1) {
    return {
      verdict: 'REST',
      headline: `Rest day instead of your ${planned}`,
      prescription: 'Take it easy today. If moving sounds good, a 10-15 minute gentle walk (effort 2/10) is plenty.',
      reason: `Cramps and very low energy today, so rest is a good call.${mentioned}`,
    };
  }
  const gentle = {
    run: ['Easy walk or very easy jog', '20-30 minutes of easy walking or a very easy jog (effort 3/10), or rest. Both are good choices.'],
    strength: ['Gentle yoga or mobility', '20 minutes of gentle yoga or mobility (effort 3/10), or rest. Both are good choices.'],
    class: ['Gentle yoga or easy spin', '20-30 minutes of gentle yoga or easy spinning (effort 3/10), or rest. Both are good choices.'],
    walk_yoga: ['Easy walk or gentle yoga', 'Keep it to 20-30 minutes of easy walking or gentle yoga (effort 3/10), or rest. Both are good choices.'],
  }[w.type];
  return {
    verdict: w.type === 'walk_yoga' ? 'ADJUST' : 'SWAP',
    headline: w.type === 'walk_yoga' ? gentle[0] : `${gentle[0]} instead of your ${planned}`,
    prescription: gentle[1],
    reason: `Cramps today, so some gentle movement may help you feel better, and resting is just as good.${mentioned}`,
  };
}

function restDay(planned, poorSleep) {
  return {
    verdict: 'REST',
    headline: `Rest day instead of your ${planned}`,
    prescription: 'Take the day off. If you want to move, a 15-minute easy walk (effort 2/10) is enough.',
    reason: poorSleep
      ? "You're running on empty after a rough night, so rest today sets you up for tomorrow."
      : "You're running on empty today, so rest sets you up for tomorrow.",
  };
}

function easierDay(w, planned, rough, veryRough) {
  const reasonStart = capital(joinWords(rough)) + ' today';
  if (w.type === 'run') {
    const amt = easierAmount(w);
    return {
      verdict: 'ADJUST',
      headline: `Easy ${unit(amt, w.unit)} instead of your ${planned}`,
      prescription: `${capital(unit(amt, w.unit))} at an easy, conversational pace (effort 4/10), then 5-10 minutes of stretching.`,
      reason: `${reasonStart}, so an easier run keeps you moving without draining you.`,
      extra_tip: 'Take a 10-minute warm-up and stop early if it feels harder than it should.',
    };
  }
  if (w.type === 'strength') {
    if (veryRough && w.load === 'heavy') {
      return {
        verdict: 'SWAP',
        headline: `Mobility instead of your ${planned}`,
        prescription: '25 minutes of mobility and light core work: 3 rounds of 10 glute bridges, 10 bird dogs and a 30-second side plank each side (effort 3/10).',
        reason: `${reasonStart}, so heavy lifting can wait for a day you feel better.`,
      };
    }
    return {
      verdict: 'ADJUST',
      headline: `Lighter ${w.focus === 'full' ? 'full-body' : `${w.focus}-body`} session`,
      prescription: '2 sets of 10 per exercise at about 60% of your usual weight (effort 5/10), then 10 minutes of mobility.',
      reason: `${reasonStart}, so lighter weights and fewer sets keep the habit without wearing you out.`,
    };
  }
  if (w.type === 'class') {
    const highImpact = w.classType === 'hiit' || w.classType === 'spin';
    return {
      verdict: 'ADJUST',
      headline: highImpact ? `Easier ${planned}` : `Take it easy in your ${planned}`,
      prescription: highImpact
        ? 'Go at effort 5/10: take the low-impact option for jumps and keep sprints at a steady pace.'
        : 'Go at effort 4/10 and take the easier option on every exercise.',
      reason: `${reasonStart}, so a gentler version of the class is a better fit.`,
    };
  }
  return {
    verdict: 'ADJUST',
    headline: 'Shorter, easy walk or yoga',
    prescription: '20 minutes of easy walking or gentle yoga (effort 3/10).',
    reason: `${reasonStart}, so keep it short and gentle.`,
  };
}

function greatDay(w, planned) {
  const add = {
    run: () => `Run your ${unit(w.amount, w.unit)} as planned (effort ${EFFORT[w.kind]}). Optional: add 4-6 short strides of 20 seconds at the end.`,
    strength: () => `Do your session as planned (effort ${w.load === 'heavy' ? '7-8' : '5-6'}/10). Enjoy it.`,
    class: () => `Enjoy the class as planned, effort ${w.classType === 'hiit' || w.classType === 'spin' ? '7-8' : '6-7'}/10 on the hard parts.`,
    walk_yoga: () => 'Do your walk or yoga as planned (effort 3-4/10). Enjoy it.',
  }[w.type]();
  return {
    verdict: 'KEEP',
    headline: `Keep your ${planned}`,
    prescription: add,
    reason: 'Great energy, good sleep and no symptoms, so you look set for your plan today.',
  };
}

function steadyDay(w, planned, { poorSleep, soreness }) {
  const asPlanned = {
    run: () => `Run your ${unit(w.amount, w.unit)} as planned (effort ${EFFORT[w.kind]}).`,
    strength: () => `Do your session as planned (effort ${w.load === 'heavy' ? '6-7' : '5-6'}/10).`,
    class: () => 'Take the class as planned, around effort 6-7/10.',
    walk_yoga: () => 'Do your walk or yoga as planned, around 30 minutes (effort 3-4/10).',
  }[w.type]();
  return {
    verdict: 'KEEP',
    headline: `Keep your ${planned}`,
    prescription: asPlanned,
    reason: poorSleep
      ? "Your energy is good even after a rough night, so keep the plan but don't add anything extra."
      : 'You feel OK today, so your plan looks like a good fit.',
    extra_tip: poorSleep || soreness === 'some'
      ? 'Take a 10-minute warm-up and skip any extras today.'
      : 'Ease off if it feels harder than usual.',
  };
}
