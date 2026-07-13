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
  pragmas), `seed.ts`. Migrations live in `drizzle/`. `client.ts` also
  applies pending migrations and runs `ensureDefaultCategories`
  (`db/default-categories.ts`, insert-only when the table is empty) on
  first connect — so a fresh DB has working auto-categorization with no
  seed step.
- `src/lib/` — pure logic, no DB: CSV statement parser, categorizer,
  import-hash, money/month formatting, the default-category definitions
  (`default-categories.ts`, pure data) and the validated color palette
  (`palette.ts`). Unit-tested, colocated `*.test.ts`.
- `src/server/services/` — the only DB-touching layer; shared by RSC pages,
  Server Actions, API route handlers, and the import CLI. Add new data
  access here, not in components/routes. Each service has a colocated
  `*.test.ts` integration test that drives a real throwaway SQLite file via
  `src/test/test-db.ts`. Mutable suites use `setupTestDbPerTest()` so every
  `it` gets an independent database; `setupTestDb()` is reserved for fixtures
  that every test treats as immutable. Test DBs are migrated but get **no**
  default categories (`createTestDb`), so tests seed their own.
- `src/app/` — RSC pages (`/`, `/transactions`, `/accounts`,
  `/categories`, `/import`), Server Actions for mutations, thin GET JSON
  routes under `/api` for local scripting. Every page is `force-dynamic`, so a
  `loading.tsx` (root + a table-shaped one for `/transactions`) shows a
  `Skeleton` (`ui/skeleton.tsx`) instead of freezing on nav — add one for any
  new heavy route. Titles come from the layout's `title.template`
  (`%s · Finance Engine`) + a per-page `metadata.title`; the root page keeps the
  default (the template never applies to its own segment). `not-found.tsx` is
  the global 404 that `notFound()` renders. Active nav uses
  `isActiveNav(pathname, href)` from `nav-links.ts`, not `pathname === href`.
  UX round-2 shared primitives (reuse these, don't re-roll): destructive
  confirmation is `ConfirmButton` (`ui/confirm-button.tsx`) — an inline arm →
  Confirm/Cancel swap, **never** `window.confirm`; transient create-success is
  `useFlash`/`FlashMessage` (`ui/flash.tsx`, an `aria-live` region); display a
  ledger date with `formatIsoDate` (`lib/month.ts`, string-only/TZ-safe), keeping
  raw ISO in a `title`; interactive controls get a 44px tap target via the shared
  `inputClass`/`buttonClass`/`toggleButtonClass`/`rowActionClass` (`ui/form.tsx`,
  all `min-h-11`); wide tables get an overflow cue from `.scroll-x-shadows`
  (`globals.css`) on `TableCard`. The amount column tints **only income**
  (`--delta-good`), beside the signed number (color is never the sole cue);
  outflows stay in default ink so `--delta-bad` stays reserved for danger —
  errors, over-budget. Both delta tokens are refined (softer emerald / muted
  brick), not the raw categorical hues.
- `src/server/actions/` — every UI mutation (accounts, categories,
  transactions, apply-rules) as `"use server"` modules split by domain
  (`accounts.ts`, `categories.ts`, `transactions.ts`), sharing helpers/types
  from `shared.ts` and re-exported by a barrel `index.ts` so components keep
  importing from `@/server/actions`. Each action zod-validates its FormData,
  calls a service, then `revalidatePath`s the affected routes. Add new
  mutations to the matching domain file, not inline in components. Destructive
  ops re-verify server-side (e.g. delete-account checks the typed name), not
  just in the client confirm.
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
    counts and **undo the bad import** (Recent imports list on `/import`, or
    `undoImport(batchId)`) before re-importing.
- **Categorization**: case-insensitive keyword match at import; longest
  matching keyword wins, ties broken by category name; no match →
  `categoryId = null` (rendered "Uncategorized"). Retroactive:
  `applyRulesToUncategorized` (Categories page "Apply rules" button →
  `applyRulesAction`) re-runs the matcher over **uncategorized rows only** —
  manual categorizations are never overwritten.
- **Import batches / undo**: every import that inserts ≥1 row records one
  `import_batches` row and stamps its id on each inserted transaction
  (`transactions.batchId`, FK `set null`); all-duplicate imports record nothing.
  `undoImport(batchId)` is an explicit two-step delete (rows first, then the
  batch) — never a cascade — so manual rows (`batchId = null`) and other imports
  are untouched; it returns the deleted count or null if the batch is gone. Pass
  `filename` into `importStatement` from any new caller so history stays useful.
  The `batch_id` FK's `ON DELETE set null` is hand-added to migration 0003
  (drizzle-kit omits it from `ALTER TABLE ADD`). Migrations 0000–0004 are
  historical and byte-locked by `src/db/migrations.test.ts`; never regenerate
  or edit them. Append a reviewed migration for future schema work.
- **Category colors**: constrained to the validated `CATEGORICAL_SLOTS` in
  `src/lib/palette.ts` (the Server Action rejects any other value). Only the
  first 8 categories get a hue; the rest render as neutral badges — never
  invent a 9th color.
- **Spending math** (`server/services/summary.ts`, `countsTowardSpending`):
  a category flagged `excludeFromSpending` (e.g. Transfers) is left out of
  spending, income, and the trend chart; uncategorized rows always count.
  Spending = negative `amountCents`, income = positive.
- **Transaction splits**: a transaction can be divided across categories in
  `transaction_splits` (migration 0004). When a transaction has ≥1 split rows the
  splits define its categorization for **every** spending aggregate and its own
  `categoryId` is ignored; the splits' signed amounts must sum to the
  transaction `amountCents` (enforced in `splitTransactionAction`, not the DB —
  the DB only cascades split deletes when the transaction is deleted). All four
  aggregates read `spendingLineItems()` in `summary.ts` — a UNION of split rows +
  unsplit transactions with the date range pushed into both branches (P1) — so a
  single part can sit in an excluded category without pulling the whole
  transaction in or out of spending. `replaceSplits(id, [])` reverts to the
  single `categoryId`. The transaction list carries `isSplit`; split rows show a
  "Split" badge (linking to the edit page) instead of the category dropdown,
  which would otherwise silently no-op. Edit splits on the transaction edit page.
- **Budgets**: `categories.monthlyBudgetCents` is a nullable positive-cents
  target (null = no budget). `getBudgetVsActual(month)` LEFT-JOINs each budgeted
  category to its month outflow, computing spend the same way as spending math
  (negative-only, refunds don't reduce it) so a zero-spend budget still shows.
- **Currency**: `accounts.currency` defaults `USD` and net-worth SUM assumes a
  single currency. `getNetWorthOverview` returns the distinct currencies; the
  dashboard warns (not sums) when there's more than one. Money deltas use the
  `--delta-good` / `--delta-bad` tokens, always paired with text (never color
  alone) per the CVD-safe palette rule.
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
  `backups/` beside the resolved `DB_FILE_NAME` target (optional `--keep N`
  prunes to the N newest; restore: stop server, copy back over that exact
  target, delete its matching `<target>-wal`/`<target>-shm`, restart)
- `GET /api/health` — liveness probe (`{ok:true}` / 500) for uptime
  monitoring; `deploy/` holds systemd unit + backup timer examples
- `GET /api/export?q=&account=&category=&month=&from=&to=` — the filtered
  transaction view as a CSV download (same query parsing as `/transactions`)
- `npm run build` / `npm start` — production build / serve. During remediation,
  do not use a bare build as a validation command until WP-01D supplies the
  mandatory temporary-database wrapper; follow `IMPLEMENTATION_GUIDE.md`.
- `npm test` / `npm run test:watch` — Vitest. Single file:
  `npm test -- src/lib/categorize.test.ts`; by name:
  `npm test -- -t "dedupe"`
- `npm run lint` — ESLint
- `npm run db:generate` — generate a new append-only migration from schema
  changes; never regenerate or edit migrations 0000–0004
- `npm run db:migrate` — apply migrations (also auto-applied on startup;
  default categories install automatically when the table is empty). Historical
  migrations 0000–0004 are byte-locked compatibility assets.
- `npm run db:seed` — currently unguarded demo seed; use only with a new
  disposable ledger (WP-03 adds the code-level real-data guard)
- `npm run db:studio` — Drizzle Studio DB browser
- `npm run import -- --file <csv> --account "<name>" [--type CHECKING] [--date-format MDY] [--col-date "<header>"] [--col-amount "<header>"] …` — CLI import; `--col-*` flags override header detection (also exposed as a `columnMap` JSON field on `/api/import` and an "Advanced" section in the import UI)

## Other docs

- `IMPLEMENTATION_GUIDE.md` — audit-remediation north star: immutable contracts,
  decision gates, dependency-ordered work packages, rollback, and acceptance
  tests. WP-00 and WP-01A/B/C are complete; WP-12A is the prepared next slice.
  Read it before implementing audit findings or selecting the next
  correctness/privacy/operations package.
- `TODO.md` — historical/product backlog and shipped milestones. Its IDs
  (P1–P7 perf, Q1–Q9 code quality, O1/O2 ops, F#/… features) are the same tags
  used in commit-message prefixes; `IMPLEMENTATION_GUIDE.md`, not backlog rank,
  controls the current remediation order.
- `USER_MANUAL.md` — end-user, plain-English feature guide. Consult it when a
  change affects user-facing behavior so the manual stays in sync.
- `README.md` — setup, home-server (systemd) and Tailscale/PWA deployment.

## Git

Repo already initialized; do not commit unless explicitly asked.
