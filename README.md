# Sub Tracker

Find and manage the recurring subscriptions hiding in your bank statements.

Upload a bank transaction CSV (Bank of America, Chase, or any US bank export) and
Sub Tracker detects your recurring subscriptions — Spotify, Netflix, utilities,
internet, gym, and more — using a two-stage pipeline: a deterministic rules engine
finds recurring-charge candidates, then Google's Gemini normalizes each merchant
name, describes it, categorizes it, and confirms whether it's genuinely a
subscription (so a monthly credit-card autopay or a weekly grocery run is *not*
flagged). One-off purchases are deliberately ignored.

## Features

- **CSV & PDF import** — upload a bank CSV (Gemini maps the columns, with a
  header-name heuristic fallback) or a **PDF statement** (text is extracted and
  Gemini structures the transactions). Re-uploading the same file is a safe no-op
  (content-hash dedupe).
- **Two-stage subscription detection** — a free, deterministic rules engine
  (cadence + amount stability) narrows candidates before any AI call; results are
  cached per merchant so the same merchant is never analyzed twice.
- **Dashboard** — monthly total, active count, category donut, monthly-spend trend,
  and a subscription list sorted by next billing date with "due soon" badges.
- **Subscription detail** — full payment history, automatic price-increase
  detection, rename / cancel / delete / notes.
- **Insights** — deterministic analysis (overlapping services, possibly-unused
  subscriptions, most expensive) plus an on-demand, cached AI briefing.
- **Demo mode** — `npm run db:seed` loads a rich, deterministic dataset (no API key
  needed) for an instant tour.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Prisma + SQLite ·
Recharts · Google Gemini (`@google/genai`).

## Getting started

```bash
npm install

# Set your Gemini API key (get one at https://aistudio.google.com)
echo 'GEMINI_API_KEY=your_key_here' > .env.local

# Create the local SQLite database
npx prisma migrate dev

# (optional) load demo data — no API key required
npm run db:seed

npm run dev            # http://localhost:3000
```

Then open `/upload` to import a statement, or start from the seeded dashboard.
Sample bank CSVs live in `fixtures/`.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:seed` | Load deterministic demo data |
| `npm run db:studio` | Inspect the database |

## Notes

- The Gemini free tier is rate-limited (~20 requests/day for `gemini-3.5-flash`).
  The app degrades gracefully when the quota is hit: imports still work via the
  heuristic column mapping, and subscription detection re-runs idempotently on the
  next upload.
- All Gemini and database access is server-side only; the API key is never exposed
  to the browser.

## Documentation

- [`docs/PRD.md`](docs/PRD.md) — product requirements
- [`docs/HLD.md`](docs/HLD.md) — architecture, data model, detection pipeline
- [`CLAUDE.md`](CLAUDE.md) — implementation notes and conventions
