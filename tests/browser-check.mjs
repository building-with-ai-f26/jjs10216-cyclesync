// Browser check: clicks through the real app in headless Chrome, at phone size.
//
//   npm run test:browser
//
// - Needs Google Chrome installed (no npm packages). Set CHROME_PATH if Chrome
//   isn't in /Applications.
// - Starts its own server on port 3131 with a TEMPORARY data file, so your
//   real data/cyclesync-db.json is never touched.
// - Covers the safety screen: heavy flow + a warning sign, unusual cramps, and a
//   normal check-in that passes through.
// - Covers the recommendation card (mock AI), the four response buttons, and
//   that the check-in and response are saved under one ID.
// - Saves screenshots to a temporary folder and prints where.
// - Not part of `npm test` (that stays fast and browser-free).

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..');
const WORK = mkdtempSync(join(tmpdir(), 'cyclesync-browser-'));
const SHOTS = join(WORK, 'screenshots');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 3131;
const DEBUG_PORT = 9334;
const BASE = `http://localhost:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  → got: ${detail}` : ''}`);
  if (!cond) failures++;
}

async function waitFor(fn, tries = 150) {
  for (let i = 0; i < tries; i++) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(200);
  }
  throw new Error('Timed out waiting. Is Chrome installed, and are ports 3131 and 9334 free?');
}

// ---------- Start the server and Chrome ----------
const server = spawn('node', ['server.js'], {
  cwd: REPO,
  env: { ...process.env, PORT: String(PORT), CYCLESYNC_DB_FILE: join(WORK, 'db.json') },
  stdio: 'ignore',
});
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${join(WORK, 'chrome')}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

async function cleanup() {
  chrome.kill();
  server.kill();
  await sleep(1000);
  try { rmSync(join(WORK, 'chrome'), { recursive: true, force: true }); } catch {}
}

let ws;
try {
  await waitFor(() => fetch(`${BASE}/api/health`).then((r) => r.ok));
  const targets = await waitFor(() => fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json()));
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve) => (ws.onopen = resolve));
} catch (err) {
  console.error(err.message);
  await cleanup();
  process.exit(1);
}

// ---------- Talking to Chrome (DevTools protocol) ----------
let nextId = 1;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const cdp = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
async function js(expr) {
  const r = await cdp('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
  return r.result?.result?.value;
}
async function shot(name) {
  const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.result.data, 'base64'));
}
await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

// ---------- Helpers ----------
function iso(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Exact wording from research/recommendation-spec.md section 3.
const HEAVY_MSG = 'That sounds like heavier bleeding than usual. Please check in with a doctor before training today, and rest is a good call.';
const CRAMPS_MSG = "That sounds different from your usual cramps. It's worth checking in with your doctor, and resting today is a good call.";
const WEEKDAY = new Date().toLocaleDateString('en-US', { weekday: 'long' });
const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const BASE_PROFILE = {
  cycleLength: 28,
  contraception: 'no',
  patterns: { energyLowerBeforePeriod: 'yes', crampsAffectWorkouts: 'sometimes' },
  workoutDays: ALL_DAYS,
  goal: 'stay_consistent',
};

async function makeUser(id, profile) {
  const res = await fetch(`${BASE}/api/onboarding`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: id, profile }),
  });
  if (!res.ok) throw new Error(await res.text());
}
async function openAs(id) {
  await cdp('Page.navigate', { url: `${BASE}/` });
  await sleep(500);
  await js(`localStorage.setItem('cyclesync.userId', '${id}')`);
  await cdp('Page.reload');
  await waitFor(() => js(`return !document.getElementById('screen-checkin').hidden || !document.getElementById('screen-onboarding').hidden`));
}
const visibleStep = () => js(`return [...document.querySelectorAll('.step')].filter((s) => !s.hidden).map((s) => s.dataset.step).join(',')`);
const isShown = (id) => js(`const el = document.getElementById('${id}'); return !!el && el.offsetParent !== null`);
const text = (id) => js(`return document.getElementById('${id}').textContent.trim()`);
const isChecked = (name, value) => js(`return document.querySelector('input[name="${name}"][value="${value}"]').checked`);
const click = async (id) => { await js(`document.getElementById('${id}').click()`); await sleep(150); };
const clickNext = async (step) => { await js(`document.querySelector('[data-step="${step}"] [data-next]').click()`); await sleep(150); };
async function tap(name, value) {
  await js(`document.querySelector('input[name="${name}"][value="${value}"]').click()`);
  await sleep(400); // auto-advance waits 250ms
}
async function submit() {
  await js(`document.querySelector('#checkin-form button[type="submit"]').click()`);
  await waitFor(() => js(`return !document.getElementById('screen-result').hidden || !document.getElementById('screen-safety').hidden`));
}
async function respond(value) {
  await js(`document.querySelector('#response-buttons [data-response="${value}"]').click()`);
  await waitFor(() => isShown('response-saved'));
  await sleep(150);
}
// Reads the temporary data file the test server writes to.
function savedCheckin(id) {
  try {
    return JSON.parse(readFileSync(join(WORK, 'db.json'), 'utf8')).checkins[id];
  } catch {
    return undefined;
  }
}
async function setDate(id, value) {
  await js(`document.getElementById('${id}').value = '${value}'`);
}

try {
  mkdirSync(SHOTS, { recursive: true });

  // ===== 1. Day 4 of a natural cycle, cramps "sometimes" affect workouts =====
  console.log('\n— Day 4, natural cycle, cramps sometimes affect workouts —');
  const day4 = '11111111-1111-4111-8111-111111111111';
  await makeUser(day4, { ...BASE_PROFILE, lastPeriodStart: iso(-3) });
  await openAs(day4);
  check('opens on the check-in screen', await isShown('screen-checkin'));
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  check(`greeting is "${hello}"`, (await text('greeting')) === hello, await text('greeting'));
  check(`context reads "${WEEKDAY} · Day 4 · est. menstrual"`, (await text('context-text')) === `${WEEKDAY} · Day 4 · est. menstrual`, await text('context-text'));
  check('phase line shows; estimate note hidden until ⓘ is tapped', (await isShown('phase-info')) && !(await isShown('estimate-note')));
  await click('info-toggle');
  check('tapping ⓘ shows the estimate note', await isShown('estimate-note'));
  check('usual-workout-day line shows', (await text('workout-day')) === `${WEEKDAY} is one of your usual workout days.`, await text('workout-day'));
  check('during her period: NO "has your period started" prompt', !(await isShown('period-box')));
  check('"Set today as day 1?" never shows on its own', !(await isShown('period-confirm')));
  check('"Edit my setup" and "Update my cycle" links show', (await isShown('edit-setup')) && (await isShown('update-cycle')));
  check('back arrow disabled on the first question', await js(`return document.getElementById('step-back').disabled`));
  await shot('1-open-day4');

  check('first question: "Any cramps today?"', (await visibleStep()) === 'crampsFirst', await visibleStep());
  await tap('crampsToday', 'yes');
  check('"Yes" → asks if the cramps are unusual', (await visibleStep()) === 'crampsCheck', await visibleStep());
  check('it asks the new cramps question with "Yes" / "No, it\'s my usual"',
    (await js(`const s = document.querySelector('[data-step="crampsCheck"]'); return s.querySelector('.step-q').textContent.trim() + ' | ' + [...s.querySelectorAll('.chip span')].map((x) => x.textContent).join(' / ')`)) === `Are these cramps worse than your usual, not helped by pain relief, or coming with fever or vomiting? | Yes / No, it's my usual`);
  await tap('crampsUnusual', 'no');
  check('→ "What\'s on the plan today?"', (await visibleStep()) === 'workout', await visibleStep());
  await tap('workoutType', 'run');
  check('Run → "How far or how long?"', (await visibleStep()) === 'runAmount', await visibleStep());
  check('Next disabled before a distance is typed', await js(`return document.querySelector('[data-step="runAmount"] [data-next]').disabled`));
  await js(`const i = document.getElementById('runAmount'); i.value = '5'; i.dispatchEvent(new Event('input', { bubbles: true }))`);
  await tap('runUnit', 'miles');
  check('5 + miles → "What kind of run?"', (await visibleStep()) === 'runKind', await visibleStep());
  await tap('runKind', 'tempo');
  check('→ energy', (await visibleStep()) === 'energy', await visibleStep());
  await shot('2-energy');
  await tap('energy', '2');
  check('→ sleep', (await visibleStep()) === 'sleep', await visibleStep());
  await tap('sleep', 'poor');
  check('→ symptoms', (await visibleStep()) === 'symptoms', await visibleStep());
  check('cramps already ticked from the first question', await isChecked('symptoms', 'cramps'));
  await tap('symptoms', 'heavy_flow');
  check('ticking a symptom does NOT auto-advance', (await visibleStep()) === 'symptoms', await visibleStep());
  await clickNext('symptoms');

  // Heavy flow: one screen, tap all that apply
  check('Next → ONE heavy-flow screen', (await visibleStep()) === 'heavyFlow', await visibleStep());
  check('it reads "Thanks for telling me. Is any of this happening?"',
    (await js(`return document.querySelector('[data-step="heavyFlow"] .step-q').textContent.trim()`)) === 'Thanks for telling me. Is any of this happening?');
  check('Next disabled until something is ticked', await js(`return document.querySelector('[data-step="heavyFlow"] [data-next]').disabled`));
  await tap('heavyFlowSigns', 'largeClots');
  check('ticking a sign does NOT auto-advance', (await visibleStep()) === 'heavyFlow', await visibleStep());
  await shot('3-heavy-flow');
  check('safety answers: clots = yes, the other three = no',
    JSON.stringify(await js(`return readCheckin().heavyFlow`)) === JSON.stringify({ soakingHourly: false, over7Days: false, largeClots: true, dizzyOrBreathless: false }),
    JSON.stringify(await js(`return readCheckin().heavyFlow`)));
  await tap('heavyFlowSigns', 'none');
  check('"None of these" clears the other ticks', !(await isChecked('heavyFlowSigns', 'largeClots')));
  check('"None of these" auto-advances (severity not asked twice) → soreness', (await visibleStep()) === 'soreness', await visibleStep());
  check('safety answers with "None of these": all four = no',
    JSON.stringify(await js(`return readCheckin().heavyFlow`)) === JSON.stringify({ soakingHourly: false, over7Days: false, largeClots: false, dizzyOrBreathless: false }));
  const dots = await js(`return { total: document.querySelectorAll('#dots span').length, on: [...document.querySelectorAll('#dots span')].findIndex((d) => d.className === 'on') }`);
  check('worst-day check-in is now 10 questions, on the last', dots.total === 10 && dots.on === 9, JSON.stringify(dots));
  await click('step-back');
  check('back arrow → heavy-flow screen, answer kept', (await visibleStep()) === 'heavyFlow' && (await isChecked('heavyFlowSigns', 'none')));
  await tap('heavyFlowSigns', 'soakingHourly');
  check('ticking a sign clears "None of these"', !(await isChecked('heavyFlowSigns', 'none')));
  await clickNext('heavyFlow');
  check('Next → soreness', (await visibleStep()) === 'soreness', await visibleStep());
  await shot('4-soreness');
  await js(`document.querySelector('#checkin-form button[type="submit"]').click()`);
  await waitFor(() => isShown('screen-safety'));
  console.log('\n— Safety screen: heavy flow + soaking hourly —');
  check('soreness skipped is fine; soaking hourly → the safety screen', await isShown('screen-safety'));
  check('it shows the heavy-bleeding message, word for word',
    (await text('safety-messages')) === HEAVY_MSG, await text('safety-messages'));
  check('only that one message (cramps were "my usual")', (await js(`return document.querySelectorAll('#safety-messages p').length`)) === 1);
  check('no recommendation card', !(await isShown('screen-result')));
  check('safety screen is hidden from PostHog replays', await js(`return document.getElementById('screen-safety').classList.contains('ph-no-capture')`));
  await shot('4b-safety-heavy');

  // Update my cycle
  console.log('\n— Update my cycle —');
  await click('safety-back');
  check('back to a fresh check-in', (await visibleStep()) === 'crampsFirst', await visibleStep());
  await click('update-cycle');
  check('"Update my cycle" opens its screen', await isShown('screen-cycle'));
  const summary = await text('cycle-summary');
  check('it shows the saved start date and today\'s day', summary.includes('so today is day 4.'), summary);
  check('date box starts at the saved start date', (await js(`return document.getElementById('cycleStart').value`)) === iso(-3));
  await shot('5-update-cycle');
  await setDate('cycleStart', iso(10));
  await js(`document.querySelector('#cycle-form button[type="submit"]').click()`);
  await waitFor(() => isShown('cycle-error'));
  check('a future date is refused, with a message', (await isShown('cycle-error')) && (await isShown('screen-cycle')));
  await setDate('cycleStart', iso(-5));
  await js(`document.querySelector('#cycle-form button[type="submit"]').click()`);
  await waitFor(() => isShown('screen-checkin'));
  check(`correcting the date → "${WEEKDAY} · Day 6 · est. follicular"`, (await text('context-text')) === `${WEEKDAY} · Day 6 · est. follicular`, await text('context-text'));
  check('confirmation: "Saved. Today is day 6."', (await text('cycle-message')) === 'Saved. Today is day 6.', await text('cycle-message'));
  check('not a period day any more → starts with the workout question', (await visibleStep()) === 'workout', await visibleStep());
  await click('update-cycle');
  await click('cycle-today');
  check('"Today" fills in today\'s date', (await js(`return document.getElementById('cycleStart').value`)) === iso(0));
  await js(`document.querySelector('#cycle-form button[type="submit"]').click()`);
  await waitFor(() => isShown('screen-checkin'));
  check(`early period logged → "${WEEKDAY} · Day 1 · est. menstrual"`, (await text('context-text')) === `${WEEKDAY} · Day 1 · est. menstrual`, await text('context-text'));
  check('still no "has your period started" prompt on day 1', !(await isShown('period-box')));
  await click('update-cycle');
  await click('cycle-cancel');
  check('Cancel goes back to the check-in', await isShown('screen-checkin'));

  // ===== 2. Day 10: not a period day =====
  console.log('\n— Day 10, natural cycle —');
  const day10 = '22222222-2222-4222-8222-222222222222';
  await makeUser(day10, { ...BASE_PROFILE, lastPeriodStart: iso(-9) });
  await openAs(day10);
  check(`context reads "${WEEKDAY} · Day 10 · est. follicular"`, (await text('context-text')) === `${WEEKDAY} · Day 10 · est. follicular`, await text('context-text'));
  check('no period prompt (not due)', !(await isShown('period-box')));
  check('starts with the workout question', (await visibleStep()) === 'workout', await visibleStep());
  await tap('workoutType', 'walk_yoga');
  check('Walk or yoga → no detail question, straight to energy', (await visibleStep()) === 'energy', await visibleStep());
  await tap('energy', '4');
  await tap('sleep', 'good');
  await tap('symptoms', 'none');
  check('"Nothing, I feel good" auto-advances to soreness', (await visibleStep()) === 'soreness', await visibleStep());
  await click('step-back');
  await tap('symptoms', 'cramps');
  check('ticking cramps clears "Nothing, I feel good"', !(await isChecked('symptoms', 'none')));
  await clickNext('symptoms');
  check('cramps ticked here → cramps follow-up asked after symptoms', (await visibleStep()) === 'crampsCheck', await visibleStep());
  await tap('crampsUnusual', 'yes');
  check('"Yes" → soreness', (await visibleStep()) === 'soreness', await visibleStep());
  await js(`document.querySelector('#checkin-form button[type="submit"]').click()`);
  await waitFor(() => isShown('screen-safety'));
  console.log('\n— Safety screen: unusual cramps —');
  check('cramps "Yes" → the safety screen', await isShown('screen-safety'));
  check('it shows the unusual-cramps message, word for word',
    (await text('safety-messages')) === CRAMPS_MSG, await text('safety-messages'));
  check('no recommendation card', !(await isShown('screen-result')));
  await shot('6b-safety-cramps');
  await click('safety-back');
  check('"Back to check-in" → a fresh check-in', (await isShown('screen-checkin')) && (await visibleStep()) === 'workout', await visibleStep());

  console.log('\n— Great day: recommendation card (mock AI) —');
  await tap('workoutType', 'walk_yoga');
  await tap('energy', '5');
  await tap('sleep', 'good');
  await tap('symptoms', 'none');
  await submit();
  check('no symptoms → past the safety screen to the recommendation card', (await isShown('screen-result')) && !(await isShown('screen-safety')));
  check(`card shows "Day 10 · est. follicular"`, (await text('result-context')) === 'Day 10 · est. follicular', await text('result-context'));
  check('verdict "Keep"', (await text('result-verdict')) === 'Keep', await text('result-verdict'));
  check('headline "Keep your walk or yoga"', (await text('result-headline')) === 'Keep your walk or yoga', await text('result-headline'));
  check('prescription has a number', /\d/.test(await text('result-prescription')), await text('result-prescription'));
  check('reason shows', (await text('result-reason')).length > 0);
  check('no tip → tip box hidden', !(await isShown('result-tip')));
  check('the four response buttons, in order',
    (await js(`return [...document.querySelectorAll('#response-buttons button')].map((b) => b.textContent).join(' / ')`)) === 'Do this / Original plan / Something else / Rest');
  check('card is hidden from PostHog replays', await js(`return document.getElementById('screen-result').classList.contains('ph-no-capture')`));
  await shot('7-card-great-day');
  let id = await js(`return currentCheckinId`);
  check('the check-in was saved with an ID', !!savedCheckin(id), id);
  check('saved: answers, recommendation, day/phase, and no response yet', (() => {
    const c = savedCheckin(id);
    return c.checkin.energy === 5 && c.recommendation.verdict === 'KEEP' && c.cycle.phase === 'follicular' && c.response === null && c.source === 'mock';
  })());
  await respond('do_this');
  check('"Do this" → "Saved: doing this. Have a good one!"', (await text('response-saved')) === 'Saved: doing this. Have a good one!', await text('response-saved'));
  check('response saved on the same check-in ID', savedCheckin(id).response === 'do_this');
  await respond('rest');
  check('changing to "Rest" updates it', savedCheckin(id).response === 'rest' && (await text('response-saved')) === 'Saved: resting today. Enjoy it.');

  console.log('\n— Low-energy day: tempo run, energy 2, poor sleep —');
  await click('result-new');
  check('"Start a new check-in" → a fresh check-in', (await isShown('screen-checkin')) && (await visibleStep()) === 'workout', await visibleStep());
  await tap('workoutType', 'run');
  await js(`document.getElementById('runAmount').value = '5'; document.getElementById('runAmount').dispatchEvent(new Event('input', { bubbles: true }))`);
  await tap('runUnit', 'miles');
  await tap('runKind', 'tempo');
  await tap('energy', '2');
  await tap('sleep', 'poor');
  await tap('symptoms', 'none');
  await submit();
  check('verdict "Adjust"', (await text('result-verdict')) === 'Adjust', await text('result-verdict'));
  check('headline "Easy 3 miles instead of your 5-mile tempo run"', (await text('result-headline')) === 'Easy 3 miles instead of your 5-mile tempo run', await text('result-headline'));
  check('a tip shows', await isShown('result-tip'));
  await shot('8-card-low-energy');

  console.log('\n— Cramps, "No, it\'s my usual" passes through —');
  await click('result-new');
  await tap('workoutType', 'walk_yoga');
  await tap('energy', '3');
  await tap('sleep', 'ok');
  await tap('symptoms', 'cramps');
  await clickNext('symptoms');
  await tap('crampsUnusual', 'no');
  check('"No, it\'s my usual" → soreness', (await visibleStep()) === 'soreness', await visibleStep());
  await submit();
  check('usual cramps → recommendation card, no doctor message', (await isShown('screen-result')) && !(await isShown('screen-safety')));
  check('gentle option, not "Keep"', (await text('result-verdict')) === 'Adjust', await text('result-verdict'));
  check('rest offered as an equal option', /or rest/.test(await text('result-prescription')), await text('result-prescription'));
  check('no buttons were pre-selected from the last card', !(await js(`return !!document.querySelector('#response-buttons .chosen')`)) && !(await isShown('response-saved')));
  await shot('9-card-cramps');

  // ===== 3. Late period =====
  console.log('\n— Day 37 of a 28-day cycle (late) —');
  const late = '33333333-3333-4333-8333-333333333333';
  await makeUser(late, { ...BASE_PROFILE, lastPeriodStart: iso(-36) });
  await openAs(late);
  check(`context reads "${WEEKDAY} · Day 37" (no phase)`, (await text('context-text')) === `${WEEKDAY} · Day 37`, await text('context-text'));
  check('no ⓘ icon or phase line', !(await isShown('info-toggle')) && !(await isShown('phase-info')));
  check('"might be late" prompt shows at the top', (await isShown('period-box')) && (await text('period-prompt')) === 'Your period might be late. Has it started?');
  await shot('6-late');
  await click('period-start');
  check('confirm reads "You\'re on day 37. Start a new cycle from today?"', (await text('period-confirm-text')) === "You're on day 37. Start a new cycle from today?", await text('period-confirm-text'));
  await click('period-cancel');
  check('Cancel hides the confirmation', !(await isShown('period-confirm')));
  await click('period-start');
  await click('period-yes');
  await waitFor(async () => (await text('context-text')).includes('Day 1'));
  check(`"Yes, start day 1" → "${WEEKDAY} · Day 1 · est. menstrual"`, (await text('context-text')) === `${WEEKDAY} · Day 1 · est. menstrual`, await text('context-text'));
  check('prompt disappears (now on her period)', !(await isShown('period-box')));
  check('confirmation: "Saved. Today is day 1."', (await text('cycle-message')) === 'Saved. Today is day 1.', await text('cycle-message'));

  // ===== 4. Period due =====
  console.log('\n— Day 27 of 28 (due) —');
  const due = '44444444-4444-4444-8444-444444444444';
  await makeUser(due, { ...BASE_PROFILE, lastPeriodStart: iso(-26) });
  await openAs(due);
  check('"may be due" prompt shows', (await isShown('period-box')) && (await text('period-prompt')) === 'Your period may be due. Has it started?');

  // ===== 5. Hormonal contraception / prefer not to say =====
  for (const [contraception, id] of [['yes', '55555555-5555-4555-8555-555555555555'], ['prefer_not_to_say', '66666666-6666-4666-8666-666666666666']]) {
    console.log(`\n— Contraception "${contraception}" —`);
    await makeUser(id, { ...BASE_PROFILE, contraception, lastPeriodStart: iso(-3), workoutDays: ['sat'] });
    await openAs(id);
    check(`context reads "${WEEKDAY} · Day 4" (no phase)`, (await text('context-text')) === `${WEEKDAY} · Day 4`, await text('context-text'));
    check('no phase line, no ⓘ icon', !(await isShown('phase-info')) && !(await isShown('info-toggle')));
    await tap('crampsToday', 'no');
    await tap('workoutType', 'walk_yoga');
    await tap('energy', '3');
    await tap('sleep', 'ok');
    await tap('symptoms', 'none');
    await submit();
    check('card shows "Day 4" only (no phase)', (await text('result-context')) === 'Day 4', await text('result-context'));
    if (WEEKDAY !== 'Saturday') check('not a usual workout day → no workout-day line', !(await isShown('workout-day')));
    await makeUser(id, { ...BASE_PROFILE, contraception, lastPeriodStart: iso(-40), workoutDays: ['sat'] });
    await openAs(id);
    check('day 41: no "late" prompt', !(await isShown('period-box')));
  }

  // ===== 6. New visitor =====
  console.log('\n— New visitor —');
  await cdp('Page.navigate', { url: `${BASE}/` });
  await sleep(300);
  await js(`localStorage.clear()`);
  await cdp('Page.reload');
  await waitFor(() => isShown('screen-onboarding'));
  check('a new visitor sees onboarding', await isShown('screen-onboarding'));
} catch (err) {
  failures++;
  console.error(`\nStopped early: ${err.message}`);
}

ws.close();
await cleanup();
console.log(`\nScreenshots: ${SHOTS}`);
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures ? 1 : 0);
