# Finance Engine

A private, **100% locally self-hosted** personal finance engine. Your
financial data never leaves your machine: no external financial APIs, no
telemetry, no CDN assets, no remote fonts. The only network access this
project ever performs is `npm install` at development time.

- **Ledger**: SQLite (WAL mode) via Drizzle ORM — signed integer cents,
  date-only ISO transaction dates
- **Ingestion**: CSV bank-statement import (CLI + web UI) with idempotent
  hash-based dedupe and keyword auto-categorization
- **Dashboard**: net worth, monthly spending by category, income-vs-spending
  trend, recent transactions — light/dark, built on Next.js + Recharts

## Getting started

```bash
npm install
npm run db:migrate   # create data/finance.db
npm run db:seed      # optional: 6 months of demo data (idempotent)
npm run dev          # http://localhost:3100
```

The app listens on **port 3100** (3000 is assumed taken) and binds
**127.0.0.1 only** by default — there is no authentication, so exposing it
to your LAN is an explicit choice: use `npm run dev:lan` / `npm run
start:lan` to bind all interfaces. For production: `npm run build && npm
start`. Migrations and the default category set are applied automatically
on startup; `npm run db:seed` is only for demo data.

**Backups**: `npm run db:backup` writes a WAL-safe online copy to
`data/backups/` (safe while the server runs). To restore: stop the server,
copy the backup over `data/finance.db`, delete stale `finance.db-wal` /
`finance.db-shm`, restart.

## Importing statements

Via the web UI (`/import`), or the CLI:

```bash
npm run import -- --file statement.csv --account "Everyday Checking" [--type CHECKING] [--date-format MDY]
```

Accepted CSVs: `Date,Description,Amount` or split `Debit`/`Credit` columns;
header synonyms (Posted Date, Memo, Payee, …) with sensible priority when a
file carries several (Description beats Memo, Transaction Date beats Posted
Date); `$1,234.56`, `(96.31)`, `45.00-`, and unambiguous European `45,00`
amount forms (mixed forms like `1.234,56` are rejected as row errors, never
guessed); ISO/MDY/DMY dates. Negative Debit values are treated as refunds
(inflows). Re-importing the same file is safe — duplicates are skipped and
reported row by row.

Keep real statement CSVs in `data/imports/` — it is gitignored, as is the
database itself. `data/samples/` contains fake data for testing.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` / `npm run build && npm start` | dev / production server on 127.0.0.1:3100 |
| `npm run dev:lan` / `npm run start:lan` | same, bound to all interfaces (no auth — deliberate opt-in) |
| `npm run db:backup` | WAL-safe online backup to `data/backups/` |
| `npm test` | Vitest suite (parser, categorizer, dedupe, DB integration) |
| `npm run lint` | ESLint |
| `npm run db:generate` / `db:migrate` | create / apply schema migrations |
| `npm run db:seed` | idempotent demo seed |
| `npm run db:studio` | Drizzle Studio DB browser |
| `npm run import -- …` | CLI statement import |

## Architecture

See [CLAUDE.md](CLAUDE.md) for the full architecture map, money/date
conventions, and the dedupe contract.
