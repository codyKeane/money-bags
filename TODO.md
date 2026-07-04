# Remaining work

Status after the foundation build (commit `a17fad3`) **plus the TODO
milestone** (CSV correctness fixes, bootstrap/data-safety hardening,
categories/accounts/manual-transaction management, filters + pagination —
all sections 1–3 items below except the GitHub push, verified end-to-end).

## 1. Critical — fix before importing real statements — ✅ DONE

- [x] **CSV header collision: `Description` + `Memo` in the same file.**
  Fixed via priority-ordered header resolution (`resolveHeaderColumns` in
  `src/lib/csv/parse-statement.ts`): Description beats Memo, Transaction
  Date beats Posted Date, columnMap overrides displace synonyms, duplicate
  headers → first wins, losers disabled. Note: files previously imported
  through the buggy path hashed corrupted text — see the dedupe changelog
  note in CLAUDE.md before re-importing them.
- [x] **European decimal-comma amounts + magnitude bound.** Unambiguous
  trailing `,dd` now parses as a decimal comma; mixed forms (`1.234,56`)
  are rejected as row errors; `Number.isSafeInteger` cap added. Bonus fix:
  negative Debit values keep their sign (refunds are inflows).

## 2. High priority — bootstrap & data-safety gaps

- [x] **Category management** — `/categories` page: create/edit keywords/
  color/excludeFromSpending/delete; default category set decoupled from the
  demo seed (`src/lib/default-categories.ts`) and auto-installed on an
  empty database.
- [x] **Re-run keyword rules over uncategorized rows** — "Apply rules to
  uncategorized" button on `/categories` and `/transactions`; never touches
  manually categorized rows.
- [x] **Auto-apply migrations on startup** — `migrate()` runs in
  `createDb()`; a fresh clone boots with `npm run dev` alone.
- [x] **WAL-safe DB backup** — `npm run db:backup` (better-sqlite3 online
  backup API) → `data/backups/`; restore procedure documented in README.
- [ ] **Push the repo off this box.** STILL BLOCKED: the Claude GitHub App
  lacks write access to `codyKeane/money-bags` (push → 403). A verified
  full-history git bundle was delivered to the user as fallback. Grant the
  app repo access (GitHub → Settings → Integrations → Applications →
  Claude) or push the bundle from the laptop. (S)
- [x] **Bind to loopback by default** — `dev`/`start` bind 127.0.0.1;
  `dev:lan`/`start:lan` are the explicit LAN opt-in.

## 3. High priority — features a real user needs next — ✅ DONE

- [x] **Manual transaction add/edit/delete** — add form on `/transactions`,
  per-row Edit page + confirmed Delete; manual rows keep `importHash` null.
- [x] **Accounts page** — `/accounts`: balances + transaction counts,
  create/edit incl. institution and signed opening balance, delete gated on
  a server-verified typed account name; dashboard Net-worth tile links to it.
- [x] **Transactions: pagination, search, filters** — URL-driven search
  (LIKE-escaped), account/category (incl. Uncategorized)/month filters,
  offset pagination (50/page) with a "Showing X–Y of N" footer.

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
