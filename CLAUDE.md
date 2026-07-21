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
- Everything below `data/` is gitignored and must **never** be committed except
  explicitly fake fixtures below `data/samples/`.

## Stack

Next.js (App Router, TS strict, Tailwind v4, `src/`) · Drizzle ORM +
better-sqlite3 · Recharts · Vitest · csv-parse · zod v4 · tsx for scripts.

## Architecture

- `src/db/` — Drizzle schema (`schema.ts`), connection singleton
  (`client.ts`: preflighted DB path from `DB_FILE_NAME`, WAL + foreign_keys
  pragmas), and side-effect-free path/environment/migration-asset preflight,
  plus `seed.ts`. The default target is `data/finance.db`; relative targets
  must remain canonically below `data/`, while external targets must be
  canonical absolute paths. Migrations live in `drizzle/`, and their reviewed
  journal metadata and SQL hashes are validated before any directory creation
  or SQLite open. `client.ts` then applies pending migrations and runs
  `ensureDefaultCategories`
  (`db/default-categories.ts`, insert-only when the table is empty) on
  first connect. Its empty check and complete insert set share one immediate
  transaction, so a fresh DB gets every built-in category or none. Any existing
  category suppresses installation; startup never infers or repairs a partial
  historical set. If the table becomes completely empty, the next connect or
  ready statement import reinstalls all defaults because there is no persisted
  initialization marker.
- `src/lib/` — pure logic, no DB: CSV statement parser, categorizer,
  import-hash, exact editable decimal ↔ safe integer-cent conversion,
  money/month formatting, the default-category definitions
  (`default-categories.ts`, pure data) and the validated color palette
  (`palette.ts`). Unit-tested, colocated `*.test.ts`.
- `src/server/services/` — the only DB-touching layer; shared by RSC pages,
  Server Actions, API route handlers, and the import CLI. Add new data
  access here, not in components/routes. Scoped ESLint rules mechanically
  reject static DB-module, Drizzle, and better-sqlite3 imports from app code,
  components, and Server Actions, including type-only imports and re-exports;
  services, DB infrastructure, tests, and operational connection owners are
  the documented exceptions. Each service has a colocated
  `*.test.ts` integration test that drives a real throwaway SQLite file via
  `src/test/test-db.ts`. Mutable suites use `setupTestDbPerTest()` so every
  `it` gets an independent database; `setupTestDb()` is reserved for fixtures
  that every test treats as immutable. Test DBs are migrated but get **no**
  default categories (`createTestDb`), so tests seed their own.
  Account/category/transaction writes return discriminated outcomes for
  expected invalid input, missing references, missing rows, and name conflicts.
  Services revalidate safe cents, ledger dates, budgets, new or explicitly
  supplied account currencies, bounded text/IDs, and foreign-key references
  inside the write transaction;
  actions/routes are transport decoders and friendly error adapters, not the
  invariant boundary.
- `src/app/` — RSC pages (`/`, `/transactions`, `/transfers`, `/accounts`,
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
  transactions, imports, relationship controls, apply-rules) as `"use server"`
  modules split by domain (`accounts.ts`, `categories.ts`, `transactions.ts`,
  `imports.ts`), sharing helpers/types
  from `shared.ts` and re-exported by a barrel `index.ts` so components keep
  importing from `@/server/actions`. Each exported action first awaits
  `assertTrustedActionOrigin()` before inspecting decoded arguments, then
  zod-validates its FormData, calls a service, and revalidates. Add new
  mutations to the matching domain file, not inline in components. Destructive
  ops re-verify server-side (e.g. delete-account checks the typed name), not
  just in the client confirm.
- PWA/remote access: `src/app/manifest.ts` + `src/app/apple-icon.png` +
  `public/icon-*.png` (generated locally, never fetched) make the app
  installable over Tailscale HTTPS — deliberately **no service worker**
  (no offline/push; the ledger is server-side).
  `EXTRA_ALLOWED_ORIGINS` is a comma-separated list of complete exact HTTPS
  origins. `next.config.ts` validates and build-freezes their canonical full
  origins, passes only exact host/port values to Next's coarse Server Action
  check, and never permits `*.ts.net`. The runtime guard remains authoritative
  because installed Next drops schemes and permits missing Origin. Production
  changes require a new build and restart with the same configuration.
  `/api/import` performs the same policy before content metadata or body access.
  After that guard, it strictly validates optional length and multipart metadata,
  measures at most 5 MiB plus 64 KiB from the network stream, reconstructs one
  bounded in-memory request, and parses only that request. The service owns the
  shared cross-platform/NFC filename validator for UI and CLI callers. Every
  financial JSON route, health response, and export response is explicitly
  `Cache-Control: no-store`; no route adds permissive CORS.
  Successful ledger mutations call the one `src/server/revalidation.ts` helper,
  which uses the installed-version root-layout contract
  `revalidatePath("/", "layout")`; validation, conflicts, failed deletes, and
  explicit no-op results do not revalidate. Route-handler imports still refresh
  the current client tree only when rows were actually added.
  Forwarded host/proto are trusted only in the unoverridden loopback launch
  modes; LAN modes reject a distinct forwarded target. Global headers deny
  framing, type sniffing, and referrer disclosure, and hide `x-powered-by`.
- Navigation: `src/components/nav-links.ts` is the single source for both
  the desktop `Sidebar` (hidden below `md`) and `MobileNav` (top bar,
  hidden at `md`+). Active links expose `aria-current="page"`; the mobile toggle
  owns a stable controlled menu ID and restores focus on Escape.
- `scripts/import-csv.ts` — CLI importer.

## Conventions

- **Money**: signed integer cents (`amountCents`); negative = outflow.
  Never floats/REAL. Editable form text uses `decimalTextToCents`; exact form
  defaults/CSV decimals use `centsToDecimalText`. Both are digit-based and
  reject unsafe cents or precision beyond two decimal places rather than
  rounding. `parseAmountToCents` may normalize documented bank-statement syntax
  before delegating exact conversion. `cents / 100` is display-only inside
  `Intl.NumberFormat` helpers such as `formatCents`.
- **Dates**: transaction `date` is TEXT `YYYY-MM-DD` (statement dates are
  date-only). Month bucketing = `substr(date, 1, 7)`. No timezones anywhere
  in ledger math. `createdAt`/`updatedAt` are epoch-ms integers.
- **Account types**: TEXT column validated in code
  (`CHECKING | SAVINGS | CREDIT_CARD | CASH | INVESTMENT`), zod + TS union —
  SQLite has no enums.
- **Accessibility contracts**: `useServerForm` focuses a stable alert summary
  only after a submitted pending state fails. Action results retain an optional
  validated `field`, and `fieldErrorAttributes` links only that known control.
  `ConfirmButton` requires visible consequence text and a caller-supplied
  surviving success target; refusal stays armed, while Cancel/Escape restores
  the trigger. Do not move consequence text back into title-only tooltips or use
  an adjacent row as the sole success target because the last row can disappear.
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
  (drizzle-kit omits it from `ALTER TABLE ADD`). Migrations 0000–0005 are
  historical and byte-locked by `src/db/migrations.test.ts`; never regenerate
  or edit them. Migration 0006 is the append-only ledger-options migration for
  merchant/status fields, opening-balance dates, and explicit transfer/refund/
  duplicate-override provenance. Append a reviewed migration for future schema
  work.
- **Category colors**: constrained to the validated `CATEGORICAL_SLOTS` in
  `src/lib/palette.ts` (the Server Action rejects any other value). Only the
  first 8 categories get a hue; the rest render as neutral badges — never
  invent a 9th color.
- **Spending math** (`server/services/summary.ts`, `countsTowardSpending`):
  a category flagged `excludeFromSpending` (e.g. Transfers), a transaction
  flagged `excludeFromSpending`, or a transfer-paired row is left out of
  spending, income, budget actuals, merchant rollups, and the trend chart;
  uncategorized rows otherwise count. Spending is negative `amountCents`
  rendered as a positive total; a linked positive refund is a spending
  reduction in its own active category/splits and is not income.
- **Transaction splits**: a transaction can be divided across categories in
  `transaction_splits` (migration 0004). When a transaction has ≥1 split rows the
  splits define its categorization for **every** spending aggregate and its own
  `categoryId` is ignored; the splits' signed amounts must sum to the
  transaction `amountCents`. `replaceSplits()` owns parent existence, safe
  nonzero parts, safe accumulation, exact sum, and category references inside
  an immediate SQLite transaction; actions only decode and format errors. Parent
  amount edits are refused while a valid split exists, and every ordinary parent
  edit is refused when historical parts do not match. `getSplitMismatches()` is
  the read-only maintenance audit; the edit page blocks ordinary fields and
  offers only explicit allocation repair or clear for a mismatch. The DB itself
  only cascades split deletes when the transaction is deleted. All four
  aggregates read `spendingLineItems()` in `summary.ts` — a UNION of split rows +
  unsplit transactions with the date range pushed into both branches (P1) — so a
  single part can sit in an excluded category without pulling the whole
  transaction in or out of spending. `replaceSplits(id, [])` reverts to the
  single `categoryId`. The transaction list carries `isSplit`; split rows show a
  "Split" badge (linking to the edit page) instead of the category dropdown,
  which would otherwise silently no-op. Edit splits on the transaction edit page.
- **Active category semantics**: `active-category.ts` owns the correlated,
  bound `EXISTS`/`NOT EXISTS` predicates. An unsplit row uses its parent
  category; a split row uses only its parts, including null parts as active
  Uncategorized allocations. List and export filters keep one parent row,
  category stats count distinct active parents, and rule application scans only
  unsplit null parents. Category deletion impact separately discloses distinct
  active transactions, exact matching split parts, and ignored parent fallbacks.
  Transaction pagination accepts only positive safe-integer text, counts first,
  clamps to the fixed 50-row last page, then computes the offset; invalid and
  clamped URLs redirect to a tested canonical path with page 1 omitted.
- **Transaction annotations**: migration 0005 adds defaulted `notes` and `tags`
  text columns. Supported writes normalize notes as bounded safe Unicode text and
  tags as a sorted, lowercase, de-duplicated JSON string array. Service/API reads
  tolerate malformed historical tag JSON by returning an empty array. `q`
  searches description/note/tag text with escaped LIKE literals; `tag` uses a
  bound exact canonical match through guarded `json_each`. Imports leave both
  empty and the frozen import-hash formula is unchanged.
- **Ledger options and relationships**: migration 0006 adds bounded merchant
  text, cleared state, row-level spending exclusion, and optional opening-balance
  dates. Transfer candidates are advisory until an explicit one-to-one pair is
  saved; refund links are explicit, same-account/same-currency, partial-safe,
  and never rewrite either transaction. Duplicate overrides preserve the frozen
  import hash by writing null-hash provenance rows keyed to source fingerprint
  and source row.
- **Running balance and currency groups**: account-filtered transaction lists
  show the opening balance plus rows ordered by date, creation time, and ID.
  Mixed valid currencies render separate exact dashboard groups; invalid account
  currencies remain a repair blocker and render no partial group.
- **Transaction export**: `/api/export` delegates all SQLite work to the
  dedicated `server/services/transaction-export.ts` service. It opens a
  read-only `fileMustExist` connection, starts a deferred transaction to retain
  one WAL snapshot, and streams 500-parent keyset pages ordered by
  `(date, createdAt, id)` with one bounded split query per nonempty page. Normal
  completion commits/closes; errors and cancellation roll back/close. Omitted
  format and `legacy` preserve the exact five-column header and refuse
  mixed/invalid selected currency before bytes; `detailed` adds Currency and
  deterministic split JSON and permits mixed valid currencies. `annotated`
  preserves that shape and appends Notes and deterministic tag JSON. The
  Transactions UI deliberately requests annotated. `lib/csv/transaction-export.ts` owns exact
  cent serialization, RFC 4180 quoting, binary/null-last split ordering, ISO-date
  validation, and export-only formula protection for text cells. Never replace
  this path with an unbounded list materialization or a route-owned DB handle.
- **Budgets**: `categories.monthlyBudgetCents` is a nullable positive-cents
  target (null = no budget). `getBudgetVsActual(month)` LEFT-JOINs each budgeted
  included category to its month outflow, computing spend the same way as
  spending math (negative outflows minus explicitly linked refunds) so an
  included zero-spend budget still shows. Excluded categories retain their
  stored budget but remain absent from progress until re-included.
- **Currency**: account writes require one renderable, normalized three-ASCII-
  letter code; create forms default to `USD`. Reads preserve `rawCurrency` and
  attach a value-free valid/invalid state so legacy bad values remain repairable
  without formatter crashes or read-time writes. `CurrencyState` is
  empty/single/mixed/invalid. Net-worth and dashboard aggregate DTOs expose
  numeric values only for one valid shared currency with safe exact sums;
  empty/mixed/invalid/unsafe states use null compatibility scalars and suppress
  cross-account cards, charts, and budgets. Per-account and transaction money
  formats only through its validated code. There are no rates or conversions.
  Money deltas use the `--delta-good` / `--delta-bad` tokens, always paired with
  text (never color alone) per the CVD-safe palette rule.
- **Input safety**: zod-validate every external input, then enforce persisted
  domain invariants again in the writing service. Drizzle query builder or
  parameterized `sql` fragments only — never string-built SQL. CSV files are
  capped at 5 MiB and the measured multipart request at 5 MiB + 64 KiB; CSV
  text only.
- Account balance = `openingBalanceCents + SUM(amountCents)`; Net Worth =
  sum across accounts (credit cards naturally negative). Coalesce empty
  SUMs to 0.

## Commands

- `npm run dev` — dev server at http://127.0.0.1:3100 (3000 is taken by
  another local service; loopback-only by default — the app has no auth.
  `dev:lan` / `start:lan` bind 0.0.0.0 as an explicit opt-in)
- `npm run db:backup [-- --keep N]` — WAL-safe online backup to the
  `backups/target-<24-hex-path-hash>/` namespace beside the resolved
  `DB_FILE_NAME` target. Each normalized target has isolated retention. It uses an exclusive
  UUID partial, standalone journal normalization, integrity/FK/reviewed-schema
  validation, file fsync, atomic no-clobber hard-link publication, two directory
  fsync barriers around staging unlink, and validity-aware retention. Optional
  `--keep N` prunes only older validated exact-name finals. Logical failures are
  private `.invalid` quarantines; indeterminate complete captures remain
  `.partial`. Neither class is a restore/retention candidate. Root-level legacy
  and unscoped artifacts are audited but never pruned. POSIX success reports
  confirmed directory-fsync durability and enforced modes; native Windows
  reports platform-best-effort durability and unverified ACL privacy.
- `npm run db:verify-backup -- /absolute/path` — read-only standalone backup
  verifier. It rejects the live target/aliases/sidecars/working artifacts,
  validates integrity, foreign keys, exact reviewed migration prefix, and the
  schema fingerprint generated from hash-pinned migration SQL, and prints only
  status/schema revision. It never imports the auto-migrating client.
- `npm run audit:data-path` — read-only strict preflight plus normalized target,
  repository/Git-boundary classification, backup root/target namespace, and
  direct parent/main/WAL/SHM/recognized-backup mode enforcement (`0700`/`0600`
  on POSIX) with exact non-recursive
  remediation. Windows ACL privacy is reported as unverified. The audit must not
  import the DB client or SQLite, query tables, print environment values, or
  create/modify the repository, database target, parent, or sidecars. Its direct
  no-cache TypeScript loader avoids the `tsx` CLI child/IPC/cache path.
- `GET /api/health` — liveness probe (`{ok:true}` / 500) for uptime
  monitoring; `deploy/` holds intentionally unresolved systemd service
  templates plus the backup timer. `scripts/render-systemd-units.mjs` validates
  one stable absolute Node/npm install-build pair, the Node engine floor, exact
  installed Next and local tsx CLIs, a conservative non-root service account,
  lifecycle PATH, canonical project root, template tokens, and staging-only
  output before rendering installable files; raw templates are never installed
  or hand-edited. Rendered services invoke Node → Next/tsx directly without npm,
  retain loopback/telemetry/private-umask policy, and run metadata-only
  `scripts/service-preflight.ts` under `NoNewPrivileges=true`. That gate verifies
  a non-root effective UID, the rendered root/cwd,
  runtime/umask/no-new-privileges state, reviewed migration assets, build
  metadata/writable cache, private DB/WAL/SHM access, and existing backup
  destinations without importing SQLite, creating paths, or repairing modes.
  The early Next preload pins the root-`.env` database selection/default and
  graceful signal behavior before Next's own production environment loading.
- `GET /api/export?q=&tag=&account=&category=&month=&from=&to=` — the filtered
  transaction view as the five-column compatibility CSV; add
  `format=detailed` for Currency and Split Details or `format=annotated` for
  Notes and Tags (the UI uses annotated)
- `npm run build` / `npm start` — production build / serve. Build runs through
  the mandatory external temporary-database wrapper and then scans every NFT
  manifest; start deliberately opens the configured runtime ledger.
  `check:build-privacy` reruns the manifest gate, while the slower
  `validate:build-privacy` performs ordinary and standalone builds, complete
  copied-tree/symlink scans, and loopback health smokes in an allowlisted
  temporary workspace containing synthetic runtime sentinels only. Product
  config leaves standalone output disabled. `smoke:dev` / `smoke:start` run a
  bounded loopback health check on a temporary ledger (`smoke:start` needs a
  build). Safe validation wrappers require POSIX process-group ownership
  (Linux, macOS, or WSL) and fail before lease creation on native Windows;
  ordinary dev/start support remains unchanged. Every Next launcher loads
  `scripts/next-telemetry-disabled.cjs` before the framework CLI.
- `npm test` / `npm run test:watch` — Vitest through the same outer cleanup
  wrapper; setup gives every test file a fresh implicit temporary DB. Single file:
  `npm test -- src/lib/categorize.test.ts`; by name:
  `npm test -- -t "dedupe"`
- `npm run lint` — ESLint through a temporary lease that fails if lint opens DB
  artifacts
- `npm run db:generate` — generate a new append-only migration from schema
  changes; never regenerate or edit migrations 0000–0005; migration 0006 is
  the current append-only ledger-options revision
- `npm run db:migrate` — apply migrations (also auto-applied on startup;
  default categories install automatically when the table is empty). Historical
  migrations 0000–0005 are byte-locked compatibility assets.
- `npm run db:seed` — one-time fail-closed demo initializer; requires an
  existing current schema with no ledger rows and either no categories or the
  exact untouched defaults, refuses repeat/custom targets, and has no force flag
- `npm run db:restore -- --backup <absolute-path> --target <absolute-path>` —
  preview a guarded restore without changes; add `--confirm --quiesced` only
  after stopping every writer. The target must be the configured canonical
  ledger, the backup must be a validated standalone image, and the retained
  rescue is never removed automatically.
- `npm run db:studio` — Drizzle Studio DB browser
- `npm run import -- --file <csv> --account "<name>" [--type CHECKING] [--currency USD] [--date-format MDY] [--col-date "<header>"] [--col-amount "<header>"] …` — file-atomic CLI import; ambiguous auto dates and malformed rows/maps refuse before DB access, while a ready by-name account and all import rows share one immediate transaction. `--col-*` flags use the same strict mapping contract as `/api/import` and the Advanced UI.

## Other docs

- `IMPLEMENTATION_GUIDE.md` — audit-remediation north star: immutable contracts,
  decision records, dependency-ordered work packages, rollback, and acceptance
  tests. The selected WP-00 through WP-18 packages and the 2026-07 product
  decision checkpoint are implemented; the guide records the passed Firefox
  keyboard/focus matrix and the pending screen-reader and real-host release
  gates. Read it before
  changing a remediation contract or selecting deferred work.
- `TODO.md` — historical/product backlog and shipped milestones. Its IDs
  (P1–P7 perf, Q1–Q9 code quality, O1/O2 ops, F#/… features) are the same tags
  used in commit-message prefixes; `IMPLEMENTATION_GUIDE.md`, not backlog rank,
  controls the current remediation order.
- `USER_MANUAL.md` — end-user, plain-English feature guide. Consult it when a
  change affects user-facing behavior so the manual stays in sync.
- `README.md` — setup, home-server (systemd) and Tailscale/PWA deployment.

## Git

Repo already initialized; do not commit unless explicitly asked.
