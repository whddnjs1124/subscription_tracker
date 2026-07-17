# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Overview

**Sub Tracker** — a subscription-tracking web app. Users upload bank transaction CSVs (Bank of America, Chase, etc.); the app detects recurring subscriptions (Spotify, Netflix, utilities, internet, ...), explains what each service is via the Gemini API, and shows spending statistics. One-off purchases (regular shopping) are deliberately excluded.

Purpose: personal use + portfolio. Multi-user auth and the Neon/Vercel deploy are now in place (see Current Status).

**Read these before implementing anything:**
- `docs/PRD.md` — product requirements (what to build and why)
- `docs/HLD.md` — high-level design (architecture, data model, detection pipeline)
- `docs/PHASE6.md` — **required reading before any Phase 6 work** (subscription lifecycle, detection-failure UX, route states + transaction filters, renewals/settings)

## Current Status

**Phases 1–5 complete and verified** — scaffold, CSV upload+import, detection pipeline, dashboard+charts+detail, and insights+demo-seed. `next build` and `tsc --noEmit` pass; all routes return 200 with data. Verified end-to-end with real Gemini calls: column mapping across two bank formats, subscription detection (recurring non-subscriptions like credit-card autopay correctly excluded by Gemini), merchant cache, dedupe, rejection persistence, dashboard/detail rendering, price-change detection, deterministic insights, and demo seed.

**Phase 6 is complete and verified** (plan: `docs/PHASE6.md`). It closed four gaps: (1) **subscription lifecycle** — `lib/lifecycle.ts` auto-retires subs whose charges stopped (2× cadence) to `stale` so they leave the totals, detection revives them when charges resume, `/subscriptions` lists every status with Reactivate, and amount/cadence/category/next-billing are editable; (2) **detection-failure UX** — `lib/detect.ts` now reports `merchantsPending`/`quotaExhausted` instead of silently skipping a batch, and the dashboard/upload surface a re-run button; (3) **route states + transaction filtering** — `loading.tsx`/`error.tsx`/`not-found.tsx` exist, `/transactions` has search/category/month filters and 50-per-page pagination; (4) **upcoming renewals** on the dashboard and a `/settings` page (password change, JSON/CSV export, account deletion). Verified against the demo seed with zero Gemini calls: 28 e2e checks, 11 lifecycle checks (including the `isManual` guard and idempotency), 11 account checks, plus the quota-reporting path with the API key unset.

**Auth is rate limited** (`lib/rate-limit.ts`): failed logins are capped per email (10/15min) and per IP (30/15min), signups per IP (5/hour). Counters live in the `RateLimit` table, not in memory — on Vercel an in-process counter is per-instance and dies on cold start, so it would throttle almost nothing. Failures are counted against the *typed* email whether or not the account exists, or the lockout becomes an account-existence oracle; keep it that way. The lockout reaches the UI as a `CredentialsSignin` subclass with `code: "rate_limited"`.

**Two Phase 6 invariants that are easy to break** (both have regression coverage — see Key Design Decisions 6 and 7): `stale` is system-set only and `cancelled` is user-set only, and `applyStaleStatus` must keep its `isManual: false` filter or every hand-added subscription is retired (manual subs have no transactions, so their `lastCharged` never advances).

**Datasource is now Postgres (Neon), not SQLite** — `provider = "postgresql"` in `prisma/schema.prisma`, single `DATABASE_URL` for both local dev and Vercel. Schema is synced with `prisma db push` (`npm run db:push`); there are no migration files (the old SQLite migration was removed). `postinstall` runs `prisma generate` so Vercel builds the client. To deploy: create a Neon DB, put its connection string in `.env` locally + Vercel env vars, `npm run db:push` once to create tables, then deploy to Vercel with `GEMINI_API_KEY` + `DATABASE_URL` + `AUTH_SECRET` set.

**Multi-user auth is implemented (Auth.js v5 / next-auth beta, email+password).** Every model has a `userId`; every query, route, and page filters by the signed-in user's id (`getUserId()` in `lib/session.ts`, from `auth()` in `auth.ts`). Uniques are per-user: `@@unique([userId, dedupeHash])`, `[userId, rawPattern]`, `[userId, month]`. Sessions are JWT (required for the Credentials provider); passwords are bcryptjs hashes in `User.passwordHash`. Route protection is `middleware.ts` (edge-safe `auth.config.ts`, no Node deps) — it redirects unauthenticated requests to `/login`. Login/signup pages are `app/login` + `app/signup`; signup is `POST /api/signup`. The in-app "Clear all data" button (`/api/reset`) now clears ONLY the signed-in user's data; the `npm run db:reset` CLI still wipes everything including accounts. Demo login (from `npm run db:seed`): `demo@subtracker.app` / `demo1234`. Requires `AUTH_SECRET` in `.env.local` (and Vercel). NOTE: Next 16 deprecated the `middleware` file name in favor of `proxy` (build shows a warning); the current `middleware.ts` with `export default auth` still works.

**Charts are verified** (as of Phase 6): a Playwright screenshot of the seeded dashboard shows the category donut drawing 5 sectors with its legend and the monthly-trend line drawing a curve with Feb–Jul axis labels. Playwright (a devDependency) with its bundled Chromium is the way to eyeball UI here — see the verification approach in `docs/PHASE6.md` §13.

**Gemini free-tier quota is tight (a few dozen requests/day).** Heavy testing exhausts it and returns 429 `RESOURCE_EXHAUSTED`. The app degrades gracefully: `/api/upload` falls back to a header-name heuristic column mapping (`heuristicMapping` in `lib/sources/csv.ts`) when Gemini is unavailable, and `/api/import` treats detection failure as non-fatal (transactions still import; detection is idempotent and re-runs on the next upload). When testing, minimize Gemini calls; the demo seed (`prisma/seed.ts`) is deterministic and uses NO Gemini.

Actual versions installed (differ from the docs' original guesses):
- **Next.js 16.2** (not 15) + React 19 + Tailwind **v4** (`@import "tailwindcss"` in `app/globals.css`, no `tailwind.config.js`). Turbopack is the default builder.
- **Prisma pinned to v6** (6.19.x), NOT v7. Prisma 7 dropped `url = env()` from the schema and now requires a native driver adapter (better-sqlite3/libsql) at runtime; on this machine's Node 26 those native modules risk having no prebuilds. v6 uses the documented `url = env("DATABASE_URL")` setup with a bundled query engine — no native deps. Do not bump Prisma to 7 without migrating to driver adapters + `prisma.config.ts`.
- `DATABASE_URL` (a Neon Postgres connection string) lives in `.env` (Prisma CLI reads it); the Gemini key stays in `.env.local`. Both are gitignored, plus `*.db` / `prisma/dev.db*`. The old `prisma/dev.db` SQLite file may still exist locally but is unused and ignored.

Gemini SDK is **`@google/genai`** (v2.x, the current unified SDK), not the older `@google/generative-ai`. Model is **`gemini-flash-lite-latest`** (`MODEL` in `lib/gemini.ts:9`) — flash-lite has its own, more generous free-tier bucket and is plenty for column mapping and merchant classification; the `-latest` alias keeps it from 404-ing when a version retires. Pinned versions have burned us before: `gemini-2.5-flash` 404s for new keys, and `gemini-3.5-flash` / `gemini-2.0-flash` get rate-limited. If the model 404s anyway, run `ai.models.list()` and pick a current stable flash.

Existing structure: `app/` (dashboard `page.tsx`, `upload/`, `insights/`), `components/` (`sidebar.tsx`, `ui.tsx`), `lib/` (`db.ts`, `format.ts`), `prisma/schema.prisma` + migration.

Run the dev server on a non-default port to avoid clashes, e.g. `npx next dev -p 3939`.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4
- Prisma 6 + Postgres (Neon) for both local dev and Vercel
- Auth.js v5 (next-auth beta), email+password credentials, JWT sessions
- Gemini API via `@google/genai` (JSON structured output) — all calls server-side only
- Papaparse (CSV), unpdf (PDF text), Recharts (charts)

## Commands

```bash
npm run dev          # dev server (use a non-default port: npx next dev -p 3939)
npm run build        # production build — must pass before finishing a phase
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run db:push      # apply schema changes (NOT `prisma migrate` — this repo has no migration files)
npm run db:studio    # inspect DB
npm run db:seed      # deterministic demo data, no Gemini calls
npm run db:reset     # wipe everything including accounts
```

## Key Design Decisions (do not silently deviate)

1. **Two-stage subscription detection**: a deterministic rules engine (`lib/detection.ts`) finds recurring-charge candidates first (same merchant, amount within ±15%, weekly/monthly/yearly cadence ±5 days); Gemini then does name normalization, description, category, and the final is-it-a-subscription judgment, and only a merchant the rules engine flagged as recurring can become a `Subscription`. **Never send every transaction to the AI — batch by unique merchant.** Note `enrichMerchants` (`lib/detect.ts`) sends every *uncached merchant*, not just the recurring candidates, so that non-subscription transactions also get a readable name/category for the dashboard and transaction list; non-candidates go over with cadence `one-time`. Calls scale with new merchants, not with transaction volume.
2. **Merchant cache**: Gemini analysis results are stored in the `Merchant` table and reused. A merchant already analyzed must not trigger another API call.
3. **CSV column mapping via Gemini**: bank CSV formats differ; send header + 5 sample rows to Gemini to get a `{date, description, amount}` column mapping, then show the user a preview before import.
   - **PDF statements** are also supported: `/api/upload` accepts multipart (a PDF file), extracts text with `unpdf` (`lib/pdf.ts`), and Gemini structures it into transactions (`extractTransactionsFromText` in `lib/gemini.ts`). Debits become spend. CSV path stays JSON `{csvText}`; the route branches on content-type. Both import paths share `importNormalized` in `lib/import.ts`.
4. **Duplicate-safe imports**: `Transaction` has a unique hash over `(date, amount, rawDescription)` so re-uploading the same CSV is a no-op.
5. **`TransactionSource` abstraction**: CSV import is one implementation; keep the interface clean so Plaid/Teller connectors can be added later without touching the pipeline.
6. **Status ownership** (Phase 6, see `docs/PHASE6.md`): `Subscription.status` values are split by who may set them — `stale` is system-set only (auto-detected inactivity) and `cancelled` is user-set only. Detection never writes `cancelled`; the PATCH route never accepts `stale`. This is what keeps "it stopped charging" distinguishable from "I cancelled it", so don't collapse them.
7. **User edits win over detection** (Phase 6): once a user edits a subscription's amount/cadence/next-billing, `userEdited` is set and re-detection must not overwrite those fields — it only refreshes `lastCharged`/`firstSeen`.

## Environment

- `GEMINI_API_KEY` and `AUTH_SECRET` in `.env.local`; `DATABASE_URL` (Neon) in `.env` so the Prisma CLI reads it. Never commit — `.env*` is gitignored.
- Windows machine; PowerShell is the primary shell

## Conventions

- Domain logic lives in `lib/` (pure, testable functions); API routes stay thin.
- All Gemini calls go through `lib/gemini.ts` with typed JSON schemas — no ad-hoc prompt strings scattered around.
- Test data: fake bank CSVs live in `fixtures/` — never use real bank exports in the repo.
- UI text is English; code comments English.
