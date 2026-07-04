@AGENTS.md

# Personal Finance Engine

Private, **100% locally self-hosted** personal finance engine. SQLite ledger,
CSV bank-statement ingestion with dedupe + auto-categorization, local web
dashboard (Net Worth, Monthly Spending by Category, Recent Transactions).

## Privacy rules (non-negotiable)

- No external financial APIs, no telemetry, no CDN assets, no remote fonts.
  The running app makes **zero** network calls; npm registry is used at
  dev time only.
- `NEXT_TELEMETRY_DISABLED=1` stays set (see `.env` / `.env.example`).
- The SQLite database (`data/*.db*`) and real statement CSVs
  (`data/imports/`) are gitignored and must **never** be committed.
  `data/samples/` contains fake data only.

## Stack

Next.js (App Router, TS strict, Tailwind v4, `src/`) · Drizzle ORM +
better-sqlite3 · Recharts · Vitest · csv-parse · zod v4 · tsx for scripts.

## Architecture

- `src/db/` — Drizzle schema (`schema.ts`), connection singleton
  (`client.ts`: absolute DB path from `DB_FILE_NAME`, WAL + foreign_keys
  pragmas), `seed.ts`. Migrations live in `drizzle/`.
- `src/lib/` — pure logic, no DB: CSV statement parser, categorizer,
  import-hash, money formatting. Unit-tested, colocated `*.test.ts`.
- `src/server/services/` — the only DB-touching layer; shared by RSC pages,
  Server Actions, API route handlers, and the import CLI. Add new data
  access here, not in components/routes.
- `src/app/` — RSC pages (`/`, `/transactions`, `/import`), Server Actions
  for mutations, thin GET JSON routes under `/api` for local scripting.
- `scripts/import-csv.ts` — CLI importer.

## Conventions

- **Money**: signed integer cents (`amountCents`); negative = outflow.
  Never floats/REAL. Format via `formatCents` in `src/lib/money.ts`.
- **Dates**: transaction `date` is TEXT `YYYY-MM-DD` (statement dates are
  date-only). Month bucketing = `substr(date, 1, 7)`. No timezones anywhere
  in ledger math. `createdAt`/`updatedAt` are epoch-ms integers.
- **Account types**: TEXT column validated in code
  (`CHECKING | SAVINGS | CREDIT_CARD | CASH | INVESTMENT`), zod + TS union —
  SQLite has no enums.
- **Dedupe contract (FROZEN)**: `importHash` =
  sha256(`accountId|date|cents|normalizedDesc|occurrenceIndex`), where
  `normalizedDesc` = trim + collapse whitespace + lowercase, and
  `occurrenceIndex` counts identical rows **in file row order**. Do not
  change the normalization or hash input — existing rows' hashes would be
  orphaned and re-imports would duplicate.
  - Known limitation: two legitimately identical transactions split across
    *different* CSV files each hash with index 0, so the second file's copy
    is skipped as a duplicate. Importers must report skipped rows in detail
    so the user can catch this.
- **Categorization**: case-insensitive keyword match at import; longest
  matching keyword wins, ties broken by category name; no match →
  `categoryId = null` (rendered "Uncategorized").
- **Input safety**: zod-validate every external input; Drizzle query builder
  or parameterized `sql` fragments only — never string-built SQL. Uploads
  capped at 5 MB, CSV text only.
- Account balance = `openingBalanceCents + SUM(amountCents)`; Net Worth =
  sum across accounts (credit cards naturally negative). Coalesce empty
  SUMs to 0.

## Commands

- `npm run dev` — dev server at http://localhost:3100 (3000 is taken by another local service)
- `npm run build` / `npm start` — production build / serve
- `npm test` / `npm run test:watch` — Vitest
- `npm run lint` — ESLint
- `npm run db:generate` — generate migration from schema changes
- `npm run db:migrate` — apply migrations
- `npm run db:seed` — idempotent demo seed (re-run adds nothing)
- `npm run db:studio` — Drizzle Studio DB browser
- `npm run import -- --file <csv> --account "<name>" [--type CHECKING] [--date-format MDY]` — CLI import

## Git

Repo already initialized; do not commit unless explicitly asked.
