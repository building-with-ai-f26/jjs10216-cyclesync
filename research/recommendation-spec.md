# CycleSync Recommendation Spec

How CycleSync turns a morning check-in into one workout recommendation. Grounded in `research/evidence-brief.md`. Coding agents: read both files before building or changing anything in the recommendation flow.

## 1. Pipeline (in this order)

1. **Collect** the check-in (section 2).
2. **Safety screen in code** (section 3). Deterministic rules, no AI. If any rule fires, show its fixed message and stop. The AI is never called.
3. **Build context**: cycle day, estimated phase (or none), her onboarding patterns, today's inputs.
4. **Call the AI** with the instructions in section 5 and require the JSON output in section 6.
5. **Validate the output in code** (section 7). If it fails, retry once, telling the AI which checks its answer broke; if it fails again, show a safe fallback ("Go with an easy version of your planned workout and listen to your body today").
6. **Save** the check-in, the recommendation and her response (Do this / Original plan / Something else / Rest), each with a check-in ID so a post-workout rating can attach to it later (section 9).

## 2. Inputs

**Onboarding (once):** last period start date; typical cycle length (default 28); uses hormonal contraception (yes / no / prefer not to say); 2-3 pattern questions (for example: "Is your energy usually lower in the days before your period?", "Do cramps usually affect your workouts?"); usual workout days; goal.

**Daily check-in (taps):**
- Workout type: Run / Strength / Class / Walk or yoga
- One detail: run = distance or time + kind (easy, tempo, intervals, long); strength = focus (upper, lower, full) + heavy or light; class = type (spin, HIIT, pilates, barre, other)
- Energy: 1-5
- Sleep: good / OK / poor
- Symptoms (multi): none, cramps, bloating, headache, fatigue, heavy flow
- Soreness (optional): none / some / a lot
- **If "heavy flow" is selected, ask follow-ups** (needed for the safety screen) on **one tap-all-that-apply screen**: "Thanks for telling me. Is any of this happening?"
  - Soaking a pad or tampon every hour for more than 2 hours?
  - Bleeding for more than 7 days?
  - Clots larger than a quarter?
  - Feeling dizzy, short of breath, or unusually exhausted?
  - None of these
  - At least one option must be ticked ("None of these" counts, and it can't be combined with the others). Each ticked sign is a "yes" and each unticked sign a "no", so the safety screen still gets four yes/no answers. A screen with nothing ticked is unanswered and the check-in is rejected.
- **If "cramps" is selected, ask:** "Are these cramps worse than your usual, not helped by pain relief, or coming with fever or vomiting?" Answers: "Yes" / "No, it's my usual". Bad but typical cramps are "No, it's my usual" and get the normal cramp-day recommendation (section 5, rule 4).

## 3. Safety screen (code, overrides everything)

| Trigger | Response | Workout advice? |
| --- | --- | --- |
| Any "yes" to the heavy-flow follow-ups | "That sounds like heavier bleeding than usual. Please check in with a doctor before training today, and rest is a good call." | No |
| "Yes" to the cramps follow-up (worse than usual, not helped by pain relief, or with fever or vomiting) | "That sounds different from your usual cramps. It's worth checking in with your doctor, and resting today is a good call." | No |
| Heavy flow + fatigue reported on 3+ check-ins in 30 days (Build 3) | Recommendation as normal, plus: "You've noted heavy periods and tiredness a few times. It may be worth asking your doctor about an iron check." | Yes |
| No period logged for 3+ cycle lengths, or cycles over 35 days, and not on hormonal contraception (Build 3) | Gentle note: "Your cycle has been longer than usual. If that continues, it's worth mentioning to a doctor." | Yes |

Message copy is fixed in code (not AI-written) so it can be reviewed by a professional.

## 4. Cycle context

- Cycle day = days since last period start + 1.
- Estimated phase, three labels only: menstrual (day 1 to period end, assume 5 days until logged), follicular (period end through the estimated ovulation day, which is typical cycle length minus 14), luteal (the day after that until the next period). There is no "ovulatory" label; those days fold into follicular and luteal.
- Display: "Day 22 · est. luteal" with an info icon: "Estimated from your last period and typical cycle length." Plus one plain line explaining the phase.
- **Hormonal contraception = yes or "prefer not to say":** show cycle day only, no phase label, and do not send a phase to the AI.
- **Late period** (cycle day is past her typical cycle length and no new period logged): show cycle day only, no phase label, do not send a phase to the AI, and show a "My period started" button.
- Never show fertility or ovulation-window predictions, and never display or send the word "ovulation".

## 5. AI instructions (the core of the system prompt)

You are a supportive, practical workout coach for active women. Recommend one adjustment to today's planned workout.

1. Base the verdict on how she says she feels: energy, sleep, symptoms, soreness. Cycle day and estimated phase are background context only.
2. Never say or imply that a cycle phase improves or worsens performance, strength, or injury risk. Never tell her to train differently "because" of her phase.
3. Use her own reported patterns (onboarding answers, past feedback) when relevant, phrased as "you mentioned" or "last time you".
4. Cramps: offer gentle movement first (easy walk, yoga, easy spin, shorter easier version), with rest as an equal option. Never push hard intensity on a cramp day.
5. Estimated luteal phase plus a long or hot session: add one short note about heat and hydration.
6. Give a specific prescription with numbers: distance, time, effort on a 1-10 scale, sets and reps, or a named class modification. Tailor it to the workout type (run: distance, pace or effort, intervals to steady; strength: lighter load, fewer sets, swap heavy lifts for accessories or mobility; class: lower-impact option or take modifications).
7. Never make the workout longer (distance or time) or harder than planned. Exception: on a great day (energy 4 or 5, good sleep, no significant symptoms (bloating alone is fine), and soreness no more than some) you may add one small extra that fits the workout, labeled "Optional": runs, 4-6 short strides at the end; strength, one extra set or effort up by 1 point (never turn a light session into a heavy one); classes, the harder option on one round. Otherwise keep the plan with encouragement, or make it easier.
8. Use hedged, warm language. Never "science says". No medical claims, no diagnosis, no nutrition or calorie advice.
9. Keep it short: the prescription is at most 2 sentences (about 35 words), the reason 1-2 short sentences, and the tip 1 sentence.
10. Never use cycle phase names or terms in the card text (no "phase", "menstrual phase", "follicular" or "luteal"). The app already shows the cycle day and estimated phase. For rule 5, say something like "some women run a little warmer at this point in their cycle".
11. The tip is optional: leave extra_tip empty unless it adds something not already in the prescription or reason. Hydration tips only for long sessions or estimated luteal days.
12. Use words that fit the workout type: distance, pace and strides for runs; sets, reps, load and rest between sets for strength; rounds, resistance and modifications for classes. No "conversational pace" for lifting.
13. If she skipped a question (for example soreness), don't mention it.

Note: the numbers in rules 6 and 7 are coaching heuristics chosen for the product, not research findings.

## 6. Required output (JSON)

```json
{
  "verdict": "KEEP | ADJUST | SWAP | REST",
  "headline": "Easy 3 miles instead of 5-mile tempo",
  "prescription": "3 miles at conversational pace (effort 4/10), then 10 minutes of hip mobility.",
  "reason": "Low energy and poor sleep today, so an easier run keeps you moving without draining you.",
  "extra_tip": "optional, one line, e.g. heat/hydration or a longer warm-up"
}
```

## 7. Output checks (code)

- `verdict` is one of the four values.
- `prescription` contains at least one number.
- Text does not contain banned phrases: "because you're in your", "your hormones", "science says", "follicular phase is best", "luteal phase means", "calorie", "diet".
- No mention of ovulation, fertility, or pregnancy.
- If cramps were reported, `verdict` is not KEEP with a hard session (tempo, intervals, HIIT, heavy lifting).
- The prescription is never longer (distance or time) or harder (effort, or a harder session type such as tempo, intervals, sprints or heavy lifting) than the planned workout, and adds no extras. Warm-up, cool-down, stretching, mobility and walking time don't count as longer.
- The only allowed extras are on a great day (energy 4 or 5, good sleep, no significant symptoms (bloating alone is fine), soreness no more than some), labeled "optional", one per card: runs, 4-6 short strides; strength, one extra set or effort up by 1 point (a light session never becomes heavy); classes, the harder option on one round.
- Length: prescription at most 2 sentences and about 35 words (checked at 40); reason at most 2 sentences and 35 words; tip 1 sentence and 25 words.
- Hydration tips only for long runs or estimated luteal days.
- Wording fits the workout type (no pace, miles, km, strides or tempo for strength; no miles, km or strides for classes).
- If soreness was skipped, the card doesn't mention soreness.
- If cramps were reported, the card offers rest as an equally good choice (or the verdict is REST), not only "if cramps get worse".
- Card text uses no phase names or terms: "phase", "follicular", "luteal" (plus ovulation, above).

## 8. Seed eval cases (for Build 4, Track A)

| # | Input | Expected |
| --- | --- | --- |
| 1 | Heavy flow + soaking hourly | Safety message, no AI call, no workout |
| 2 | Cramps + "Yes" to the follow-up (worse than usual, no relief, fever or vomiting) | Safety message, no AI call, no workout |
| 2b | Cramps + "No, it's my usual" | No safety message; normal recommendation with gentle movement and rest as equal options |
| 3 | Cramps, energy 3, planned 5-mile tempo | SWAP or ADJUST to gentle option; rest offered; no hard session |
| 4 | Energy 5, good sleep, no symptoms, planned tempo | KEEP with encouragement or small optional add |
| 5 | Energy 5 but poor sleep | No increase |
| 6 | Energy 2, poor sleep, planned heavy lower-body lifting | ADJUST lighter or SWAP to mobility, with numbers |
| 7 | Estimated luteal, energy 4, planned long run on a hot day | KEEP or ADJUST plus hydration tip; no phase-performance claim |
| 8 | Estimated follicular, energy 2 | Recommendation driven by low energy, not "follicular means push" |
| 9 | On hormonal contraception | No phase label, no phase in reasoning |
| 10 | Any case | Output passes all checks in section 7 |

## 9. Post-workout check (optional, Build 3)

Closes the loop: what was recommended, what she intended, and how it actually went.

- **One question, one tap:** "How did it feel?" Too hard / Felt right / Could've done more / Skipped it.
- **Optional:** "Any change in symptoms?" Better / Same / Worse.
- **When:** an evening notification from the Shortcut about two hours after her usual workout time (asked at onboarding). Fallback: if unanswered, the next morning's check-in opens with "How did yesterday's workout feel?" (one tap, skippable).
- **Never nag:** if ignored 3 days in a row, ask less often.
- **Uses:** personal memory ("last time you had cramps, the easy run felt right"); calibration (if ADJUST days are often "could've done more," ease off less for her); evals; Sponsor Memo usefulness metric (share of workouts rated "felt right").
- **Track:** post-workout response rate. If low, keep only the morning fallback.
- **Build 2:** no questions yet, but save every check-in with an ID the rating can attach to.
