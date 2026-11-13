// Cycle day + estimated phase (recommendation-spec.md section 4).
//
// - Cycle day = days since last period start + 1.
// - Three phase labels only: menstrual (days 1-5), follicular (day 6 through
//   cycle length - 14), luteal (the day after that through the end of the cycle).
//   There is no "ovulatory" label, and the word is never shown or sent.
// - No phase when she uses hormonal contraception or prefers not to say,
//   or when her period is late (cycle day past her typical cycle length).
//
// Dates are YYYY-MM-DD strings in HER time zone (the browser sends "today").

export const MENSTRUAL_DAYS = 5; // assumed until period end logging exists
export const DUE_WINDOW_DAYS = 3; // the last 3 days of a cycle count as "period due"
// "Period soon": the expected period is within about 5 days. Only then does the AI
// hear her "energy is lower before my period" answer, so it isn't misapplied.
export const PERIOD_SOON_DAYS = 5;

// One plain line per phase. Hedged, and never claims a phase helps or hurts
// performance (evidence-brief.md "Rules for the AI" 1, 2 and 7).
export const PHASE_INFO = {
  menstrual: 'Your period. Some women feel lower energy or cramps, others feel fine. How you feel today matters most.',
  follicular: 'The days between your period and mid-cycle. How you feel today matters more than the phase.',
  luteal: 'The second half of your cycle, before your next period. Some women run a little warmer, so hydration helps on long or hot sessions.',
};

export const ESTIMATE_NOTE = 'Estimated from your last period and typical cycle length.';

function dayNumber(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function cycleContext(profile, today) {
  const { lastPeriodStart, cycleLength, contraception } = profile;

  // If "today" is somehow before the logged start (time zones), treat it as day 1.
  const cycleDay = Math.max(1, dayNumber(today) - dayNumber(lastPeriodStart) + 1);

  const usesHormonal = contraception === 'yes' || contraception === 'prefer_not_to_say';
  const isLate = cycleDay > cycleLength;
  const isPeriodDay = cycleDay <= MENSTRUAL_DAYS;

  let phase = null;
  if (!usesHormonal && !isLate) {
    if (isPeriodDay) phase = 'menstrual';
    else if (cycleDay <= cycleLength - 14) phase = 'follicular';
    else phase = 'luteal';
  }

  // "Due" and "late" only make sense for a natural cycle, so they're never
  // flagged for hormonal contraception or "prefer not to say".
  const periodDue = !usesHormonal && !isLate && cycleDay > cycleLength - DUE_WINDOW_DAYS;
  const periodLate = !usesHormonal && isLate;
  // Day 24-28 of a 28-day cycle: the next period is expected in 5 days or fewer.
  const periodSoon = !usesHormonal && !isLate && cycleDay > cycleLength - PERIOD_SOON_DAYS;

  return {
    cycleDay,
    phase,
    phaseInfo: phase ? PHASE_INFO[phase] : null,
    estimateNote: phase ? ESTIMATE_NOTE : null,
    isPeriodDay,
    periodDue,
    periodLate,
    periodSoon,
  };
}

// "today" from the browser must be a real date within 2 days of the server's
// date, so a wrong or tampered value can't produce a strange cycle day.
export function isValidToday(value, now = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  return Math.abs(date.getTime() - now.getTime()) <= 2 * 86_400_000;
}
