# Remaining work

Status after the foundation build (commit `a17fad3`): schema + migrations,
seeded ledger, tested CSV ingestion (CLI + UI) with idempotent dedupe,
dashboard/transactions/import pages — all verified end-to-end on port 3100.
This is what still needs to be done, from a three-lens audit (correctness,
hardening, user-facing completeness) with every high-priority item
independently re-verified against the code.

## 1. Critical — fix before importing real statements

These two silently corrupt ingested data, and corrupted values get frozen
into the dedupe hash (`importHash`), so cleanup after the fact is painful.

- [ ] **CSV header collision: `Description` + `Memo` in the same file.**
  `HEADER_SYNONYMS` maps description/memo/payee/details to one canonical
  field and the last duplicate column wins, so `Date,Description,Memo,Amount`
  stores the *memo* as the description (and an empty memo blanks it →
  row rejected). Corrupts categorization input and the import hash. Same
  applies to `Transaction Date` + `Posted Date`. Fix: priority order in the
  `columns()` callback of `src/lib/csv/parse-statement.ts`; first/most
  specific header wins, later synonyms disabled. (effort M)
- [ ] **European decimal-comma amounts misparse 100×; no magnitude bound.**
  `parseAmountToCents("45,00")` → $4,500.00 (comma stripped as thousands
  separator) — silent 100× inflation, and the parser explicitly strips €/£
  so such files are in scope. Also `"99999999999999999.99"` → 1e19, past
  `Number.MAX_SAFE_INTEGER`, which SQLite stores as REAL in the INTEGER
  cents column. Fix: reject/optionally support trailing `,\d{2}` decimals
  and add a `Number.isSafeInteger` cap in the same function; add tests.
  (effort S)

## 2. High priority — bootstrap & data-safety gaps

- [ ] **Category management exists only in the demo seed.** A real user who
  imports without seeding gets zero categories: auto-categorization is
  inert and the recategorize dropdown offers only "Uncategorized". Split
  default categories (keywords/colors/excludeFromSpending) out of the demo
  seed, add a categories service + minimal `/categories` UI (create, edit
  keywords, excludeFromSpending). (M)
- [ ] **Re-run keyword rules over uncategorized rows.** `categorize()` only
  runs at import, so keyword edits never touch existing rows. Add an
  "Apply rules to uncategorized" action (`WHERE categoryId IS NULL`,
  preserving manual choices). (S)
- [ ] **Auto-apply migrations on startup.** Fresh clone + `npm run dev`
  without `db:migrate` → stub DB file + opaque 500 ("no such table").
  Call drizzle's `migrate()` inside `createDb()` (already proven in
  `src/server/services/import.test.ts`). (S)
- [ ] **WAL-safe DB backup script.** No backup story for the most valuable
  file in the system; naive copy while the server runs loses transactions
  sitting in `finance.db-wal`. Add `npm run db:backup` using better-sqlite3's
  online `db.backup()` / `VACUUM INTO`, document restore. (S)
- [ ] **Push the repo off this box.** No git remote is configured and this
  container is ephemeral — the code currently exists in exactly one place.
  Add a private remote (or `git bundle` to the NAS) and push `main`. (S)
- [ ] **Bind to loopback by default.** `next start` binds 0.0.0.0 with zero
  auth; any LAN device can read every transaction and POST imports (route
  handlers have no CSRF protection). Default to `-H 127.0.0.1` and make LAN
  exposure an explicit, documented choice — full auth remains out of scope.
  (S)

## 3. High priority — features a real user needs next

- [ ] **Manual transaction add/edit/delete.** The schema already anticipates
  it (`importHash` nullable "for manually created rows") and the import UI
  literally tells users to "add it manually" for the cross-file dedupe edge
  case — but no such feature exists. (M)
- [ ] **Accounts page.** Per-account balances are computed but shown
  nowhere; UI-created accounts can't set/fix an opening balance, making net
  worth wrong for accounts with pre-import history. List + create/edit
  (name, type, institution, opening balance) + guarded delete. (M)
- [ ] **Transactions: pagination, search, filters.** Hardcoded latest-100;
  no way to find older rows or answer "what did I spend at X". Filtered/
  paginated service query (description search, date range, account,
  category incl. uncategorized), driven by URL searchParams. (L)

## 4. Medium priority

- [ ] Debit-column reversals: negative debit values are force-flipped to
  outflows (`-Math.abs`) — respect sign for refunds. (S)
- [ ] Unmatched-header diagnosis: non-English/odd CSVs flood N identical
  "Missing date" row errors instead of one "no Date column found — use
  columnMap" message. (S)
- [ ] Expose the (implemented, tested, unreachable) `columnMap` override in
  the import UI + CLI. (M)
- [ ] Warn when `auto` date format falls back to MDY on fully-ambiguous
  files (day ≤ 12 throughout) — wrong guesses freeze into hashes. (M)
- [ ] Decide refund semantics: positive amounts in expense categories
  currently count as income and vanish from category spending. (M)
- [ ] Error boundaries (`error.tsx`) + try/catch → JSON errors in API
  routes; ImportForm calls `res.json()` on non-JSON 500 bodies today. (M)
- [ ] Enforce the 5 MB upload cap via Content-Length *before* buffering the
  whole multipart body. (S)
- [ ] Guard `db:seed` when the DB already holds non-seed (real) data. (S)
- [ ] Bulk recategorize (checkbox selection + one action). (M)
- [ ] CSV export of the full ledger (data sovereignty). (S)
- [ ] Mobile layout: collapsible sidebar, responsive tables. (S)
- [ ] Pin Node: `engines` field + `.nvmrc` (repo requires Node ≥ 20.12 for
  `process.loadEnvFile`; better-sqlite3 ABI tied to Node major). (S)
- [ ] systemd unit example for start-on-boot on the home server. (M)
- [ ] Tests for `src/lib/month.ts` (year-boundary `addMonths`) and
  `getSpendingTrend` window math. (S)

## 5. Low priority

- [ ] Anchor DB path to project root instead of `process.cwd()` (scripts run
  from another cwd create a second DB).
- [ ] Friendlier mutation errors (FK violation on recategorize with a stale
  category id; createAccount duplicate race).
- [ ] Month jump picker bounded by first/last data month.
- [ ] Chart accessibility: Recharts `accessibilityLayer` (keyboard focus),
  non-hue series distinction beyond the table view.
- [ ] Document `npm ci` as the reproducible install for offline-first use.

## Deferred by design (unchanged from the build plan)

Budgets/goals, recurring-transaction detection, multi-currency conversion,
full auth, Docker packaging, double-entry ledger, OFX/QIF import,
bank-transaction-id dedupe (would eliminate the split-file duplicate edge
case).
