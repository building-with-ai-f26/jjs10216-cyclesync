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
| 2 | Secret keys stay on the server | Search the live site's files and the Git history for `sb_secret_`, `service_role`, `sk_` and the real keys | To do (step 9) |
| 3 | Private storage, expiring links | No files are stored and there are no Supabase Storage buckets | Not applicable (confirm in step 9) |
| 4 | Production out of the agent's reach; backups | Dev and prod are separate. The agent has no Supabase or Vercel keys. Backups: see below | Partly. No backups on the free plan. |
| 5 | Spending caps | $2 cap on the live OpenRouter key + rate limit on the AI route | To do (steps 5, 8) |
| 6 | Dependencies | `npm audit`, fix anything rated high | To do |
| 7 | Agent review: attack, then fix | See `Plan.md` B3-7 | To do (step 9) |

## What I found

- **Nov 17, `npm run test:security`:** all 34 attempts were refused. Supabase project settings: Data API on, automatic RLS on, "Automatically expose new tables" off.
  - With the publishable key, every read, add, change and delete on `invites`, `profiles`, `checkins` and `ai_calls` returned `401` with Postgres `42501` (permission denied). So did running `take_ai_slot`.
  - With no key, every attempt returned `401`.
- **Nov 17, SQL Editor:** all 4 tables show `rls_enabled = true`, and there are no grants to `anon`, `authenticated` or `PUBLIC`.
- **Nov 17:** the old JWT API keys (`anon` / `service_role`) are disabled.
- **Nov 17, backups:** Supabase's page says "Free Plan does not include project backups."

## What I fixed

- (filled in during Build 3)

## What is left

- **No database backups.** The Supabase free plan has none, and we're not upgrading. If the project's data were lost, testers' check-ins would be gone. Accepted for a semester-long friend test. A manual export before inviting friends would reduce the risk.
- **The security test can't prove it would catch a broken lock.** It shows refusals, but we can't safely loosen the lock on the live database to see a failure. The SQL Editor check (no grants to `anon`/`authenticated`) is the second piece of evidence.
