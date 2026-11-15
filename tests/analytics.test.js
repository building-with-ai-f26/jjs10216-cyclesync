// PostHog analytics (Plan.md step 8): no health data is ever sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { GET as getConfig } from '../api/config.js';

const pub = join(import.meta.dirname, '..', 'public');
const appJs = readFileSync(join(pub, 'app.js'), 'utf8');
const html = readFileSync(join(pub, 'index.html'), 'utf8');

// Loads public/analytics.js the way a browser would, with a fake PostHog that
// records what would be sent (after before_send, like the real one).
function loadAnalytics() {
  const sandbox = { globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync(join(pub, 'analytics.js'), 'utf8'), sandbox);
  const a = sandbox.csAnalytics;
  const sent = [];
  const config = a.postHogConfig('https://us.i.posthog.com');
  const registered = {};
  const fake = {
    register: (p) => Object.assign(registered, p),
    capture: (event, properties) => {
      const out = plain(config.before_send({ event, properties: { token: 'phc_test', distinct_id: 'anon', ...registered, ...properties } }));
      if (out) sent.push(out);
    },
  };
  return { a, sent, config, fake };
}

// Objects made inside the sandbox → plain objects, so deepEqual compares values only.
const plain = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

// Every health value a check-in or card can contain.
const HEALTH = {
  energy: 2, sleep: 'poor', symptoms: ['cramps', 'heavy_flow'], soreness: 'a_lot',
  crampsUnusual: true, heavyFlow: { soakingHourly: true }, cycleDay: 22, phase: 'luteal',
  verdict: 'ADJUST', headline: 'Easy 3 miles', prescription: '3 miles easy', reason: 'Low energy',
  extra_tip: 'Drink water', safety: true, lastPeriodStart: '2026-11-01', contraception: 'no',
};
const HEALTH_WORDS = /cramps|heavy_flow|luteal|follicular|menstrual|ADJUST|Easy 3 miles|poor|a_lot|soakingHourly|2026-11-01|"energy"|"sleep"|"symptoms"|cycleDay|"phase"|"verdict"/;

test('funnel events carry only source, workout_type and response, even if health data is passed in', () => {
  const { a, sent, config, fake } = loadAnalytics();
  config.loaded(fake);
  a.track('checkin_started', HEALTH);
  a.track('checkin_completed', { workout_type: 'run', ...HEALTH });
  a.track('result_shown', { workout_type: 'run', ...HEALTH });
  a.track('response_tapped', { workout_type: 'run', response: 'rest', ...HEALTH });

  const own = (e) => Object.fromEntries(Object.entries(e.properties).filter(([k]) => !['token', 'distinct_id'].includes(k)));
  assert.deepEqual(sent.map((e) => [e.event, own(e)]), [
    ['checkin_started', { source: 'app' }],
    ['checkin_completed', { source: 'app', workout_type: 'run' }],
    ['result_shown', { source: 'app', workout_type: 'run' }],
    ['response_tapped', { source: 'app', workout_type: 'run', response: 'rest' }],
  ]);
  assert.doesNotMatch(JSON.stringify(sent), HEALTH_WORDS);
});

test('the last check (before_send) strips health data even if it got past track()', () => {
  const { config } = loadAnalytics();
  const out = plain(config.before_send({
    event: 'result_shown',
    properties: { token: 't', distinct_id: 'd', $current_url: 'http://localhost:3000/', workout_type: 'run', ...HEALTH },
  }));
  assert.deepEqual(out.properties, { token: 't', distinct_id: 'd', $current_url: 'http://localhost:3000/', workout_type: 'run', source: 'app' });
});

test('only the known values of workout_type and response are sent', () => {
  const { a, sent, config, fake } = loadAnalytics();
  config.loaded(fake);
  a.track('response_tapped', { workout_type: 'Easy 3 miles instead', response: 'cramps' });
  assert.equal(sent[0].properties.workout_type, undefined);
  assert.equal(sent[0].properties.response, undefined);
  const dirty = plain(config.before_send({ event: 'checkin_completed', properties: { workout_type: 'luteal run' } }));
  assert.deepEqual(dirty.properties, { source: 'app' });
});

test('any other custom event is dropped', () => {
  const { a, sent, config, fake } = loadAnalytics();
  config.loaded(fake);
  a.track('safety_shown', {});
  a.track('symptoms_cramps', {});
  assert.equal(sent.length, 0);
  assert.equal(config.before_send({ event: 'safety_shown', properties: {} }), null);
});

test('every event, including pageviews, clicks and replays, gets source: "app"', () => {
  const { config } = loadAnalytics();
  for (const event of ['$pageview', '$autocapture', '$snapshot', 'checkin_started']) {
    assert.equal(config.before_send({ event, properties: {} }).properties.source, 'app', event);
  }
  const registered = {};
  config.loaded({ register: (p) => Object.assign(registered, p), capture() {} });
  assert.deepEqual(plain(registered), { source: 'app' });
});

test('events tracked before PostHog loads are sent once it loads, still cleaned', () => {
  const { a, sent, config, fake } = loadAnalytics();
  a.track('checkin_started', HEALTH);
  assert.equal(sent.length, 0);
  config.loaded(fake);
  assert.deepEqual(sent.map((e) => e.event), ['checkin_started']);
  assert.doesNotMatch(JSON.stringify(sent), HEALTH_WORDS);
});

test('PostHog settings: replay on, inputs masked, health screens blocked, no heatmaps or network list', () => {
  const { config } = loadAnalytics();
  assert.equal(config.api_host, 'https://us.i.posthog.com');
  assert.equal(config.autocapture, true);
  assert.equal(config.capture_pageview, true);
  assert.equal(config.disable_session_recording, false);
  assert.equal(config.session_recording.maskAllInputs, true);
  assert.equal(config.session_recording.blockClass, 'ph-no-capture');
  assert.equal(config.enable_heatmaps, false);
  assert.equal(config.capture_performance, false);
  assert.equal(config.enable_recording_console_log, false);
});

test('app.js only sends the four funnel events, through analytics.js', () => {
  const names = [...appJs.matchAll(/\btrack\('([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(names)].sort(), ['checkin_completed', 'checkin_started', 'response_tapped', 'result_shown']);
  assert.doesNotMatch(appJs, /\bposthog\s*[.?[]/, 'app.js never talks to PostHog directly');
  // The properties passed are only workout_type and response.
  for (const [, props] of appJs.matchAll(/\btrack\('[a-z_]+',\s*\{([^}]*)\}/g)) {
    const keys = [...props.matchAll(/(\w+):/g)].map((m) => m[1]);
    for (const k of keys) assert.ok(['workout_type', 'response'].includes(k), `unexpected property ${k}`);
  }
});

test('health screens, the safety screen and the card are hidden from replays (ph-no-capture)', () => {
  const ids = ['onboarding-form', 'period-box', 'checkin-form', 'cycle-message', 'cycle-summary', 'cycle-form', 'screen-safety', 'screen-result'];
  for (const id of ids) {
    const tag = html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`));
    assert.ok(tag, `${id} exists`);
    assert.match(tag[0], /class="[^"]*\bph-no-capture\b/, `${id} has ph-no-capture`);
  }
  assert.match(html, /<div class="context ph-no-capture">/, 'cycle day / phase line is hidden');
  assert.ok(html.indexOf('analytics.js') < html.indexOf('app.js'), 'analytics.js loads before app.js');
});

test('/api/config: no key → no analytics', async () => {
  const saved = { key: process.env.POSTHOG_KEY, host: process.env.POSTHOG_HOST };
  try {
    delete process.env.POSTHOG_KEY;
    assert.deepEqual(await getConfig().json(), { posthog: null });
    process.env.POSTHOG_KEY = '  ';
    assert.deepEqual(await getConfig().json(), { posthog: null });

    process.env.POSTHOG_KEY = 'phc_example';
    delete process.env.POSTHOG_HOST;
    assert.deepEqual(await getConfig().json(), { posthog: { key: 'phc_example', host: 'https://us.i.posthog.com' } });
    process.env.POSTHOG_HOST = 'https://eu.i.posthog.com/';
    assert.deepEqual(await getConfig().json(), { posthog: { key: 'phc_example', host: 'https://eu.i.posthog.com' } });
  } finally {
    if (saved.key === undefined) delete process.env.POSTHOG_KEY; else process.env.POSTHOG_KEY = saved.key;
    if (saved.host === undefined) delete process.env.POSTHOG_HOST; else process.env.POSTHOG_HOST = saved.host;
  }
});
