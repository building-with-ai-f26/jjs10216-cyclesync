// Checks a morning check-in before anything else happens (recommendation-spec.md section 2).
// The safety screen relies on this: if "heavy flow" or "cramps" is picked, the
// follow-up questions MUST be answered, or the check-in is rejected.
// Only known fields with allowed values are kept; anything else is dropped.

export const WORKOUT_TYPES = ['run', 'strength', 'class', 'walk_yoga'];
export const RUN_UNITS = ['miles', 'km', 'minutes'];
export const RUN_KINDS = ['easy', 'tempo', 'intervals', 'long'];
export const STRENGTH_FOCUS = ['upper', 'lower', 'full'];
export const STRENGTH_LOAD = ['heavy', 'light'];
export const CLASS_TYPES = ['spin', 'hiit', 'pilates', 'barre', 'other'];
export const SLEEP = ['good', 'ok', 'poor'];
export const SYMPTOMS = ['none', 'cramps', 'bloating', 'headache', 'fatigue', 'heavy_flow'];
export const SORENESS = ['none', 'some', 'a_lot'];
export const HEAVY_FLOW_QUESTIONS = ['soakingHourly', 'over7Days', 'largeClots', 'dizzyOrBreathless'];

const RUN_MAX = { miles: 100, km: 160, minutes: 600 };

export function validateCheckin(input) {
  if (!input || typeof input !== 'object') return fail('Missing check-in answers.');

  const workout = validateWorkout(input.workout);
  if (!workout.ok) return workout;

  const energy = Number(input.energy);
  if (!Number.isInteger(energy) || energy < 1 || energy > 5) return fail('Please pick your energy (1–5).');

  if (!SLEEP.includes(input.sleep)) return fail('Please pick how you slept.');

  const picked = Array.isArray(input.symptoms) ? input.symptoms : [];
  if (picked.length === 0 || !picked.every((s) => SYMPTOMS.includes(s))) {
    return fail('Please pick your symptoms, or "None".');
  }
  if (picked.includes('none') && picked.length > 1) {
    return fail('"None" can\'t be picked together with other symptoms.');
  }
  const symptoms = SYMPTOMS.filter((s) => picked.includes(s)); // fixed order, no duplicates

  // Soreness is optional.
  let soreness = null;
  if (input.soreness != null && input.soreness !== '') {
    if (!SORENESS.includes(input.soreness)) return fail('Unknown soreness answer.');
    soreness = input.soreness;
  }

  const checkin = { workout: workout.workout, energy, sleep: input.sleep, symptoms, soreness };

  // Follow-ups: required when their symptom is picked, ignored otherwise.
  if (symptoms.includes('heavy_flow')) {
    const heavyFlow = {};
    for (const q of HEAVY_FLOW_QUESTIONS) {
      if (typeof input.heavyFlow?.[q] !== 'boolean') {
        return fail('Please answer all the heavy-flow questions.');
      }
      heavyFlow[q] = input.heavyFlow[q];
    }
    checkin.heavyFlow = heavyFlow;
  }

  if (symptoms.includes('cramps')) {
    if (typeof input.crampsUnusual !== 'boolean') {
      return fail('Please answer the question about your cramps.');
    }
    checkin.crampsUnusual = input.crampsUnusual;
  }

  return { ok: true, checkin };
}

function validateWorkout(w) {
  if (!w || !WORKOUT_TYPES.includes(w.type)) return fail("Please pick today's planned workout.");

  if (w.type === 'run') {
    const amount = Number(w.amount);
    if (!RUN_UNITS.includes(w.unit)) return fail('Please pick miles, km, or minutes for your run.');
    if (!(amount > 0) || amount > RUN_MAX[w.unit]) return fail('Please enter how far or how long your run is.');
    if (!RUN_KINDS.includes(w.kind)) return fail('Please pick what kind of run it is.');
    return { ok: true, workout: { type: 'run', amount, unit: w.unit, kind: w.kind } };
  }

  if (w.type === 'strength') {
    if (!STRENGTH_FOCUS.includes(w.focus)) return fail('Please pick upper, lower, or full body.');
    if (!STRENGTH_LOAD.includes(w.load)) return fail('Please pick heavy or light.');
    return { ok: true, workout: { type: 'strength', focus: w.focus, load: w.load } };
  }

  if (w.type === 'class') {
    if (!CLASS_TYPES.includes(w.classType)) return fail('Please pick the type of class.');
    return { ok: true, workout: { type: 'class', classType: w.classType } };
  }

  return { ok: true, workout: { type: 'walk_yoga' } };
}

function fail(error) {
  return { ok: false, error };
}
