// OPTIONAL: runs the spec's seed cases 3-9 (research/recommendation-spec.md
// section 8) against the REAL AI, through the full pipeline (safety screen →
// AI → section 7 checks → retry → fallback). Costs real money (well under a
// cent for all seven). Not part of `npm test`.
//
//   npm run test:ai
//
// Needs OPENROUTER_API_KEY in .env. Uses a TEMPORARY data file, so
// data/cyclesync-db.json is never touched. Never prints the key.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.OPENROUTER_API_KEY || process.env.AI_MODE === 'mock') {
  console.log('Skipped: no OPENROUTER_API_KEY in .env (or AI_MODE=mock). Nothing was sent.');
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'cyclesync-real-ai-'));
process.env.CYCLESYNC_DB_FILE = join(dir, 'db.json');
const { runCheckin } = await import('../lib/pipeline.js');
const { getCheckin } = await import('../lib/db.js');

const userId = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const natural = (cycleDay) => ({
  lastPeriodStart: daysAgo(cycleDay - 1), cycleLength: 28, contraception: 'no',
  patterns: { energyLowerBeforePeriod: 'sometimes', crampsAffectWorkouts: 'sometimes' },
  workoutDays: ['mon', 'wed', 'sat'], goal: 'stay_consistent',
});
const tempo = { type: 'run', amount: 5, unit: 'miles', kind: 'tempo' };
const base = { workout: tempo, energy: 3, sleep: 'ok', symptoms: ['none'], soreness: null };

// Each case: the spec's input, and a simple check of the spec's "Expected" column.
const CASES = [
  {
    n: 3, label: 'Cramps, energy 3, planned 5-mile tempo', profile: natural(2),
    checkin: { ...base, symptoms: ['cramps'], crampsUnusual: false },
    expect: 'SWAP or ADJUST to a gentle option; rest offered; no hard session',
    // Gentle = no effort above 5/10 anywhere in the prescription.
    ok: (r, text) => ['SWAP', 'ADJUST', 'REST'].includes(r.verdict) && /rest/i.test(text) && !/effort (?:[6-9]|10)\b/i.test(r.prescription),
  },
  {
    n: 4, label: 'Energy 5, good sleep, no symptoms, planned tempo', profile: natural(10),
    checkin: { ...base, energy: 5, sleep: 'good' },
    expect: 'KEEP with encouragement or a small optional add',
    ok: (r) => r.verdict === 'KEEP',
  },
  {
    n: 5, label: 'Energy 5 but poor sleep, planned tempo', profile: natural(10),
    checkin: { ...base, energy: 5, sleep: 'poor' },
    expect: 'No increase',
    ok: (r) => r.verdict !== 'KEEP' || !/strides|extra|add (a|an|\d)/i.test(r.prescription),
  },
  {
    n: 6, label: 'Energy 2, poor sleep, heavy lower-body lifting', profile: natural(10),
    checkin: { ...base, workout: { type: 'strength', focus: 'lower', load: 'heavy' }, energy: 2, sleep: 'poor' },
    expect: 'ADJUST lighter or SWAP to mobility, with numbers',
    ok: (r) => ['ADJUST', 'SWAP'].includes(r.verdict),
  },
  {
    n: 7, label: 'Estimated luteal, energy 4, planned 10-mile long run (the app has no "hot day" input yet)', profile: natural(20),
    checkin: { ...base, workout: { type: 'run', amount: 10, unit: 'miles', kind: 'long' }, energy: 4, sleep: 'good' },
    expect: 'KEEP or ADJUST plus a hydration tip; no phase-performance claim',
    ok: (r, text) => ['KEEP', 'ADJUST'].includes(r.verdict) && /hydrat|water|drink|fluid/i.test(text),
  },
  {
    n: 8, label: 'Estimated follicular, energy 2, planned tempo', profile: natural(8),
    checkin: { ...base, energy: 2 },
    expect: 'Driven by low energy, not "follicular means push"',
    ok: (r, text) => r.verdict !== 'KEEP' && !/follicular/i.test(text),
  },
  {
    n: 9, label: 'On hormonal contraception, energy 3, planned tempo', profile: { ...natural(10), contraception: 'yes' },
    checkin: base,
    expect: 'No phase label, no phase in the reasoning',
    ok: (r, text) => !/phase|follicular|luteal|menstrual/i.test(text),
  },
];

let totalCost = 0;
let passedChecks = 0;
let matched = 0;
console.log(`Model: ${process.env.OPENROUTER_MODEL || 'anthropic/claude-haiku-5.5'}\n`);

try {
  for (const c of CASES) {
    const out = await runCheckin({ userId, profile: c.profile, checkin: c.checkin, today });
    const saved = await getCheckin(out.checkinId);
    const r = out.recommendation;
    totalCost += saved.usage.cost;
    const passed = saved.source === 'ai';
    const text = [r.headline, r.prescription, r.reason, r.extra_tip].filter(Boolean).join(' ');
    const meets = passed && c.ok(r, text);
    if (passed) passedChecks++;
    if (meets) matched++;

    console.log(`Case ${c.n}: ${c.label}`);
    console.log(`  Spec expects:   ${c.expect}`);
    if (passed) {
      console.log(`  Verdict:        ${r.verdict}`);
      console.log(`  Headline:       ${r.headline}`);
      console.log(`  Prescription:   ${r.prescription}`);
      console.log(`  Reason:         ${r.reason}`);
      if (r.extra_tip) console.log(`  Tip:            ${r.extra_tip}`);
    } else {
      console.log(saved.source === 'mock-fallback'
        ? `  → Mock coach card shown instead (mock-fallback): ${r.verdict} · ${r.headline}`
        : `  → Generic safe fallback shown: "${r.headline}"`);
    }
    console.log(`  Section 7 checks: ${passed ? `PASSED${saved.attempts > 1 ? ' (on the retry)' : ' (first try)'}` : 'FAILED twice → fallback'}`);
    for (const [i, f] of (saved.failures ?? []).entries()) console.log(`    attempt ${i + 1} problem: ${f.join('; ')}`);
    for (const [i, rej] of (saved.rejected ?? []).entries()) {
      const p = (() => { try { return JSON.parse(rej.text).prescription; } catch { return rej.text; } })();
      console.log(`    rejected answer ${i + 1} prescription: ${p}`);
    }
    console.log(`  Matches the spec's expectation: ${meets ? 'yes' : 'NO, look at this one'}`);
    console.log(`  Cost: $${saved.usage.cost.toFixed(6)} (${saved.usage.tokensIn} tokens in, ${saved.usage.tokensOut} out)\n`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`Passed the section 7 checks: ${passedChecks} of ${CASES.length}`);
console.log(`Matched the spec's expectation: ${matched} of ${CASES.length}`);
console.log(`Total cost: $${totalCost.toFixed(6)}  (average $${(totalCost / CASES.length).toFixed(6)} per check-in)`);
