# SECURITY.md — CycleSync security audit (Build 3)

*Work in progress: filled in step by step during Build 3 (see `Plan.md`, B3-7). Final version after the live checks (step 9).*

## My kind of app

- **No sign-in, but it saves data.** Friend testers open a personal invite link. The app remembers a random browser ID and their invite code. There are no names, emails or passwords.
- **The data is sensitive:** cycle dates, symptoms, and workout check-ins.
- **Where things run:**
  - **Dev:** laptop, `data/cyclesync-db.json`.
  - **Prod:** Vercel (`public/` + `api/`) and Supabase Postgres.
  - **AI:** OpenRouter.
  - **Analytics:** PostHog.
- **Only the app's server talks to the database**, using the Supabase secret key. That key lives only in Vercel's environment settings. The browser never talks to Supabase.

## What I checked

| # | Class check | How | Status |
| --- | --- | --- | --- |
| 1 | RLS on every table, with the test that fits the app | `supabase/schema.sql`: RLS on all 4 tables, no policies, no grants to `anon`/`authenticated`. `npm run test:security` uses the publishable key (and no key) to try to read, add, change and delete in every table and run `take_ai_slot`. Live-site console test + screenshot: step 9. | Database test passed Nov 17. Console test to do. |
| 2 | Secret keys stay on the server | Search the live site's files and the Git history for `sb_secret_`, `service_role`, `sk_` and the real keys | Passed Nov 17–18 (real key values: Julia to check locally) |
| 3 | Private storage, expiring links | No files are stored and there are no Supabase Storage buckets | Not applicable (confirm in step 9) |
| 4 | Production out of the agent's reach; backups | Dev and prod are separate. The agent has no Supabase or Vercel keys. Backups: see below | Partly. No backups on the free plan. |
| 5 | Spending caps | $2 cap on the live OpenRouter key + rate limit on the AI route | Rate limit passed live Nov 18. $2 cap: Julia to confirm |
| 6 | Dependencies | `npm audit`, fix anything rated high | Passed Nov 17: 0 vulnerabilities |
| 7 | Agent review: attack, then fix | `npm run test:live` (tests/live-check.mjs) against the live site + manual probing | Passed Nov 18 after one fix |

## What I found

- **Nov 17, `npm run test:security`:** all 34 attempts were refused. Supabase project settings: Data API on, automatic RLS on, "Automatically expose new tables" off.
  - With the publishable key, every read, add, change and delete on `invites`, `profiles`, `checkins` and `ai_calls` returned `401` with Postgres `42501` (permission denied). So did running `take_ai_slot`.
  - With no key, every attempt returned `401`.
- **Nov 17, SQL Editor:** all 4 tables show `rls_enabled = true`, and there are no grants to `anon`, `authenticated` or `PUBLIC`.
- **Nov 17:** the old JWT API keys (`anon` / `service_role`) are disabled.
- **Nov 17, backups:** Supabase's page says "Free Plan does not include project backups."

- **Nov 17, live site (check 2):**
  - **Served files:** none of the 7 files the site serves contains `sb_secret_`, `service_role`, `sb_publishable_`, `sk_`/`sk-or-`, an old-style JWT key, or the names `SUPABASE_`/`OPENROUTER_`. `/api/config` returns only the public PostHog key (`phc_…`) and host.
  - **Private files:** 10 paths return 404: `server.js`, `lib/`, `.env`, `data/`, `package.json`, `vercel.json`, `supabase/schema.sql`, `tests/`, `.git/config`. `.vercelignore` uploads only `public/`, `api/`, `lib/`, `package.json` and `vercel.json`.
  - **Git history:** the only key-like strings are fake test keys (`sb_secret_TEST_ONLY_not_a_real_key`, `sk-or-v1-FAKE-TEST-KEY-not-real`) and the `.env.example` placeholder. `.env` and `data/` were never committed.
- **Nov 17, `npm audit` (check 6):** 0 vulnerabilities. The app has no npm packages, and `package-lock.json` lists none.
- **Nov 18, `npm run test:live` (checks 5 and 7): 29 of 29 passed.** It used two test invites, `security-check-a` and `security-check-b`.
  - **Closed without an invite:** all 6 data routes return 401 with no code or a made-up code.
  - **One tester can't reach another:** invite B gets 403 on every route for invite A's tester, including answering A's card. A's data was unchanged.
  - **Odd input is refused before the AI:** a made-up workout type, free text in place of a tap, energy 99, and a path in place of a user ID all return 400. A 2 MB request returns 413.
  - **Rate limit:** 30 check-ins at once → exactly 5 got through with a recommendation card, and 25 got 429 with the friendly message.
  - **Security headers:** CSP (own files + PostHog only), `Referrer-Policy: no-referrer`, `nosniff`, `X-Frame-Options: DENY`, and HSTS.
  - **Live database:** this run was also the first end-to-end test of the Supabase storage, covering setup, read-back, check-ins, the rate-limit function and responses.

## What I fixed

- **Request size (found by the agent's review, Nov 17).** The local server refused bodies over 100 KB, but on Vercel only Vercel's 4.5 MB platform limit applied, so a huge check-in would have been read and processed. `lib/request.js` now refuses anything over 100 KB with a 413 in every `api/` route that reads a body. A unit test covers it, and on Nov 18 the live site returned 413 for 150 KB and 2 MB requests.
- **Test data in the real local file (Nov 17).** A test wrote fake rows into the local `data/cyclesync-db.json`. Only local test data was affected, never the live database. The rows were removed, the test fixed, and `lib/db-local.js` now refuses the real file while tests run.

## What is left

- **No database backups.** The Supabase free plan has none, and we're not upgrading. If the project's data were lost, testers' check-ins would be gone. Accepted for a semester-long friend test. A manual export before inviting friends would reduce the risk.
- **The security test can't prove it would catch a broken lock.** It shows refusals, but we can't safely loosen the lock on the live database to see a failure. The SQL Editor check (no grants to `anon`/`authenticated`) is the second piece of evidence.
