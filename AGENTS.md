# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** [1–2 sentence summary]
- **Primary user & core workflow:** [See the living PRD in `docs/index.html`]
- **Tech stack:** [e.g., Python 3.12 / FastAPI / Next.js / SQLite / OpenRouter API]

## 2. Commands
- **Install dependencies:** none. The app uses only what's built into Node.js 22+ (tested on Node 26). Copy `.env.example` to `.env` when you have keys.
- **Run locally:** `npm run dev`, then open http://localhost:3000 (restarts automatically when files change; Ctrl+C to stop)
- **Run deterministic tests:** `npm test` (fast, no browser; runs `tests/**/*.test.js`)
- **Run the browser check:** `npm run test:browser`
  - Clicks through the real app in headless Google Chrome at phone size: onboarding, the one-question-at-a-time check-in, heavy-flow and cramps follow-ups, cycle context, "Update my cycle", and the period due/late prompt.
  - Needs Google Chrome installed (set `CHROME_PATH` if it isn't in `/Applications`). No npm packages.
  - Uses its own server on port 3131 and a **temporary** data file, so `data/cyclesync-db.json` is never touched.
  - Prints PASS/FAIL per check and the folder where it saved screenshots.
  - **Run it after any change to `public/`**, and update `tests/browser-check.mjs` when screens or flows change.
- **Run model evals:** `[Build 4]`

## 3. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
7. **Follow the research:** Before building or changing anything in the recommendation flow, read research/evidence-brief.md and research/recommendation-spec.md and follow them. Safety rules are implemented in code and override the AI.
