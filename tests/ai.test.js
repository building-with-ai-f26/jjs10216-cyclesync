// lib/ai.js with a FAKE fetch: no network, no key needed, $0.
// (The optional real-AI run is `npm run test:ai`, see tests/real-ai.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiMode, getRecommendation, callOpenRouter, describeError, RESPONSE_SCHEMA } from '../lib/ai.js';

const FAKE_KEY = 'sk-or-v1-FAKE-TEST-KEY-not-real';
const reply = { verdict: 'KEEP', headline: 'Keep it', prescription: '5 miles at effort 7/10.', reason: 'You feel great.', extra_tip: '' };

function fakeFetch(status, body) {
  const f = async (url, options) => {
    f.calls.push({ url, options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  f.calls = [];
  return f;
}
const okBody = {
  model: 'anthropic/claude-haiku-5.5',
  choices: [{ message: { content: JSON.stringify(reply) } }],
  usage: { prompt_tokens: 812, completion_tokens: 96, cost: 0.000129 },
};
const ctx = { workout: { type: 'walk_yoga' }, energy: 3, sleep: 'ok', symptoms: ['none'], soreness: null, phase: null, patterns: {} };

test('mock mode when there is no key, or AI_MODE=mock', () => {
  assert.equal(aiMode({}), 'mock');
  assert.equal(aiMode({ OPENROUTER_API_KEY: '' }), 'mock');
  assert.equal(aiMode({ OPENROUTER_API_KEY: FAKE_KEY, AI_MODE: 'mock' }), 'mock');
  assert.equal(aiMode({ OPENROUTER_API_KEY: FAKE_KEY }), 'live');
});

test('mock mode never touches the network', async () => {
  const f = fakeFetch(200, okBody);
  const r = await getRecommendation({ system: 's', user: 'u', context: ctx }, { env: {}, fetchFn: f });
  assert.equal(f.calls.length, 0);
  assert.equal(r.model, 'mock');
});

test('live mode: sends the system prompt, the message, the model and the section 6 JSON format', async () => {
  const f = fakeFetch(200, okBody);
  await getRecommendation({ system: 'SYSTEM', user: 'USER', context: ctx }, { env: { OPENROUTER_API_KEY: FAKE_KEY, OPENROUTER_MODEL: 'anthropic/claude-haiku-5.5' }, fetchFn: f });
  const { url, options, body } = f.calls[0];
  assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(options.headers.Authorization, `Bearer ${FAKE_KEY}`);
  assert.equal(body.model, 'anthropic/claude-haiku-5.5');
  assert.deepEqual(body.messages, [{ role: 'system', content: 'SYSTEM' }, { role: 'user', content: 'USER' }]);
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.response_format.json_schema.schema.properties.verdict.enum, ['KEEP', 'ADJUST', 'SWAP', 'REST']);
  assert.equal(body.provider.require_parameters, true);
  assert.ok(!JSON.stringify(body).includes(FAKE_KEY), 'the key must only be in the header');
});

test('the model defaults to Claude Haiku 5.5 when OPENROUTER_MODEL is empty', async () => {
  const f = fakeFetch(200, okBody);
  await getRecommendation({ system: 's', user: 'u', context: ctx }, { env: { OPENROUTER_API_KEY: FAKE_KEY }, fetchFn: f });
  assert.equal(f.calls[0].body.model, 'anthropic/claude-haiku-5.5');
});

test('live mode: returns the reply text, model, tokens and cost', async () => {
  const r = await callOpenRouter({ system: 's', user: 'u' }, { apiKey: FAKE_KEY, model: 'm', fetchFn: fakeFetch(200, okBody) });
  assert.deepEqual(JSON.parse(r.text), reply);
  assert.equal(r.model, 'anthropic/claude-haiku-5.5');
  assert.deepEqual(r.usage, { tokensIn: 812, tokensOut: 96, cost: 0.000129 });
});

test('"no available provider" errors are explained in plain language', async () => {
  const body = { error: { code: 404, message: 'No endpoints found matching your data policy (Free model training)' } };
  await assert.rejects(
    callOpenRouter({ system: 's', user: 'u' }, { apiKey: FAKE_KEY, model: 'm', fetchFn: fakeFetch(404, body) }),
    /No AI provider is available for this model with your OpenRouter settings/,
  );
  assert.match(describeError(404, 'No endpoints found that can handle the requested parameters.'), /No AI provider is available/);
});

test('other errors: bad key, out of credit, rate limit, empty reply', async () => {
  for (const [status, pattern] of [[401, /did not accept the API key/], [402, /out of credit/], [429, /too many requests/], [500, /OpenRouter error 500/]]) {
    await assert.rejects(callOpenRouter({ system: 's', user: 'u' }, { apiKey: FAKE_KEY, model: 'm', fetchFn: fakeFetch(status, { error: { message: 'x' } }) }), pattern);
  }
  await assert.rejects(callOpenRouter({ system: 's', user: 'u' }, { apiKey: FAKE_KEY, model: 'm', fetchFn: fakeFetch(200, { choices: [] }) }), /empty answer/);
});

test('error messages never contain the key', async () => {
  for (const status of [400, 401, 402, 404, 429, 500]) {
    const err = await callOpenRouter({ system: 's', user: 'u' }, { apiKey: FAKE_KEY, model: 'm', fetchFn: fakeFetch(status, { error: { message: 'boom' } }) }).catch((e) => e);
    assert.ok(!err.message.includes(FAKE_KEY), `status ${status}`);
  }
  const netErr = await callOpenRouter({ system: 's', user: 'u' }, { apiKey: FAKE_KEY, model: 'm', fetchFn: async () => { throw new TypeError(`fetch failed ${FAKE_KEY}`); } }).catch((e) => e);
  assert.equal(netErr.message, 'Could not reach OpenRouter.');
});

test('the JSON schema matches section 6: five fields, all required, nothing extra', () => {
  assert.deepEqual(Object.keys(RESPONSE_SCHEMA.properties), ['verdict', 'headline', 'prescription', 'reason', 'extra_tip']);
  assert.deepEqual(RESPONSE_SCHEMA.required, ['verdict', 'headline', 'prescription', 'reason', 'extra_tip']);
  assert.equal(RESPONSE_SCHEMA.additionalProperties, false);
});

test('a retry shows the AI its rejected answer and what was wrong', async () => {
  const f = fakeFetch(200, okBody);
  await callOpenRouter({ system: 'S', user: 'U', retry: { previous: '{"verdict":"KEEP"}', problems: ['strides are only allowed on a run, on a great day'] } }, { apiKey: FAKE_KEY, model: 'm', fetchFn: f });
  const msgs = f.calls[0].body.messages;
  assert.deepEqual(msgs.map((m) => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(msgs[2].content, '{"verdict":"KEEP"}');
  assert.match(msgs[3].content, /broke these rules: strides are only allowed on a run, on a great day/);
});

test('the first try has just the system prompt and the message', async () => {
  const f = fakeFetch(200, okBody);
  await callOpenRouter({ system: 'S', user: 'U' }, { apiKey: FAKE_KEY, model: 'm', fetchFn: f });
  assert.equal(f.calls[0].body.messages.length, 2);
});
