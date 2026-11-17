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
│   ├── mock-ai.js      # Rule-based pretend coach for mock mode ($0); same JSON as the real AI
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

---

# Build 3 Plan: live for friend testers

**Due:** Monday, Nov 23, 2026 (Beginner lane)
**Status:** Plan only. Waiting for Julia's approval before any code.
**Goal:** Friends open a personal invite link on their phone, do real check-ins on the live Vercel site, and their data is saved in Supabase. Only our server can read or write that data. A security audit (SECURITY.md) shows it was checked.

This replaces the Upstash suggestion in section 2b: we're using **Supabase** instead.

**Who does what:** 🙋 = Julia does it herself (accounts, keys, dashboards, pasting SQL). 🤖 = the coding agent. Agents never see, handle or paste keys.

**Not in Build 3:** full sign-in, the spec's §3 Build 3 notes (iron check, long cycles), and the §9 post-workout question. They wait for a later build so this week stays focused on going live safely.

## B3-1. Facts checked (Nov 17, 2026)

**Vercel free (Hobby) plan time limit:** functions run for up to **300 s** (5 minutes). That's the default and also the maximum, with Fluid compute, which is on by default for new projects. Our slowest possible check-in is the first AI call (30 s timeout in `lib/ai.js`) + one retry (30 s) + a few database calls (under 2 s each) ≈ **65 s**. That fits with plenty of room. 🙋 Confirm Fluid compute is on (Project → Settings → Functions). Without it, older projects had a much shorter limit.
- `api/*.js` already use Vercel's format: `export async function POST(request)` returning a `Response`. `package.json` has `"type": "module"`. Vercel serves `public/` as the static site. `server.js` isn't used there.

**Supabase keys:**
- The **secret key** (`sb_secret_…`) is for servers only. It uses the `service_role` database role, which **skips Row Level Security (RLS)**. Supabase also rejects it with an error if it's sent from a browser.
- The **publishable key** (`sb_publishable_…`) uses the `anon` role. It's meant to be public, so RLS and table permissions are the only things protecting data from it.
- Keys go in the `apikey` header. We call Supabase's REST API with plain `fetch`, so **still zero npm packages**.
- Old-style keys (`anon` and `service_role`, the long ones starting with `eyJ`) keep working until they're disabled. 🙋 Disable them (Settings → API Keys) so only the new keys work.
- **The free plan pauses a project after about a week with no activity.** Daily check-ins keep it awake. If it pauses, the restore button is on the Supabase dashboard.

**Julia's Supabase settings, already done:** Data API on, automatic RLS on, "Automatically expose new tables" **off**. That means a new table is invisible to the API until the SQL grants access. The SQL grants access to `service_role` only and **nothing** to `anon` or `authenticated`.

## B3-2. How it fits together

```
Phone browser ──► Vercel (public/ + api/*.js) ──► Supabase (secret key, server only)
   │                     │
   │                     └──► OpenRouter (separate live key, small credit limit)
   └──► PostHog (public key; no invite code, no health answers)
```

- **Locally nothing changes:** with no Supabase variables, `lib/db.js` keeps using `data/cyclesync-db.json`. The secret key is **never** put in the local `.env`. It lives only in Vercel's environment settings.
- `lib/db.js` stays the only file that touches data. It picks Supabase when `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are set, and the JSON file otherwise. **On Vercel without those keys it stops with a clear error** instead of trying to write a file (Vercel can't keep files).

## B3-3. Database (SQL I write, Julia pastes into the SQL Editor)

Four tables, kept close to the shape of the local JSON file:

| Table | What it holds |
| --- | --- |
| `invites` | One row per friend: `id`, `code_hash` (SHA-256 of the code, so the code itself isn't stored), `label` (a nickname Julia picks, e.g. "tester-3", no real names), `created_at`, `revoked_at` |
| `profiles` | `user_id` (the anonymous browser ID), `invite_id`, onboarding answers (`jsonb`), timestamps |
| `checkins` | `id` (uuid), `user_id`, `invite_id`, check-in, cycle, safety result or recommendation, model, tokens, cost (`jsonb` and columns), `response`, timestamps |
| `ai_calls` | One row per AI check-in attempt: `id` (uuid), `invite_id`, `created_at`. Used by the rate limit. |

On **every** table:
1. `alter table … enable row level security;` with **no policies**. No policy means `anon` and `authenticated` can do nothing, even if a grant slips through.
2. `revoke all on … from anon, authenticated, public;`
3. `grant select, insert, update, delete on … to service_role;`
4. IDs use `gen_random_uuid()`, so there are no sequences to grant.

**The rate-limit function** `take_ai_slot(invite_id)` runs in one transaction. It locks that invite's row, counts its recent `ai_calls`, and inserts a new row only if the count is under the limit. Because the count and the insert happen together, 30 calls arriving at once can't all pass. Postgres lets **everyone** run new functions by default, so the SQL also runs `revoke execute … from public, anon, authenticated` and `grant execute … to service_role`.

The SQL lives in `supabase/schema.sql` (committed, with no keys in it). It's safe to run twice and has comments explaining each part.

## B3-4. Invite links (no full sign-in)

- **Making codes:** `npm run invite -- tester-3` runs a small local script. It prints (a) a random code (128-bit, URL-safe), (b) the link `https://<app>.vercel.app/?code=…`, and (c) one SQL `insert` line with the code's hash. 🙋 Julia pastes that line into the SQL Editor and sends the link privately. The script needs no keys.
- **In the browser:** the first thing on the page, before `analytics.js` loads, is a small script that reads `?code=`, saves it in `localStorage`, and removes it from the address bar with `history.replaceState`. PostHog therefore never sees it in the page URL. As a second layer, `cleanEvent` in `analytics.js` deletes any `code=` from `$current_url`, `$referrer` and similar URL properties. `Referrer-Policy: no-referrer` is set too.
- **On the server:** every `/api/*` call except `health` and `config` sends the code in a header. The server hashes it, looks it up, and refuses with **401** if it's missing, unknown or revoked. The screen says: "This app is invite-only. Please use your personal link."
- **Tying data to a person:** a profile is tied to the invite that created it, and later calls must use the same invite. Someone who learns another person's browser ID still can't read or change their data without that person's code.
- **Locally:** `data/cyclesync-db.json` gets an `invites` list. `npm run invite -- --local dev` adds one, so local testing goes through the same flow. The browser check sets up its own code in its temporary file.

## B3-5. Rate limit and AI spending

- **Limit per invite:** at most **5 AI check-ins per 10 minutes** and **20 per day**. A normal day is 1–2. Over the limit the server answers **429** with "You've checked in a lot just now. Try again in a few minutes." and **no AI call is made.** Safety-screen check-ins never reach the AI, so they don't count.
- **Limit for the whole app:** at most **300 AI calls per day** across all invites, as a backstop.
- **Test:** a test fires 30 check-ins at once and expects at most 5 to succeed and the rest to get 429. It runs against the local JSON version in `npm test`, and against the live site in step 9 (in mock mode, so it's free).
- 🙋 **A separate OpenRouter key for the live app**, named "cyclesync-live", with a **$2 credit limit** and training on your data turned off. It goes only in Vercel. The laptop key stays separate, so either one can be deleted without breaking the other.

## B3-6. Privacy note (in the app)

A short "About your data" link on the welcome screen and in the footer:
- **What's collected:** onboarding answers (cycle dates and length, contraception yes/no, patterns, workout days, goal), daily check-ins, the recommendation, and which button you tapped. No name, email or account. You're identified by a random ID and your invite.
- **Analytics:** PostHog records page visits, button clicks and screen recordings, but **health answers and the recommendation card are hidden** and never sent.
- **Where it's stored:** Supabase (a hosted database) in the US. Only the app's server can read it.
- **Deleting it:** all data is deleted when the semester ends (by Dec 31, 2026). To delete yours sooner, message Julia.
- 🙋 Julia approves the exact wording, and picks the Supabase region when creating the project.

## B3-7. Security audit (SECURITY.md)

- **The 7 checks from class:** 🙋 **Julia, please paste the class's list of 7 checks.** It isn't in the repo, and I don't want to guess the wording. For each check, SECURITY.md records the check, how it was tested, the result (pass/fail with evidence), and any fix.
- **Required security test (no sign-in, saves data):** `npm run test:security` calls the Supabase REST API directly with the **publishable** key (public by design, so it's OK in the local `.env`; the secret key is not). For every table it tries to read, add, change and delete rows, and to run `take_ai_slot`. **It passes only if every attempt is refused** (401/403 or "permission denied"). It also tries the same with no key at all.
- **Live API checks**, recorded in SECURITY.md:
  - no code → 401
  - wrong or revoked code → 401
  - another person's browser ID with your code → refused
  - 30 rapid check-ins → 429s
  - a search of the page source and the Git history finds no keys
- **Other items:** security headers via `vercel.json` (`Referrer-Policy`, `X-Content-Type-Options`, a `Content-Security-Policy` that allows only our own files and PostHog), the old Supabase keys disabled, and the OpenRouter credit limit set.

## B3-8. Build steps (in order)

Today is Tue Nov 17. Each 🤖 step is one small commit, with `npm test` (and `npm run test:browser` when `public/` changes) passing before the next.

| # | Step | Who | Time | How it's checked |
| --- | --- | --- | --- | --- |
| 0 | **Accounts, asked early:** Vercel account; ask an org owner to approve Vercel's GitHub app for `building-with-ai-f26` (fallback: deploy from the laptop with the Vercel command-line tool); Supabase project (pick the region); new OpenRouter key "cyclesync-live" ($2 limit, training off). Paste the 7 class checks into chat. | 🙋 | 45 min + waiting on approval | Accounts exist; nothing pasted into chat except the checklist |
| 1 | **Supabase SQL:** write `supabase/schema.sql` (B3-3). | 🤖 | 45 min | Reviewed by Julia line by line |
| 2 | **Run the SQL** in the SQL Editor; disable the old keys; copy the project URL + publishable key into local `.env`; check in Table Editor that RLS shows on for all 4 tables. | 🙋 | 15 min | Every table shows "RLS enabled" |
| 3 | **Security test first:** `tests/security-supabase.mjs` + `npm run test:security` (B3-7). Running it before the app uses Supabase proves the lock works on its own. | 🤖 | 45 min | Passes: every publishable-key attempt refused |
| 4 | **Invite codes:** invite script, saving the code and removing it from the URL, the header on API calls, server checks, tying profiles to invites, the "invite-only" screen; local `invites` list; tests and browser check updated. | 🤖 | 2 h | Unit tests (no code / bad code / wrong invite); browser check confirms the code is gone from the address bar and from every PostHog event |
| 5 | **Rate limit:** per-invite + whole-app limits in `db.js` (JSON locally, `take_ai_slot` live), 429 message on the screen. | 🤖 | 1 h | The 30-at-once test passes; the 429 message shows in the browser check |
| 6 | **Supabase in `lib/db.js`** behind the same functions; the "no keys on Vercel" error; `.env.example` gets `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (for the security test only) and a comment that the secret key belongs only in Vercel. | 🤖 | 1.5 h | `db.test.js` runs the same tests against the JSON file and against a fake Supabase server (no network) |
| 7 | **Privacy note + `vercel.json`** (headers). | 🤖 | 45 min | Browser check opens and closes the note; Julia approves the wording |
| 8 | **Deploy:** connect the repo in Vercel; add environment variables (`OPENROUTER_API_KEY` live key, `OPENROUTER_MODEL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `POSTHOG_KEY`, `POSTHOG_HOST`); confirm Fluid compute is on; deploy. In PostHog, add the Vercel domain to the authorized/replay domains. | 🙋 (🤖 walks through it) | 45 min | `/api/health` answers on the live URL |
| 9 | **Live checks:** make Julia's own invite; full check-in on her phone; row appears in Supabase; PostHog shows the funnel events with `source: "app"` and a replay with health areas blank; run the live API checks (B3-7), including 30 rapid calls with `AI_MODE=mock` set briefly in Vercel. | 🙋 + 🤖 | 1 h | Each result recorded in SECURITY.md |
| 10 | **SECURITY.md:** the 7 class checks + results from steps 3 and 9. | 🤖 | 1 h | Every check has evidence |
| 11 | **AGENTS.md:** a Shipping section (how to deploy, where environment variables live, rollback with Vercel's "Promote" on an older deployment, Supabase pause); an "Ask me first" list (below); the rule from a real mistake (below); update Setup and Commands for invites and `test:security`. | 🤖 | 30 min | Julia reads it |
| 12 | **Invite friends:** one code per friend, sent privately; Product Page Build 3 log. | 🙋 | 30 min | First friend check-in shows up in Supabase and PostHog |

**Total:** about 9 h for the agent's steps and about 3.5 h for Julia's (plus waiting on the org approval). Aim to deploy (step 8) by **Fri Nov 20**, so the weekend is free for fixes and inviting friends.

## B3-9. AGENTS.md additions (drafts)

**Ask me first:**
- Deploying to production or changing Vercel/Supabase settings
- Any SQL, especially changing tables, grants or RLS, or deleting data
- Adding or changing environment variables, or anything involving a key
- Adding an npm package or another outside service
- Changing safety rules, the AI instructions, or `research/` files
- Anything that costs money (real AI runs beyond `npm run test:ai`)
- Changing what PostHog records

**Rule from a real mistake:** *The "Set today as day 1?" prompt showed up on its own because a CSS rule (`display: flex`) overrode the `hidden` attribute. Keep the global `[hidden] { display: none !important; }` rule in `styles.css`. Show or hide elements only with `hidden`, never by setting `display` in JavaScript. When adding a prompt that should start hidden, add a browser-check step that confirms it isn't visible.*

## B3-10. What could go wrong

| Risk | What we do |
| --- | --- |
| The org owner doesn't approve Vercel's GitHub app in time | Deploy from the laptop with the Vercel command-line tool (no repo access needed) |
| A grant is missed and the publishable key can read a table | The security test (step 3) catches it before any real data exists; RLS with no policies is a second lock |
| An invite link gets forwarded | Revoke that code (`revoked_at`) with one SQL line; the rate limit and the $2 cap limit the damage |
| The invite code leaks into PostHog | Removed from the URL before PostHog loads + stripped in `cleanEvent` + browser check |
| The Supabase project pauses after a quiet week | Restore it from the dashboard; noted in AGENTS.md Shipping |
| A slow AI call on a phone | Worst case about 65 s, well under the 300 s limit; the loading screen stays up |
