# Plan.md — CycleSync Build 2 Plan

**Due:** Monday, Nov 16, 2026 at 12:00 PM (noon)
**Builder:** Julia Simon
**Status:** Approved plan. No app code written yet.

**Build 2 goal:** One full user action works locally on Julia's laptop with a real AI call:
onboarding + morning check-in → safety screen → AI recommendation card → her response saved.

**Next goal (Build 3, Nov 23):** friends using a hosted version so we can start measuring retention (see section 2b).

Everything in the recommendation flow follows `research/recommendation-spec.md` (section numbers below, "§", refer to that file) and `research/evidence-brief.md`.

---

## 1. Biggest risk for PRD v2

**Riskiest assumption:** The AI gives generic or unsafe advice instead of specific, safe, feelings-first recommendations.

**How Build 2 tests it:**
- **Safety:** the safety screen runs in code *before* any AI call. Automated tests cover every §3 trigger and confirm the AI is never called when one fires. Every AI answer also goes through the §7 output checks in code before she sees it.
- **Specific and feelings-first:** spec cases 3–9 (§8) are run by hand against the real AI in step 7. For each one we record whether the advice was specific (real numbers for distance, time, effort or sets), driven by how she feels rather than by phase, and safe.

The PRD v1 risk (women stop checking in after the first week) is still open. Build 3 starts testing it with friends.

---

## 2. Tech stack (plain English)

| Part | Choice | Why |
| --- | --- | --- |
| **Screens** | One web page written in plain HTML, CSS and JavaScript. It works in a phone browser. No React, no build step. | The fewest moving parts. You can open any file and read it. |
| **Server** | Node.js 26 (already installed). A small `server.js` file runs the app on your laptop at `http://localhost:3000`. | Node 26 has what we need built in: web requests, reading `.env`, and running tests. **We install zero npm packages.** |
| **Server logic** | Each action (save onboarding, run a check-in, save her response) is one file in `api/`, written in the format Vercel expects. | Vercel can run these files as they are. `server.js` is only for running on your laptop. |
| **AI** | OpenRouter, called directly with `fetch`. Model: `anthropic/claude-haiku-5.5`, set in `.env` so switching models needs no code change. | No SDK to learn. One file (`lib/ai.js`) talks to the AI. |
| **Mock AI mode** | If `.env` has no OpenRouter key (or `AI_MODE=mock`), the app returns a fixed sample recommendation instead of calling the AI. | You can build and test every screen before you have a key, at $0. |
| **Where data is saved (Build 2)** | One file on your laptop: `data/cyclesync-db.json`. It holds onboarding answers, check-ins, recommendations and responses, each check-in with its own ID. **It's ignored by Git, so health data never goes to GitHub.** | You can open it and see exactly what was saved. |
| **Who the user is** | No accounts and no names. The browser makes a random anonymous ID the first time and remembers it. | Matches the PRD: minimal health data, anonymous IDs. |
| **Analytics** | PostHog, in the **same project as the Product Page**. Health screens are hidden from replays, and no health values go into events (see step 8). | Required for Build 2. |
| **Tests** | Node's built-in test runner (`npm test`). | No extra install. |

### 2a. Keeping the storage swap simple

`lib/db.js` is the **only** file that reads or writes saved data. It has a short, fixed list of functions:

- `saveProfile(userId, profile)` and `getProfile(userId)`: onboarding answers
- `updatePeriodStart(userId, date)`: the "My period started" button
- `saveCheckin(checkin)`: saves the check-in, recommendation, model, tokens and cost under a new check-in ID
- `saveResponse(checkinId, response)`: attaches Do this / Original plan / Something else / Rest

In Build 2 these read and write the local JSON file. To go online, only the inside of these functions changes. Every other file calls them the same way.

### 2b. What deploying to Vercel with a hosted database would take (target: Build 3, Nov 23)

Vercel can't keep a data file between requests, so friends need a hosted database. Steps, roughly in order:

1. **Pick a hosted database.** Suggestion: **Upstash Redis**, added through Vercel's Marketplace. It has a free tier and is reached with plain `fetch` calls, so we still install zero packages. Each profile and check-in is stored as one JSON entry, the same shape as the local file. (Alternative: Supabase or Neon Postgres. More powerful, but more setup.) Check the current free-tier limits before choosing.
2. **Update `lib/db.js`** to use the hosted database when its keys are in the environment, and the local file otherwise. That way local development keeps working offline.
3. **Connect the GitHub repo to Vercel.** The repo belongs to the class organization (`building-with-ai-f26`), so Vercel's GitHub app may need an org owner (Christian or Hew) to approve access. **Ask early.** The fallback is deploying from your laptop with the Vercel command-line tool.
4. **Add environment variables in Vercel's dashboard:** OpenRouter key and model, PostHog key and host, and the database keys. They never go in code.
5. **Protect the public URL.** Anyone who finds it could run AI calls on your key. The $5 OpenRouter limit caps the damage. Also suggested: a simple invite code friends type once.
6. **Privacy for friends.** Their check-ins are now stored on a hosted service, not just your laptop. Before inviting them, add a short plain-language note in the app: what's collected, where it's stored, that it's anonymous, and how to ask for deletion.
7. **Check it works:** do a full check-in on your phone at the Vercel URL, confirm it's saved in the hosted database, and confirm PostHog events arrive with `source: "app"`.

Estimated effort: one session, with most of the risk in step 3 (org permissions).

---

## 3. Folder structure

New files go at the top level of the repo, next to the existing `docs/`, `research/`, `journal/` and `tests/` folders. That's the layout Vercel expects with no extra setup.

```
jjs10216-cyclesync/
├── package.json        # "npm run dev" and "npm test" shortcuts. No dependencies.
├── server.js           # Local-only: serves public/ and sends /api/* requests to api/ files
├── .env                # Your keys (never committed)
├── .env.example        # Placeholder copy of .env (committed)
├── public/             # What the browser sees
│   ├── index.html      # All screens: onboarding, check-in, follow-ups, result card
│   ├── styles.css
│   └── app.js          # Shows/hides screens, sends answers to the server, PostHog events
├── api/                # One file per server action (Vercel-ready)
│   ├── onboarding.js   # Save onboarding answers
│   ├── period.js       # "My period started"
│   ├── checkin.js      # Run the full pipeline (§1), return safety message or recommendation
│   ├── response.js     # Save "Do this / Original plan / Something else / Rest"
│   └── config.js       # Give the page the public PostHog key from .env
├── lib/                # The logic, each piece testable on its own
│   ├── safety.js       # §3 safety screen. Plain code, no AI.
│   ├── cycle.js        # §4 cycle day + estimated phase
│   ├── prompt.js       # §5 AI instructions (copied word for word) + builds the message
│   ├── ai.js           # Calls OpenRouter (or returns the mock); records tokens and cost
│   ├── checks.js       # §7 output checks
│   ├── pipeline.js     # §1 order: safety → context → AI → checks (retry once → fallback) → save
│   └── db.js           # The only file that reads/writes saved data (section 2a)
├── data/               # Ignored by Git. cyclesync-db.json lives here.
└── tests/
    ├── README.md       # (existing)
    ├── safety.test.js
    ├── checks.test.js
    ├── cycle.test.js
    └── pipeline.test.js
```

---

## 4. Build steps (in order, each tested before the next)

Each step is one small commit, per AGENTS.md.

| # | Step | How you test it |
| --- | --- | --- |
| 1 | **Skeleton:** `package.json`, `server.js`, a "Hello CycleSync" page, `.env.example` updated, `data/` added to `.gitignore`. | Run `npm run dev`, open `http://localhost:3000`, and see the page. |
| 2 | **Onboarding screen** (§2): last period start, typical cycle length (default 28), hormonal contraception (yes / no / prefer not to say), 2–3 pattern questions, usual workout days, goal. Saved through `api/onboarding.js` → `lib/db.js`. | Fill it in, then open `data/cyclesync-db.json` and see your answers under a random ID. |
| 3 | **Check-in screen** (§2): workout type + one detail, energy 1–5, sleep, symptoms (multi), optional soreness. Heavy-flow follow-ups appear only if "heavy flow" is tapped; the cramps follow-up (worse than usual / no relief / fever or vomiting) appears only if "cramps" is tapped. Plus a "My period started" button. | Tap through in a phone-sized browser; follow-ups appear and disappear correctly. |
| 4 | **Cycle day + estimated phase** (`lib/cycle.js`, §4) with automated tests. Three labels only: menstrual, follicular, luteal. No phase for hormonal contraception, "prefer not to say", or a late period. | `npm test` passes; the screen shows e.g. "Day 22 · est. luteal", or "Day 34" plus the "My period started" button when late. |
| 5 | **Safety screen** (`lib/safety.js`, §3) with automated tests, wired to show the fixed safety message. | `npm test` passes; tapping heavy flow + "soaking hourly" shows the doctor message, no workout. |
| 6 | **Mock AI + full pipeline + output checks** (`lib/ai.js` mock, `lib/checks.js`, `lib/pipeline.js`), the recommendation card (verdict, headline, prescription, reason, optional tip, cycle day/phase), and the four response buttons. Every check-in saved with an ID; the response is attached to it. | `npm test` passes; full flow works in mock mode; the data file shows the check-in, recommendation and response linked by one ID. |
| 7 | **Real AI call** via OpenRouter: §5 instructions, §6 JSON output (asked for in a strict JSON format), §7 checks, retry once, then the §1 safe fallback. Tokens and cost saved with each check-in. | Add your key to `.env`, run spec cases 3–9 by hand, and record for each: specific? feelings-first? safe? checks passed? cost? |
| 8 | **PostHog in the app** (details below), plus adding `source: "product_page"` to the Product Page's existing PostHog setup. | Do a check-in, then watch its replay: health answers and the card show as hidden blocks. In PostHog's event list, confirm only the allowed properties appear and that every event has `source`. |
| 9 | **Docs:** AGENTS.md (project overview, structure, setup and run commands), the Build 2 log and PRD v2 on `docs/index.html`. | Follow the AGENTS.md setup steps from scratch in a fresh clone. |

### PostHog details (step 8)

**Same project as the Product Page.** Every event gets a `source` property so the two can be told apart:
- Product Page: `source: "product_page"`, added with one line (`posthog.register(...)`) after its existing `posthog.init`.
- App: `source: "app"`, added the same way.

**Automatic tracking:** pageviews, clicks and session replay stay on.

**Funnel events (app only).** The only properties allowed are `source`, `workout_type` (Run / Strength / Class / Walk or yoga) and `response`:

| Event | Properties |
| --- | --- |
| `checkin_started` | `source` |
| `checkin_completed` | `source`, `workout_type` |
| `result_shown` | `source`, `workout_type` |
| `response_tapped` | `source`, `workout_type`, `response` (do_this / original_plan / something_else / rest) |

`result_shown` fires the same way whether the result is a recommendation or a safety message, and never includes the verdict.

**Hiding health data:**
- Every element showing health information (onboarding cycle questions, check-in answers, follow-ups, the result card and safety messages) gets PostHog's `ph-no-capture` class. Replays show a blank box instead, and automatic click tracking ignores those elements, so button labels like "Cramps" never reach PostHog.
- Text-input masking (`maskAllInputs`) stays on, which covers the date field and any typed fields.
- The PostHog key comes from `.env` through `api/config.js`, not hardcoded in the app.

**Known limitation:** safety messages have no response buttons. So a person who has `result_shown` but no `response_tapped` *may* have seen a safety message. Many people will also just close the app at that point, so the two can't be told apart. We accept this.

---

## 5. How the safety screen and output checks are tested

All of these are automated (`npm test`) and run in mock mode, so they cost nothing.

**Safety screen (`tests/safety.test.js`, `tests/pipeline.test.js`):**
- One test per §3 trigger: each of the 4 heavy-flow follow-ups answered "yes" → heavy-bleeding message; cramps follow-up "Yes" → unusual-cramps message; "No, it's my usual" → no safety message.
- Messages match the §3 wording exactly (copy is fixed in code).
- Normal check-ins, and heavy flow with all follow-ups "no", → no safety message.
- **"The AI is never called" is tested directly:** the pipeline test passes in a fake AI that records whether it was called, and asserts it wasn't for every safety case (§8 cases 1–2).
- The two Build 3 rules in §3 (iron check after repeated heavy flow + fatigue; long cycles) are **not** in Build 2, as the spec says.

**Output checks (`tests/checks.test.js`):** for each §7 rule, one answer that passes and one that fails:
- verdict not one of KEEP / ADJUST / SWAP / REST → fail
- prescription with no number → fail
- each banned phrase ("because you're in your", "your hormones", "science says", "follicular phase is best", "luteal phase means", "calorie", "diet") → fail, regardless of capitals
- any mention of ovulation, fertility or pregnancy → fail
- cramps reported + KEEP + a hard planned session (tempo, intervals, HIIT, heavy lifting) → fail

**Retry and fallback (`tests/pipeline.test.js`):** a fake AI that fails the checks once and then passes → one retry, a good card. A fake AI that fails twice → the exact §1 fallback message.

**Cycle (`tests/cycle.test.js`):** day 1, last period day, last follicular day (cycle length − 14), first luteal day, day before the next period, 21-day and 35-day cycles, hormonal contraception and "prefer not to say" (no phase), late period (no phase), and that the word "ovulation" never appears in any output.

**Manual checks:** step 7 runs §8 cases 3–9 against the real AI (section 1). The full 10-case eval is Build 4 (Track A), if you choose that track.

---

## 6. Cost per check-in

**How we'll measure it:** OpenRouter returns the exact tokens in, tokens out and cost with every AI response. `lib/ai.js` saves those numbers with each check-in. After a few real check-ins we use the real average for the "Est. Cost Per User Run" box on the Product Page.

**Estimate before measuring:**
- Tokens in: about 1,000–1,300 (the §5 instructions ≈ 700, plus her onboarding patterns, today's answers and cycle context ≈ 300–500, plus the JSON format).
- Tokens out: about 150–250 (the §6 JSON card).
- A retry (when the first answer fails a check) roughly doubles the cost of that check-in. Safety-screen check-ins cost $0, since the AI isn't called.

**Model: `anthropic/claude-haiku-5.5`** (chosen). OpenRouter lists it at **$0.10 per million tokens in** and **$0.50 per million tokens out** (checked Nov 10, 2026), and it supports strict JSON output.

| Model | Cost per check-in (1,200 in / 200 out) | 1,000 check-ins |
| --- | --- | --- |
| **Claude Haiku 5.5** ($0.10 / $0.50 per M), *chosen* | ≈ $0.0002 | ≈ $0.22 |
| Claude Sonnet 5.5 ($2 / $10 per M), backup if Haiku's advice feels generic | ≈ $0.0044 | ≈ $4.40 |

If Haiku's prescriptions feel generic in step 7, try Sonnet 5.5 by changing one line in `.env`, then compare.

**Budget:**

| Item | Estimate | Notes |
| :--- | :--- | :--- |
| Build budget (OpenRouter) | under $1 for Build 2 | Mock mode for most of the build; real calls only in step 7. Key capped at $5. |
| Unit cost per check-in | ≈ $0.0002 (Haiku 5.5) | To be replaced by the measured average |
| Hosting | $0 / mo in Build 2 | Vercel and Upstash free tiers expected for Build 3; confirm limits then |
| Engineering time | TODO | |

---

## 7. Security & recovery checklist
- [x] `.env` is excluded by `.gitignore` (already in the template)
- [ ] `data/` (local health data) added to `.gitignore` in step 1
- [ ] OpenRouter key spending limit set to $5
- [ ] OpenRouter privacy setting: training on your data turned off
- [ ] Health fields hidden in PostHog replays and left out of events, checked by watching a replay
- [ ] One Git commit per step, so any broken step can be undone; cloud rollback when deployed

---

## 8. Decisions made (Nov 10, 2026)

1. **Stack:** plain HTML/JS + a small Node server, zero npm packages, local data file. Hosted version for friends targeted for Build 3 (Nov 23), not Build 5.
2. **PostHog:** same project as the Product Page; every event has a `source` property (`product_page` or `app`).
3. **Phases:** only menstrual, follicular and luteal; ovulatory days are folded in. Spec §4 updated to match.
4. **Late period:** show cycle day, no phase, plus a "My period started" button.
5. **Hormonal contraception "prefer not to say":** no phase, same as "yes".
6. **OpenRouter:** Claude Haiku 5.5, $5 spending limit, training on your data turned off.
7. **Funnel events:** started, completed, result shown, response tapped; only `workout_type` and `response` as extra properties. No verdict, nothing that hints at a safety message.
