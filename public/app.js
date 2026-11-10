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
    showScreen('home');
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

// ---------- Start ----------
// Already set up? Go to home. Otherwise, onboarding.
api(`/api/onboarding?userId=${userId}`)
  .then(({ ok }) => showScreen(ok ? 'home' : 'onboarding'))
  .catch(() => {
    $('loading').textContent = 'Could not reach the server. Is it running?';
  });
