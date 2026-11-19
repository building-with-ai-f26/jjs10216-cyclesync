# SECURITY.md — CycleSync security audit (Build 3)

## Summary

| # | Class check | Status |
| --- | --- | --- |
| 1 | RLS on every table | Pass |
| 2 | Secret keys stay on the server | Pass |
| 3 | Private storage, expiring links | Pass (no files are stored) |
| 4 | Production out of the agent's reach; backups | **Not fully passed:** no backups on the free plan |
| 5 | Spending caps | Pass |
| 6 | Dependencies | Pass |
| 7 | Agent review: attack, then fix | Pass |

Details and evidence for each are below.

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
| 1 | RLS on every table, with the test that fits the app | `supabase/schema.sql`: RLS on all 4 tables, no policies, no grants to `anon`/`authenticated`. `npm run test:security` uses the publishable key (and no key) to try to read, add, change and delete in every table and run `take_ai_slot`. Live-site console test + screenshot: step 9. | Passed: database test Nov 17, console test Nov 18 |
| 2 | Secret keys stay on the server | Search the live site's files and the Git history for `sb_secret_`, `service_role`, `sk_` and the real keys | Passed Nov 17–18 (real key values: Julia checked locally Nov 18, none found) |
| 3 | Private storage, expiring links | No files are stored and there are no Supabase Storage buckets | Not applicable: confirmed Nov 18, no buckets in Supabase Storage |
| 4 | Production out of the agent's reach; backups | Dev and prod are separate. The agent has no Supabase or Vercel keys. Backups: see below | Not fully passed: prod is out of the agent's reach, but there are no backups on the free plan |
| 5 | Spending caps | $2 cap on the live OpenRouter key + rate limit on the AI route | Passed Nov 18: rate limit live, $2 cap on the live key confirmed |
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
- **Nov 18, console test (check 1), screenshots kept locally:** Julia ran the same add-and-delete snippet with the publishable key in two browser consoles.
  - **a) On the live site:** the browser blocked the request before it reached Supabase. The Content-Security-Policy (`connect-src 'self'` + PostHog only) refused the connection to `supabase.co`. A first try had a typo in the snippet (the key was missing its quotes) and never ran.
  - **b) In a blank tab (`about:blank`, no CSP):** the requests reached Supabase and were refused. `ADD 401` and `DELETE 401`, each with code `42501` ("permission denied for table invites").
  - **c) Supabase Table Editor afterwards:** `invites` still had only `security-check-a` and `security-check-b`. There was no `console-test` row, and `security-check-a` was not deleted.
- **Nov 18, Supabase Storage (check 3):** no buckets. The app stores no files.
- **Nov 18, manual live checks (Julia):**
  - **Real check-in on her phone:** saved in Supabase `checkins` with `source = ai`. The contraception rule held: `phase` is null.
  - **PostHog events:** `checkin_completed` has `source: "app"`, `$current_url` has no `?code=`, and there are no energy, sleep, cramps or phase properties.
  - **Session replay:** the setup form, the home screen's day and phase, the energy, sleep and cramps steps, and the recommendation card are all masked ("Hidden from recording").
  - **Test invites revoked:** `security-check-a` and `security-check-b` have `revoked_at` set (Nov 18). Julia's own invite is still active.
  - **Spending limits (check 5):** OpenRouter shows a $2 limit on the live key and $5 on the local key.
  - **Git history, all commits (check 2):** 0 OpenRouter keys and 0 commits of `.env`. The 2 matches for `sb_secret_` are the fake test key (`sb_secret_TEST_ONLY_not_a_real_key`), not a real key.
- **Nov 19, real incident: my own invite link shared by mistake.**
  - **What happened:** I accidentally shared my own personal invite link with a friend.
  - **Response:** I revoked it with one SQL line and issued new invites (`julia-2` and `tester-3`). The friend's check-ins from that morning stay under the revoked invite and are excluded from results.
  - **Follow-on bug:** my phone then showed "Could not reach the server" with the new link. It still held the old account's browser ID, whose setup belonged to the revoked invite, and the app showed that refusal as a network error.
  - **Fixed in commit `966658c`:**
    - A link in the URL now always replaces the saved code.
    - A new valid link on a phone with another invite's setup starts a fresh account. The old setup is left untouched.
    - A revoked link shows "This link no longer works. Ask Julia for a new one."
    - "Could not reach the server." now appears only for real network failures.
    - Tests added: `tests/invite-link.test.js`, `tests/invites.test.js` and a new browser-check section.

## What I fixed

- **Request size (found by the agent's review, Nov 17).** The local server refused bodies over 100 KB, but on Vercel only Vercel's 4.5 MB platform limit applied, so a huge check-in would have been read and processed. `lib/request.js` now refuses anything over 100 KB with a 413 in every `api/` route that reads a body. A unit test covers it, and on Nov 18 the live site returned 413 for 150 KB and 2 MB requests.
- **Test data in the real local file (Nov 17).** A test wrote fake rows into the local `data/cyclesync-db.json`. Only local test data was affected, never the live database. The rows were removed, the test fixed, and `lib/db-local.js` now refuses the real file while tests run.

## What is left

- **No automatic backups.** The Supabase free plan doesn't include them, and we're not upgrading. If the project's data were lost, testers' check-ins would be gone. This is accepted for a semester-long friend test.
- **No full sign-in.** Anyone who has a person's link can use that account. That's why links are sent privately, one per person, and can be revoked with one SQL line (as on Nov 19).
- **The database can pause.** Supabase pauses free projects after a period of no activity. The app stops working until the project is restored from the Supabase dashboard.
- **Tester data is temporary.** All tester data is deleted at the end of the semester (by December 31, 2026, as the privacy note says).
- **The security test can't prove it would catch a broken lock.** It shows refusals, but we can't safely loosen the lock on the live database to see a failure. The SQL Editor check (no grants to `anon`/`authenticated`) is the second piece of evidence.
