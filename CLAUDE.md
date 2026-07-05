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
- `src/app/` — RSC pages (`/`, `/transactions`, `/accounts`,
  `/categories`, `/import`), Server Actions for mutations, thin GET JSON
  routes under `/api` for local scripting.
- PWA/remote access: `src/app/manifest.ts` + `src/app/apple-icon.png` +
  `public/icon-*.png` (generated locally, never fetched) make the app
  installable over Tailscale HTTPS — deliberately **no service worker**
  (no offline/push; the ledger is server-side).
  `experimental.serverActions.allowedOrigins` in `next.config.ts` allows
  `*.ts.net` so mutations survive the `tailscale serve` proxy
  (Origin-vs-Host CSRF check); extend via `EXTRA_ALLOWED_ORIGINS`.
- Navigation: `src/components/nav-links.ts` is the single source for both
  the desktop `Sidebar` (hidden below `md`) and `MobileNav` (top bar,
  hidden at `md`+).
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
  - Changelog 2026-07: the hash *formula* is unchanged, but parser fixes
    (header priority, decimal-comma amounts, debit sign) change which
    description/amount feed the hash for files that were previously
    misparsed. Re-importing such a file inserts fresh rows because the old
    import stored corrupted values under different hashes — review import
    counts and delete the corrupted rows first.
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

- `npm run dev` — dev server at http://127.0.0.1:3100 (3000 is taken by
  another local service; loopback-only by default — the app has no auth.
  `dev:lan` / `start:lan` bind 0.0.0.0 as an explicit opt-in)
- `npm run db:backup [-- --keep N]` — WAL-safe online backup to
  `data/backups/` (optional `--keep N` prunes to the N newest; restore: stop
  server, copy back over `data/finance.db`, delete stale `-wal`/`-shm`,
  restart)
- `GET /api/health` — liveness probe (`{ok:true}` / 500) for uptime
  monitoring; `deploy/` holds systemd unit + backup timer examples
- `npm run build` / `npm start` — production build / serve
- `npm test` / `npm run test:watch` — Vitest
- `npm run lint` — ESLint
- `npm run db:generate` — generate migration from schema changes
- `npm run db:migrate` — apply migrations (also auto-applied on startup;
  default categories install automatically when the table is empty)
- `npm run db:seed` — idempotent demo seed (re-run adds nothing)
- `npm run db:studio` — Drizzle Studio DB browser
- `npm run import -- --file <csv> --account "<name>" [--type CHECKING] [--date-format MDY]` — CLI import

## Git

Repo already initialized; do not commit unless explicitly asked.
