# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Overview

**Sub Tracker** — a subscription-tracking web app. Users upload bank transaction CSVs (Bank of America, Chase, etc.); the app detects recurring subscriptions (Spotify, Netflix, utilities, internet, ...), explains what each service is via the Gemini API, and shows spending statistics. One-off purchases (regular shopping) are deliberately excluded.

Purpose: personal use + portfolio. Single user for now; auth and cloud deploy come last.

**Read these before implementing anything:**
- `docs/PRD.md` — product requirements (what to build and why)
- `docs/HLD.md` — high-level design (architecture, data model, detection pipeline)

## Current Status

**Phases 1–5 complete and verified** — scaffold, CSV upload+import, detection pipeline, dashboard+charts+detail, and insights+demo-seed. `next build` and `tsc --noEmit` pass; all routes return 200 with data. Verified end-to-end with real Gemini calls: column mapping across two bank formats, subscription detection (recurring non-subscriptions like credit-card autopay correctly excluded by Gemini), merchant cache, dedupe, rejection persistence, dashboard/detail rendering, price-change detection, deterministic insights, and demo seed.

**Only remaining (optional) work: cloud deploy** — switch Prisma datasource `provider` to `postgresql` (e.g. Neon), regenerate migrations, add Auth.js if multi-user is wanted, and deploy to Vercel with `GEMINI_API_KEY` + `DATABASE_URL` env vars. Not started; it's a user decision (needs their Vercel/Neon accounts).

**Not visually verified in a browser:** the Recharts charts (category donut, monthly trend) compile, server-render without error, and receive correct data, but this environment has no browser to eyeball the drawn SVG. Worth a quick look on first run.

**Gemini free-tier quota is tight: ~20 requests/day for `gemini-3.5-flash`.** Heavy testing exhausts it and returns 429 `RESOURCE_EXHAUSTED`. The app degrades gracefully: `/api/upload` falls back to a header-name heuristic column mapping (`heuristicMapping` in `lib/sources/csv.ts`) when Gemini is unavailable, and `/api/import` treats detection failure as non-fatal (transactions still import; detection is idempotent and re-runs on the next upload). When testing, minimize Gemini calls; the demo seed (`prisma/seed.ts`) is deterministic and uses NO Gemini.

Actual versions installed (differ from the docs' original guesses):
- **Next.js 16.2** (not 15) + React 19 + Tailwind **v4** (`@import "tailwindcss"` in `app/globals.css`, no `tailwind.config.js`). Turbopack is the default builder.
- **Prisma pinned to v6** (6.19.x), NOT v7. Prisma 7 dropped `url = env()` from the schema and now requires a native driver adapter (better-sqlite3/libsql) at runtime; on this machine's Node 26 those native modules risk having no prebuilds. v6 uses the documented `url = env("DATABASE_URL")` setup with a bundled query engine — no native deps. Do not bump Prisma to 7 without migrating to driver adapters + `prisma.config.ts`.
- `DATABASE_URL="file:./dev.db"` lives in `.env` (Prisma CLI reads it); the Gemini key stays in `.env.local`. Both are gitignored, plus `*.db` / `prisma/dev.db*`.

Gemini SDK is **`@google/genai`** (v2.x, the current unified SDK), not the older `@google/generative-ai`. Model is **`gemini-3.5-flash`** (set in `lib/gemini.ts`) — `gemini-2.5-flash`/`-flash-lite` return 404 "no longer available to new users" for this API key. If the model 404s in future, run `ai.models.list()` and pick a current stable flash (e.g. `gemini-flash-latest`).

Existing structure: `app/` (dashboard `page.tsx`, `upload/`, `insights/`), `components/` (`sidebar.tsx`, `ui.tsx`), `lib/` (`db.ts`, `format.ts`), `prisma/schema.prisma` + migration.

Run the dev server on a non-default port to avoid clashes, e.g. `npx next dev -p 3939`.

## Planned Stack

- Next.js 15 (App Router) + TypeScript + Tailwind CSS
- Prisma + SQLite locally (switch provider to Postgres/Neon at deploy time)
- Gemini API (`gemini-2.5-flash`, JSON structured output) — all calls server-side only
- Papaparse (CSV), Recharts (charts)

## Commands (once scaffolded)

```bash
npm run dev          # dev server
npm run build        # production build — must pass before finishing a phase
npx tsc --noEmit     # typecheck
npx prisma migrate dev   # apply schema changes
npx prisma studio    # inspect DB
```

## Key Design Decisions (do not silently deviate)

1. **Two-stage subscription detection**: a deterministic rules engine (`lib/detection.ts`) finds recurring-charge candidates first (same merchant, amount within ±15%, weekly/monthly/yearly cadence ±5 days); only those candidates go to Gemini for name normalization, description, category, and final is-it-a-subscription judgment. Never send every transaction to the AI.
2. **Merchant cache**: Gemini analysis results are stored in the `Merchant` table and reused. A merchant already analyzed must not trigger another API call.
3. **CSV column mapping via Gemini**: bank CSV formats differ; send header + 5 sample rows to Gemini to get a `{date, description, amount}` column mapping, then show the user a preview before import.
   - **PDF statements** are also supported: `/api/upload` accepts multipart (a PDF file), extracts text with `unpdf` (`lib/pdf.ts`), and Gemini structures it into transactions (`extractTransactionsFromText` in `lib/gemini.ts`). Debits become spend. CSV path stays JSON `{csvText}`; the route branches on content-type. Both import paths share `importNormalized` in `lib/import.ts`.
4. **Duplicate-safe imports**: `Transaction` has a unique hash over `(date, amount, rawDescription)` so re-uploading the same CSV is a no-op.
5. **`TransactionSource` abstraction**: CSV import is one implementation; keep the interface clean so Plaid/Teller connectors can be added later without touching the pipeline.

## Environment

- `GEMINI_API_KEY` in `.env.local` (never commit; keep `.env*` in `.gitignore`)
- Windows machine; PowerShell is the primary shell

## Conventions

- Domain logic lives in `lib/` (pure, testable functions); API routes stay thin.
- All Gemini calls go through `lib/gemini.ts` with typed JSON schemas — no ad-hoc prompt strings scattered around.
- Test data: fake bank CSVs live in `fixtures/` — never use real bank exports in the repo.
- UI text is English; code comments English.
