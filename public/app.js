// Runs in the browser: shows the right screen, sends answers to the server.

// ---------- Anonymous ID ----------
// A random ID made the first time, remembered in this browser. No names or emails.
function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Fallback for browsers that only allow randomUUID on secure (https) pages.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function getUserId() {
  try {
    let id = localStorage.getItem('cyclesync.userId');
    if (!id) {
      id = makeId();
      localStorage.setItem('cyclesync.userId', id);
    }
    return id;
  } catch {
    return makeId(); // Storage blocked (e.g. private browsing): works for this visit only.
  }
}

const userId = getUserId();

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);

function showScreen(name) {
  for (const el of document.querySelectorAll('main > section')) el.hidden = true;
  $('loading').hidden = true;
  $(`screen-${name}`).hidden = false;
  window.scrollTo(0, 0);
}

// Today's date in her own time zone, as YYYY-MM-DD.
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function radioValue(form, name) {
  return form.querySelector(`input[name="${name}"]:checked`)?.value ?? null;
}

function checkedValues(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value);
}

function setRadio(form, name, value) {
  const el = form.querySelector(`input[name="${name}"][value="${value}"]`);
  if (el) el.checked = true;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ---------- Onboarding ----------
const onboardingForm = $('onboarding-form');
$('lastPeriodStart').max = todayLocal();

function readOnboarding() {
  const f = onboardingForm;
  return {
    lastPeriodStart: f.lastPeriodStart.value,
    cycleLength: Number(f.cycleLength.value),
    contraception: radioValue(f, 'contraception'),
    patterns: {
      energyLowerBeforePeriod: radioValue(f, 'energyLowerBeforePeriod'),
      crampsAffectWorkouts: radioValue(f, 'crampsAffectWorkouts'),
    },
    workoutDays: checkedValues(f, 'workoutDays'),
    goal: radioValue(f, 'goal'),
  };
}

function fillOnboarding(profile) {
  const f = onboardingForm;
  f.lastPeriodStart.value = profile.lastPeriodStart;
  f.cycleLength.value = profile.cycleLength;
  setRadio(f, 'contraception', profile.contraception);
  setRadio(f, 'energyLowerBeforePeriod', profile.patterns.energyLowerBeforePeriod);
  setRadio(f, 'crampsAffectWorkouts', profile.patterns.crampsAffectWorkouts);
  for (const box of f.querySelectorAll('input[name="workoutDays"]')) {
    box.checked = profile.workoutDays.includes(box.value);
  }
  setRadio(f, 'goal', profile.goal);
}

onboardingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorBox = $('onboarding-error');
  const button = onboardingForm.querySelector('button[type="submit"]');
  errorBox.hidden = true;
  button.disabled = true;

  try {
    const { ok, data } = await api('/api/onboarding', {
      method: 'POST',
      body: JSON.stringify({ userId, profile: readOnboarding() }),
    });
    if (!ok) {
      errorBox.textContent = data.error || 'Something went wrong. Please try again.';
      errorBox.hidden = false;
      return;
    }
    await start();
  } catch {
    errorBox.textContent = 'Could not reach the server. Is it running?';
    errorBox.hidden = false;
  } finally {
    button.disabled = false;
  }
});

$('edit-setup').addEventListener('click', async () => {
  const { ok, data } = await api(`/api/onboarding?userId=${userId}`);
  if (ok) fillOnboarding(data.profile);
  showScreen('onboarding');
});

// ---------- Today's context (greeting, cycle day, phase) ----------
let profile = null; // her setup answers
let cycle = null; // from the server: cycleDay, phase, phaseInfo, periodDue, periodLate...

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function greeting(hour) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

async function loadContext() {
  const { ok, status, data } = await api(`/api/context?userId=${userId}&today=${todayLocal()}`);
  if (!ok) return status === 404 ? 'not-set-up' : 'error';
  profile = data.profile;
  cycle = data.cycle;
  return 'ok';
}

function renderContext() {
  const now = new Date();
  $('greeting').textContent = greeting(now.getHours());
  $('cycle-message').hidden = true;

  // "Tuesday · Day 4 · est. menstrual"
  const weekday = WEEKDAYS[now.getDay()];
  const parts = [weekday, `Day ${cycle.cycleDay}`];
  if (cycle.phase) parts.push(`est. ${cycle.phase}`);
  $('context-text').textContent = parts.join(' · ');

  $('info-toggle').hidden = !cycle.phase;
  $('info-toggle').setAttribute('aria-expanded', 'false');
  $('estimate-note').hidden = true;
  $('estimate-note').textContent = cycle.estimateNote ?? '';
  $('phase-info').hidden = !cycle.phaseInfo;
  $('phase-info').textContent = cycle.phaseInfo ?? '';

  const usualDay = profile.workoutDays.includes(WEEKDAY_KEYS[now.getDay()]);
  $('workout-day').hidden = !usualDay;
  $('workout-day').textContent = `${weekday} is one of your usual workout days.`;

  renderPeriodBox();
}

$('info-toggle').addEventListener('click', () => {
  const open = $('estimate-note').hidden;
  $('estimate-note').hidden = !open;
  $('info-toggle').setAttribute('aria-expanded', String(open));
});

// ---------- Saving a new period start ----------
// Used by "Has your period started?" and "Update my cycle". Refreshes the
// header (cycle day, phase) without losing check-in answers she's already given.
async function savePeriodStart(date) {
  const { ok, data } = await api('/api/period', {
    method: 'POST',
    body: JSON.stringify({ userId, date }),
  });
  if (!ok) {
    const err = new Error(data.error || 'Could not save. Please try again.');
    err.fromServer = true;
    throw err;
  }
  if ((await loadContext()) === 'ok') {
    renderContext();
    renderStep();
  }
  $('cycle-message').textContent = `Saved. Today is day ${cycle.cycleDay}.`;
  $('cycle-message').hidden = false;
}

// ---------- "Has your period started?" ----------
// Only shown when her period is due or late. Never during her period.
function renderPeriodBox() {
  $('period-box').hidden = !(cycle.periodDue || cycle.periodLate);
  $('period-prompt').textContent = cycle.periodLate
    ? 'Your period might be late. Has it started?'
    : 'Your period may be due. Has it started?';
  $('period-confirm').hidden = true;
  $('period-start').hidden = false;
  $('period-error').hidden = true;
}

$('period-start').addEventListener('click', () => {
  $('period-confirm-text').textContent = `You're on day ${cycle.cycleDay}. Start a new cycle from today?`;
  $('period-start').hidden = true;
  $('period-confirm').hidden = false;
});

$('period-cancel').addEventListener('click', () => {
  $('period-confirm').hidden = true;
  $('period-start').hidden = false;
});

$('period-yes').addEventListener('click', async () => {
  try {
    await savePeriodStart(todayLocal());
  } catch (err) {
    $('period-error').textContent = err.fromServer ? err.message : 'Could not reach the server. Is it running?';
    $('period-error').hidden = false;
  }
});

// ---------- "Update my cycle" ----------
// Log a period that came early, or correct the last start date.
function friendlyDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

$('update-cycle').addEventListener('click', () => {
  $('cycle-summary').textContent =
    `Your last period started ${friendlyDate(profile.lastPeriodStart)}, so today is day ${cycle.cycleDay}.`;
  $('cycleStart').value = profile.lastPeriodStart;
  $('cycleStart').max = todayLocal();
  $('cycle-error').hidden = true;
  showScreen('cycle');
});

$('cycle-today').addEventListener('click', () => {
  $('cycleStart').value = todayLocal();
});

$('cycle-cancel').addEventListener('click', () => showScreen('checkin'));

$('cycle-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('cycle-form').querySelector('button[type="submit"]');
  $('cycle-error').hidden = true;
  button.disabled = true;
  try {
    await savePeriodStart($('cycleStart').value);
    showScreen('checkin');
  } catch (err) {
    $('cycle-error').textContent = err.fromServer
      ? 'Please pick a date within the past year, not in the future.'
      : 'Could not reach the server. Is it running?';
    $('cycle-error').hidden = false;
  } finally {
    button.disabled = false;
  }
});

// ---------- Morning check-in: one question at a time ----------
const checkinForm = $('checkin-form');
let currentStep = null;
let advanceTimer = null;

// Ask "Any cramps today?" first on period days, if she said cramps usually
// (or sometimes) affect her workouts.
function asksCrampsFirst() {
  const affects = profile?.patterns.crampsAffectWorkouts;
  return Boolean(cycle?.isPeriodDay && (affects === 'yes' || affects === 'sometimes'));
}

// The questions to ask, in order, given the answers so far.
function stepList() {
  const f = checkinForm;
  const steps = [];
  const crampsFirst = asksCrampsFirst();
  if (crampsFirst) {
    steps.push('crampsFirst');
    if (radioValue(f, 'crampsToday') === 'yes') steps.push('severePain');
  }

  steps.push('workout');
  const type = radioValue(f, 'workoutType');
  if (type === 'run') steps.push('runAmount', 'runKind');
  if (type === 'strength') steps.push('strengthFocus', 'strengthLoad');
  if (type === 'class') steps.push('classType');

  steps.push('energy', 'sleep', 'symptoms');

  const symptoms = checkedValues(f, 'symptoms');
  if (symptoms.includes('heavy_flow')) steps.push('heavyFlow');
  // Cramps picked here (and not already asked about up front): ask about severity now.
  if (symptoms.includes('cramps') && !steps.includes('severePain')) steps.push('severePain');

  steps.push('soreness');
  return steps;
}

// Is this question answered? (Soreness is optional, so always "done".)
function isAnswered(step) {
  const f = checkinForm;
  switch (step) {
    case 'crampsFirst': return radioValue(f, 'crampsToday') !== null;
    case 'severePain': return radioValue(f, 'severePainNotEasing') !== null;
    case 'workout': return radioValue(f, 'workoutType') !== null;
    case 'runAmount': return Number(f.runAmount.value) > 0 && radioValue(f, 'runUnit') !== null;
    case 'runKind': return radioValue(f, 'runKind') !== null;
    case 'strengthFocus': return radioValue(f, 'strengthFocus') !== null;
    case 'strengthLoad': return radioValue(f, 'strengthLoad') !== null;
    case 'classType': return radioValue(f, 'classType') !== null;
    case 'energy': return radioValue(f, 'energy') !== null;
    case 'sleep': return radioValue(f, 'sleep') !== null;
    case 'symptoms': return checkedValues(f, 'symptoms').length > 0;
    case 'heavyFlow': return checkedValues(f, 'heavyFlowSigns').length > 0;
    default: return true;
  }
}

function renderStep() {
  const steps = stepList();
  if (!steps.includes(currentStep)) currentStep = steps[0];
  const index = steps.indexOf(currentStep);

  for (const el of checkinForm.querySelectorAll('.step')) {
    el.hidden = el.dataset.step !== currentStep;
  }

  $('dots').replaceChildren(
    ...steps.map((_, i) => {
      const dot = document.createElement('span');
      if (i < index) dot.className = 'done';
      if (i === index) dot.className = 'on';
      return dot;
    }),
  );
  $('step-back').disabled = index === 0;

  // "Next" buttons (run distance, symptoms) only work once answered.
  for (const btn of checkinForm.querySelectorAll('[data-next]')) {
    btn.disabled = !isAnswered(btn.closest('.step').dataset.step);
  }
  $('checkin-error').hidden = true;
}

function goNext() {
  clearTimeout(advanceTimer);
  const steps = stepList();
  const index = steps.indexOf(currentStep);
  if (index < steps.length - 1) currentStep = steps[index + 1];
  renderStep();
  window.scrollTo(0, 0);
}

function goBack() {
  clearTimeout(advanceTimer);
  const steps = stepList();
  const index = steps.indexOf(currentStep);
  if (index > 0) currentStep = steps[index - 1];
  renderStep();
}

function resetCheckin() {
  checkinForm.reset();
  currentStep = null;
  renderStep();
}

$('step-back').addEventListener('click', goBack);
for (const btn of checkinForm.querySelectorAll('[data-next]')) btn.addEventListener('click', goNext);

// Keep "Any cramps today?" and the symptom list in step with each other,
// and keep "None" from being picked together with other symptoms.
checkinForm.addEventListener('change', (event) => {
  const { name, value, checked } = event.target;

  if (name === 'crampsToday') {
    const cramps = checkinForm.querySelector('input[name="symptoms"][value="cramps"]');
    cramps.checked = value === 'yes';
    if (value === 'yes') checkinForm.querySelector('input[name="symptoms"][value="none"]').checked = false;
  }

  // "Nothing, I feel good" / "None of these" can't be picked with anything else.
  if ((name === 'symptoms' || name === 'heavyFlowSigns') && checked) {
    for (const box of checkinForm.querySelectorAll(`input[name="${name}"]`)) {
      if (value === 'none' ? box.value !== 'none' : box.value === 'none') box.checked = false;
    }
  }

  renderStep();
});

checkinForm.addEventListener('input', (event) => {
  if (event.target.name === 'runAmount') renderStep();
});

// Auto-advance: tapping an answer moves to the next question after a short
// pause (so she sees her choice). Tapping the same answer again also advances,
// which matters after using the back arrow.
// Not on: symptoms and heavy-flow signs (pick several, then Next), unless
// "Nothing, I feel good" / "None of these";
// run distance (type a number); soreness (last question, has its own button).
checkinForm.addEventListener('click', (event) => {
  const input = event.target;
  if (input.tagName !== 'INPUT') return;
  const step = input.closest('.step')?.dataset.step;
  if (!step || step === 'soreness') return;

  let advance = false;
  if (input.type === 'radio' && step !== 'runAmount') advance = true;
  if (step === 'runAmount' && input.name === 'runUnit') advance = isAnswered('runAmount');
  if (step === 'symptoms' || step === 'heavyFlow') advance = input.value === 'none' && input.checked;

  if (advance) {
    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(goNext, 250);
  }
});

// Enter on the distance box = Next, instead of submitting the form.
$('runAmount').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (isAnswered('runAmount')) goNext();
  }
});

// The one "Is any of this happening?" screen → the same four yes/no answers
// the safety screen expects. Ticked = true, not ticked = false.
// Nothing ticked at all = unanswered (null), which the server rejects.
const HEAVY_FLOW_QUESTIONS = ['soakingHourly', 'over7Days', 'largeClots', 'dizzyOrBreathless'];
function heavyFlowAnswers(ticked) {
  const answered = ticked.length > 0;
  return Object.fromEntries(HEAVY_FLOW_QUESTIONS.map((q) => [q, answered ? ticked.includes(q) : null]));
}

// "yes" → true, "no" → false, unanswered → null
function yesNo(name) {
  const v = radioValue(checkinForm, name);
  return v === 'yes' ? true : v === 'no' ? false : null;
}

function readCheckin() {
  const f = checkinForm;
  const type = radioValue(f, 'workoutType');
  const workout = { type };
  if (type === 'run') {
    workout.amount = f.runAmount.value === '' ? null : Number(f.runAmount.value);
    workout.unit = radioValue(f, 'runUnit');
    workout.kind = radioValue(f, 'runKind');
  } else if (type === 'strength') {
    workout.focus = radioValue(f, 'strengthFocus');
    workout.load = radioValue(f, 'strengthLoad');
  } else if (type === 'class') {
    workout.classType = radioValue(f, 'classType');
  }

  const symptoms = checkedValues(f, 'symptoms');
  const checkin = {
    workout,
    energy: Number(radioValue(f, 'energy')),
    sleep: radioValue(f, 'sleep'),
    symptoms,
    soreness: radioValue(f, 'soreness'),
  };
  if (symptoms.includes('heavy_flow')) checkin.heavyFlow = heavyFlowAnswers(checkedValues(f, 'heavyFlowSigns'));
  if (symptoms.includes('cramps')) checkin.severePainNotEasing = yesNo('severePainNotEasing');
  return checkin;
}

checkinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorBox = $('checkin-error');

  // Anything skipped (other than soreness)? Go back to it.
  const missing = stepList().find((step) => !isAnswered(step));
  if (missing) {
    currentStep = missing;
    renderStep();
    errorBox.textContent = 'Just this one first.';
    errorBox.hidden = false;
    return;
  }

  const button = checkinForm.querySelector('button[type="submit"]');
  errorBox.hidden = true;
  button.disabled = true;

  try {
    const { ok, data } = await api('/api/checkin', {
      method: 'POST',
      body: JSON.stringify({ userId, checkin: readCheckin() }),
    });
    if (!ok) {
      errorBox.textContent = data.error || 'Something went wrong. Please try again.';
      errorBox.hidden = false;
      return;
    }
    // The server ran the safety screen. If a rule fired, show only its fixed
    // message(s): no workout advice, and no recommendation.
    if (data.safety) {
      showSafety(data.safety);
      return;
    }
    showScreen('received');
  } catch {
    errorBox.textContent = 'Could not reach the server. Is it running?';
    errorBox.hidden = false;
  } finally {
    button.disabled = false;
  }
});

// Safety messages are plain text from the server (textContent, never HTML).
function showSafety(rules) {
  const box = $('safety-messages');
  box.replaceChildren();
  for (const { message } of rules) {
    const p = document.createElement('p');
    p.className = 'safety-msg';
    p.textContent = message;
    box.append(p);
  }
  showScreen('safety');
}

$('safety-back').addEventListener('click', () => {
  resetCheckin();
  showScreen('checkin');
});

$('back-to-checkin').addEventListener('click', () => {
  resetCheckin();
  showScreen('checkin');
});

// ---------- Start ----------
// Set up already? Open the check-in with today's context. Otherwise, onboarding.
async function start() {
  const result = await loadContext();
  if (result === 'not-set-up') return showScreen('onboarding');
  if (result === 'error') throw new Error('Could not load');
  renderContext();
  resetCheckin();
  showScreen('checkin');
}

start().catch(() => {
  $('loading').textContent = 'Could not reach the server. Is it running?';
});
