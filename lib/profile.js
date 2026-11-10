// Checks onboarding answers before they are saved (recommendation-spec.md section 2).
// Only known fields with allowed values are kept; anything else is dropped.

export const CONTRACEPTION = ['yes', 'no', 'prefer_not_to_say'];
export const PATTERN_ANSWERS = ['yes', 'sometimes', 'no'];
export const PATTERN_QUESTIONS = ['energyLowerBeforePeriod', 'crampsAffectWorkouts'];
export const WORKOUT_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const GOALS = ['stay_consistent', 'build_strength', 'train_for_event', 'feel_good'];
export const CYCLE_LENGTH = { min: 15, max: 60, default: 28 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUserId(id) {
  return typeof id === 'string' && UUID.test(id);
}

// A real calendar date written as YYYY-MM-DD, not in the future (one day of
// leeway for time zones) and not more than a year ago.
export function isValidPeriodDate(value, now = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  const dayMs = 24 * 60 * 60 * 1000;
  return date.getTime() <= now.getTime() + dayMs && date.getTime() >= now.getTime() - 366 * dayMs;
}

export function validateProfile(input, now = new Date()) {
  if (!input || typeof input !== 'object') return fail('Missing onboarding answers.');

  if (!isValidPeriodDate(input.lastPeriodStart, now)) {
    return fail('Please enter the date your last period started (within the past year).');
  }

  const cycleLength = Number(input.cycleLength);
  if (!Number.isInteger(cycleLength) || cycleLength < CYCLE_LENGTH.min || cycleLength > CYCLE_LENGTH.max) {
    return fail(`Typical cycle length should be a whole number of days between ${CYCLE_LENGTH.min} and ${CYCLE_LENGTH.max}.`);
  }

  if (!CONTRACEPTION.includes(input.contraception)) {
    return fail('Please answer the hormonal contraception question.');
  }

  const patterns = {};
  for (const key of PATTERN_QUESTIONS) {
    const answer = input.patterns?.[key];
    if (!PATTERN_ANSWERS.includes(answer)) return fail('Please answer both questions about your patterns.');
    patterns[key] = answer;
  }

  const days = Array.isArray(input.workoutDays) ? input.workoutDays : [];
  if (days.length === 0 || !days.every((d) => WORKOUT_DAYS.includes(d))) {
    return fail('Please pick at least one usual workout day.');
  }
  const workoutDays = WORKOUT_DAYS.filter((d) => days.includes(d)); // Mon→Sun order, no duplicates

  if (!GOALS.includes(input.goal)) return fail('Please pick a goal.');

  return {
    ok: true,
    profile: {
      lastPeriodStart: input.lastPeriodStart,
      cycleLength,
      contraception: input.contraception,
      patterns,
      workoutDays,
      goal: input.goal,
    },
  };
}

function fail(error) {
  return { ok: false, error };
}
