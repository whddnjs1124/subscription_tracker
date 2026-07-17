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

**Phase 6 is planned but NOT implemented — the plan is `docs/PHASE6.md`; read it in full before starting.** It closes four gaps found in a full app review: (1) **subscription lifecycle** — subs whose charges stopped stay `active` forever and keep inflating the totals, the "due soon" badge fires on past dates (`app/page.tsx:72`), only name/note are editable, and cancelled/rejected subs have no screen; (2) **detection-failure UX** — a Gemini 429 makes `lib/detect.ts:110-113` silently skip a batch, so the user is told "0 subscriptions" instead of "quota exhausted"; (3) **route states + transaction filtering** — no `loading.tsx`/`error.tsx`/`not-found.tsx` anywhere, and `/transactions` renders every row with no search or pagination; (4) **upcoming renewals + a settings page** (password change, data export, account deletion). Phase 6 starts with an additive schema change (a `stale` status value and a `userEdited` boolean on `Subscription`), so **run `npm run db:push` first**. Two policy decisions worth knowing before touching the code: `stale` is system-set only and `cancelled` is user-set only (that's how auto vs manual stays distinguishable), and `applyStaleStatus` must exclude `isManual: false` rows or every hand-added subscription goes stale.

**Datasource is now Postgres (Neon), not SQLite** — `provider = "postgresql"` in `prisma/schema.prisma`, single `DATABASE_URL` for both local dev and Vercel. Schema is synced with `prisma db push` (`npm run db:push`); there are no migration files (the old SQLite migration was removed). `postinstall` runs `prisma generate` so Vercel builds the client. To deploy: create a Neon DB, put its connection string in `.env` locally + Vercel env vars, `npm run db:push` once to create tables, then deploy to Vercel with `GEMINI_API_KEY` + `DATABASE_URL` + `AUTH_SECRET` set.

**Multi-user auth is implemented (Auth.js v5 / next-auth beta, email+password).** Every model has a `userId`; every query, route, and page filters by the signed-in user's id (`getUserId()` in `lib/session.ts`, from `auth()` in `auth.ts`). Uniques are per-user: `@@unique([userId, dedupeHash])`, `[userId, rawPattern]`, `[userId, month]`. Sessions are JWT (required for the Credentials provider); passwords are bcryptjs hashes in `User.passwordHash`. Route protection is `middleware.ts` (edge-safe `auth.config.ts`, no Node deps) — it redirects unauthenticated requests to `/login`. Login/signup pages are `app/login` + `app/signup`; signup is `POST /api/signup`. The in-app "Clear all data" button (`/api/reset`) now clears ONLY the signed-in user's data; the `npm run db:reset` CLI still wipes everything including accounts. Demo login (from `npm run db:seed`): `demo@subtracker.app` / `demo1234`. Requires `AUTH_SECRET` in `.env.local` (and Vercel). NOTE: Next 16 deprecated the `middleware` file name in favor of `proxy` (build shows a warning); the current `middleware.ts` with `export default auth` still works.

**Not visually verified in a browser:** the Recharts charts (category donut, monthly trend) compile, server-render without error, and receive correct data, but this environment has no browser to eyeball the drawn SVG. Worth a quick look on first run.

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
