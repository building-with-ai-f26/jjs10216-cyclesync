// The only file that talks to the AI.
//
// Build 2, step 6: MOCK ONLY. Every call returns the mock coach's answer
// (lib/mock-ai.js) as JSON text, exactly the way the real AI will reply,
// so the output checks see the same thing either way. No API call, $0.
// Step 7 adds the real OpenRouter call here, used when OPENROUTER_API_KEY is
// set in .env and AI_MODE isn't "mock".
//
// Returns { text, model, usage: { tokensIn, tokensOut, cost } }.

import { mockRecommendation } from './mock-ai.js';

export async function getRecommendation({ system, user, context }) {
  return {
    text: JSON.stringify(mockRecommendation(context)),
    model: 'mock',
    usage: { tokensIn: 0, tokensOut: 0, cost: 0 },
  };
}
