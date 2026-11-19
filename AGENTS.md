# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** CycleSync, a morning check-in web app. She taps how she feels and what workout she planned, and gets one recommendation (Keep / Adjust / Swap / Rest) from an AI, with safety rules checked in code first.
- **Primary user & core workflow:** See the living PRD in `docs/index.html`. Recommendation rules: `research/recommendation-spec.md`.
- **Tech stack:** Plain HTML/CSS/JS, Node.js 22+ server (no npm packages), local JSON data file, OpenRouter (Claude Haiku 5.5), PostHog.

### Project structure
- `public/`: what the browser sees. `index.html` (all screens), `app.js` (screens, sends answers to the server), `analytics.js` (the only file that talks to PostHog), `styles.css`.
- `server.js`: local-only server. Serves `public/` and sends `/api/<name>` to `api/<name>.js`.
- `api/`: one file per server action (Vercel format): `onboarding`, `context` (today's cycle day/phase), `checkin` (runs the pipeline), `response`, `period`, `config` (public PostHog key), `health`.
- `lib/`: the logic, each piece tested on its own.
  - `pipeline.js` runs the steps in order: `safety.js` (safety rules in code, before any AI call) → `cycle.js` (cycle day + estimated phase) → `prompt.js` + `ai.js` (OpenRouter call, tokens and cost) → `checks.js` (output checks, retry with feedback) → `mock-ai.js` (free mock coach and rule-based fallback) → `db.js` (save).
  - `checkin.js` and `profile.js` validate input.
  - `db.js` is the only file that reads or writes saved data.
- `data/`: `cyclesync-db.json`, the local health data. Ignored by Git, never committed.
- `tests/`: unit tests (`*.test.js`), the browser check (`browser-check.mjs`), the real-AI cases (`real-ai.mjs`).
- `research/`: evidence brief and recommendation spec (read before changing the recommendation flow).
- `docs/`: the Product Page / living PRD (GitHub Pages). `journal/`: build logs. `Plan.md`: the Build 2 plan.

### Setup
1. `git clone https://github.com/building-with-ai-f26/jjs10216-cyclesync.git && cd jjs10216-cyclesync`
2. Install Node.js 22 or newer. There's nothing else to install.
3. `cp .env.example .env`, then fill in what you have:
   - `OPENROUTER_API_KEY`: real AI. Leave it blank for the free mock coach.
   - `OPENROUTER_MODEL`: defaults to `anthropic/claude-haiku-5.5`.
   - `POSTHOG_KEY` / `POSTHOG_HOST`: analytics. Leave the key blank for none.
4. Local keys live only in `.env`, which Git ignores. Live keys live only in Vercel's settings. Never put either in code, commits, or a chat with a coding agent.
5. `npm run dev`, then open http://localhost:3000.

## 2. Commands
- **Install dependencies:** none. The app uses only what's built into Node.js 22+ (tested on Node 26). Copy `.env.example` to `.env` when you have keys.
- **Run locally:** `npm run dev`, then open http://localhost:3000 (restarts automatically when files change; Ctrl+C to stop)
- **Run deterministic tests:** `npm test` (fast, no browser; runs `tests/**/*.test.js`)
- **Run the browser check:** `npm run test:browser`
  - Clicks through the real app in headless Google Chrome at phone size: onboarding, the one-question-at-a-time check-in, heavy-flow and cramps follow-ups, the safety screen, the recommendation card and response buttons (mock AI), cycle context, "Update my cycle", and the period due/late prompt.
  - Also checks analytics: with no `POSTHOG_KEY` PostHog never loads; with a fake key, a stand-in PostHog served by Chrome (nothing goes online) records every event, and the check confirms only the funnel events, `source: "app"`, `workout_type` and `response` are sent.
  - Needs Google Chrome installed (set `CHROME_PATH` if it isn't in `/Applications`). No npm packages.
  - Uses its own server on port 3131 and a **temporary** data file, so `data/cyclesync-db.json` is never touched.
  - Prints PASS/FAIL per check and the folder where it saved screenshots.
  - **Run it after any change to `public/`**, and update `tests/browser-check.mjs` when screens or flows change.
- **Run the spec's cases 3–9 against the real AI (optional, costs about $0.002):** `npm run test:ai`
  - Needs `OPENROUTER_API_KEY` in `.env`; skips with a message if there's none. Uses a temporary data file. Never prints the key.
  - Prints each case's verdict, headline, prescription, whether it passed the section 7 checks, and the cost.
  - `npm test` and `npm run test:browser` always use the mock AI and never spend money.
- **Analytics:** set `POSTHOG_KEY` (and `POSTHOG_HOST`) in `.env` to turn on PostHog. With no key the app runs without analytics. `public/analytics.js` is the only file that talks to PostHog.
- **AI mode:** with `OPENROUTER_API_KEY` set, the app calls OpenRouter (`OPENROUTER_MODEL`). With no key, or `AI_MODE=mock`, it uses the free mock coach (`lib/mock-ai.js`).
- **Make an invite:** `npm run invite -- tester-N` prints a private link and one SQL `insert` line for Julia to run in Supabase (nicknames only; add `--local` for the local data file).
- **Run the Supabase security test:** `npm run test:security` tries to read and write every table with the publishable key and passes only if every attempt is refused (needs `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `.env`).
- **Run model evals:** `[Build 4]`

## 3. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
7. **Follow the research:** Before building or changing anything in the recommendation flow, read research/evidence-brief.md and research/recommendation-spec.md and follow them. Safety rules are implemented in code and override the AI.

## 4. Shipping
- **Live site:** https://jjs10216-cyclesync.vercel.app
- **How changes go live:** pushing to `main` deploys to Vercel automatically. A branch on its own only makes a preview link, so a change is live only after it's merged to `main`.
- **Undo a bad deploy:** in Vercel, open an older deployment and use "Promote" to put it back live.
- **Secret keys:** the live keys (Supabase secret key, live OpenRouter key) live only in Vercel's settings, never in `.env`, code, commits or chat.
- **Database changes:** written as SQL for Julia to review. Julia runs it herself in Supabase → SQL Editor.
- **Invites:** `npm run invite -- tester-N` prints a link and one `insert` line. Labels are nicknames only, never real names. Julia runs the `insert` line in the SQL Editor and sends the link privately.
- **Supabase pause:** the free project pauses after a quiet week. If the app stops working, restore it from the Supabase dashboard.

## 5. Ask Me First
Stop and ask before any of these:
- Anything that touches the live database or Supabase settings (any SQL, tables, grants, RLS)
- Adding or changing environment variables, or anything involving a key
- Deleting any data, local or live
- Adding an npm package or another outside service
- Changing the AI model, the AI instructions, the safety rules, or `research/` files
- Changing what PostHog records
- Pushing to `main` (that deploys to the live site)
- Anything that costs money (real AI runs beyond `npm run test:ai`)

## 6. Rules From Real Mistakes
- **Tests never touch real data.** *Nov 17: a new test wrote fake invites, profiles and check-ins into the real `data/cyclesync-db.json`.* Every test that saves data sets `CYCLESYNC_DB_FILE` to a temporary file **before** importing anything from `lib/` (use `await import(...)` inside `before()`). Don't remove the check in `lib/db-local.js` that refuses the real file during tests.
- **Hidden means hidden.** *Nov 10: the "Set today as day 1?" prompt showed on its own because a CSS `display: flex` rule overrode `hidden`.* Keep the global `[hidden] { display: none !important; }` rule in `styles.css`, show and hide things only with `hidden`, and add a browser-check step for any new prompt that should start hidden.
- **A new invite link always replaces the old saved one.** *Nov 19: after an invite was revoked, a phone kept the old account and showed "Could not reach the server" with the new link.* A `?code=` in the URL always wins over the saved code, and a refused invite must show its own clear message, never a network error.
