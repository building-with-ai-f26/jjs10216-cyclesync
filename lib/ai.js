// The only file that talks to the AI.
//
// - Real AI: OpenRouter, called with plain fetch (no packages). The model comes
//   from OPENROUTER_MODEL in .env (anthropic/claude-haiku-5.5).
// - Mock AI (lib/mock-ai.js): used when there's no OPENROUTER_API_KEY, or when
//   AI_MODE=mock. Costs nothing.
//
// The API key is read from the environment on each call and only ever goes in
// the Authorization header. It is never logged, saved, or put in an error message.
//
// Returns { text, model, usage: { tokensIn, tokensOut, cost } }. `text` is the
// AI's raw reply; lib/checks.js reads and checks it either way.

import { mockRecommendation } from './mock-ai.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-haiku-5.5';
const TIMEOUT_MS = 30_000;

// The section 6 JSON, as a schema OpenRouter passes on to the model.
// extra_tip is required here but may be an empty string (strict schemas
// need every field listed); lib/checks.js turns "" into "no tip".
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['KEEP', 'ADJUST', 'SWAP', 'REST'] },
    headline: { type: 'string', description: 'Short headline, e.g. "Easy 3 miles instead of 5-mile tempo"' },
    prescription: { type: 'string', description: 'Specific prescription with numbers (distance, time, effort 1-10, sets and reps)' },
    reason: { type: 'string', description: 'One or two sentences' },
    extra_tip: { type: 'string', description: 'Optional one-line tip, or an empty string' },
  },
  required: ['verdict', 'headline', 'prescription', 'reason', 'extra_tip'],
  additionalProperties: false,
};

export function aiMode(env = process.env) {
  if (env.AI_MODE === 'mock' || !env.OPENROUTER_API_KEY) return 'mock';
  return 'live';
}

export async function getRecommendation({ system, user, context }, { env = process.env, fetchFn = fetch } = {}) {
  if (aiMode(env) === 'mock') {
    return {
      text: JSON.stringify(mockRecommendation(context)),
      model: 'mock',
      usage: { tokensIn: 0, tokensOut: 0, cost: 0 },
    };
  }
  return callOpenRouter({ system, user }, { apiKey: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL || DEFAULT_MODEL, fetchFn });
}

export async function callOpenRouter({ system, user }, { apiKey, model, fetchFn = fetch }) {
  let res;
  try {
    res = await fetchFn(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'CycleSync',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'workout_recommendation', strict: true, schema: RESPONSE_SCHEMA },
        },
        // Only use providers that support the JSON format above.
        provider: { require_parameters: true },
        // A short, simple task: light reasoning keeps it fast and cheap.
        reasoning: { effort: 'low' },
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(err.name === 'TimeoutError' ? 'OpenRouter took too long to answer.' : 'Could not reach OpenRouter.');
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // handled below
  }

  if (!res.ok || data?.error) {
    throw new Error(describeError(res.status, data?.error?.message));
  }

  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('OpenRouter sent an empty answer.');

  return {
    text,
    model: data.model || model,
    usage: {
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
      cost: data.usage?.cost ?? 0,
    },
  };
}

// Plain-language errors. OpenRouter's own message is kept (it never contains
// the key) so problems can be traced.
export function describeError(status, message = '') {
  if (/no endpoints found|no allowed providers|no available provider/i.test(message)) {
    return `No AI provider is available for this model with your OpenRouter settings (for example, the "no training on my data" setting or the JSON format rules out every provider). OpenRouter said: ${message}`;
  }
  if (status === 401) return 'OpenRouter did not accept the API key. Check OPENROUTER_API_KEY in .env.';
  if (status === 402) return 'OpenRouter says the account is out of credit or over its spending limit.';
  if (status === 429) return 'OpenRouter says too many requests. Try again in a minute.';
  return `OpenRouter error ${status}${message ? `: ${message}` : ''}`;
}
