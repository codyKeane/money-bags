# Finance Engine

A private, **100% locally self-hosted** personal finance engine. Your
financial data never leaves your machine: no external financial APIs, no
telemetry, no CDN assets, no remote fonts. The only network access this
project ever performs is `npm install` at development time.

- **Ledger**: SQLite (WAL mode) via Drizzle ORM — signed integer cents,
  date-only ISO transaction dates
- **Ingestion**: file-atomic CSV bank-statement import (CLI + web UI) with
  occurrence-aware hash dedupe and keyword auto-categorization
- **Dashboard**: net worth, monthly spending by category, income-vs-spending
  trend, recent transactions, and an uncategorized-review count — light/dark,
  built on Next.js + Recharts

## Getting started

```bash
npm install
npm run db:migrate   # create data/finance.db
npm run dev          # http://localhost:3100
```

The app listens on **port 3100** (3000 is assumed taken) and binds
**127.0.0.1 only** by default — there is no authentication, so exposing it
to your LAN is an explicit choice: use `npm run dev:lan` / `npm run
start:lan` to bind all interfaces. For production: `npm run build && npm
start`. Migrations and the default category set are applied automatically
on startup. A fresh default-category install is atomic: startup records the
complete set or rolls it all back. Once any category exists, startup leaves the
table exactly as-is and never guesses how to repair missing built-ins.

**Safe validation targets:** `npm test`, `npm run lint`, and `npm run build`
run through a fail-closed wrapper that replaces `DB_FILE_NAME` with a unique
database below the OS temporary directory. Tests narrow that further to a fresh
target per test file. The wrapper removes the temporary database and SQLite
sidecars after success, failure, Ctrl+C, or a catchable termination signal.
`npm start` is deliberately different: it opens the configured real ledger at
runtime. A successful build now also scans every generated NFT manifest and
fails if runtime data, private environment files, operator-only code, or a
required migration/native/preload asset violates the packaging policy. Use
`npm run validate:build-privacy` for the slower release check: it makes an
allowlisted temporary copy, performs ordinary and standalone builds, scans the
complete standalone tree and symlink targets, and health-checks both outputs
using synthetic temporary ledgers. Product configuration does not enable
standalone output. An uncatchable kill or power loss can leave a uniquely
marked temporary directory for manual removal. These validation wrappers
currently require Linux, macOS, or WSL; on native Windows they fail before
creating a lease because reliable descendant-process cleanup is not available.
Normal `npm run dev` / `npm start` runtime support is unchanged. Every Next
launcher preloads the intrinsic telemetry opt-out before the framework loads;
the source `.env.example` setting is defense in depth rather than the guarantee.

**Demo seed:** `npm run db:seed` is a one-time, fail-closed initializer for an
existing, explicitly migrated disposable database. It succeeds only when there
are no accounts, transactions, import batches, or splits and categories are
either absent or exactly the untouched built-ins. Every other target—including
a previously seeded target—refuses without changes; there is no force flag.
For example, create a separate target and keep the same explicit setting for
both commands:

```bash
DB_FILE_NAME=data/demo.sqlite npm run db:migrate
DB_FILE_NAME=data/demo.sqlite npm run db:seed
```

The seed prints its normalized target, never creates or migrates a missing or
old-schema file, and never refreshes existing category/account settings. Do not
reuse that demo target for personal data.

**Backups**: run `npm run audit:data-path` to print the normalized active target,
its sibling backup root, and the target-scoped directory derived from the
normalized database path without opening SQLite. `npm run db:backup` creates a
private WAL-safe online image under
`backups/target-<24-hex-path-hash>/`, validates its integrity, foreign keys, and
reviewed schema, fsyncs it, and publishes it without overwriting an existing file as
`moneybags-<UTC-millisecond-stamp>-<UUID>.sqlite3`. It is safe while the server
runs. Each configured database path has a separate retention namespace, so two
ledgers in one parent cannot prune each other's backups. Changing the database
path selects a new namespace. `npm run db:backup -- --keep 14` retains the 14
newest validated finals in only that namespace;
working `.partial`, quarantined `.invalid`, unrelated, linked, and invalid
images are never retention candidates. Legacy `finance-*.db` and unscoped files
directly under `backups/` remain visible to the audit but are preserved and are
never pruned automatically. An external `DB_FILE_NAME` has an external sibling
backup root that you must protect and include explicitly in your backup plan.
On POSIX, success reports confirmed durability and enforced private modes. On
native Windows, success explicitly reports platform-best-effort durability
because directory fsync is unavailable and reports ACL privacy as unverified.

Before a manual restore, validate one explicit absolute standalone path:

```bash
npm run db:verify-backup -- /absolute/path/to/moneybags-...sqlite3
```

The verifier is read-only, refuses the configured live target, aliases,
sidecars, partial/quarantined images, unknown/newer migrations, and mismatched
schemas, and prints only validity plus schema revision. Do not copy a backup
over a live target or delete sidecars. Follow the stopped-service, verified
rescue, same-directory restore-ready, and quarantine/rollback procedure in
[the user manual](USER_MANUAL.md#restore-from-a-backup-manual-offline-procedure).
Automated restore is intentionally not provided.

**Database path policy**: when `DB_FILE_NAME` is relative, it is resolved from
the repository root and must stay below `data/` (for example,
`data/ledgers/home.sqlite`). A target outside the repository must be configured
as its canonical absolute path. Empty values, traversal, symlink aliases, and
in-repository targets outside `data/` are refused before a directory or SQLite
file is created. Startup also validates the root `.env` as UTF-8 assignment
syntax and verifies the migration journal plus reviewed SQL hashes before
opening the ledger; a missing `.env` is the only ignored environment-file
condition. Everything below `data/` is excluded from Git except explicitly fake
files below `data/samples/`. The read-only `npm run audit:data-path` command
checks that an in-repository target is below `data/` and ignored, reports the
target, backup root, target-scoped backup directory, recognized backup
artifacts, and direct parent/file/WAL/SHM POSIX modes when available, requires
existing POSIX directories/files to use exact private modes `0700`/`0600`, and
gives exact non-recursive remediation without querying ledger tables or changing
permissions. On Windows it explicitly reports that ACL privacy is unverified.

On POSIX, application and operational Node processes that may create SQLite
storage set `umask 0077` before the first open and intentionally retain that
process-global setting, so later files created by that process inherit a private
default. This complements the service `UMask=0077`; it does not set or verify
Windows ACLs.

If an older installation points to a ledger elsewhere inside this checkout,
do not start the new version and do not let it create a replacement default.
While the old version still accepts that path, stop all writers and make and
verify a backup. Then explicitly restore or move that offline ledger below
`data/`, update `DB_FILE_NAME`, and only then start the new version. An older
relative path that resolves outside the checkout can instead be written as its
canonical external absolute path. The application never relocates a ledger
automatically.

## Run on a home server

Choose one system-wide or NVM-managed Node runtime. Node ≥ 20.12 is required
(`.nvmrc` pins 22). Record a stable absolute executable named `node` and its
matching absolute `npm-cli.js`; do not put an interactive `nvm` command or an
NVM version-directory path directly in a unit. For NVM, maintain stable
operator-owned paths such as `/opt/moneybags-runtime/bin/node` and
`/opt/moneybags-runtime/lib/npm-cli.js`, update their symlink targets only after
verification, and ensure the service user can traverse them.

Use the selected pair for the reproducible install and build. Keeping its bin
directory first also pins the bare `node` and local `tsx` lifecycle commands:

```bash
NODE_EXECUTABLE=/absolute/stable/path/bin/node
NPM_CLI_JS=/absolute/stable/path/lib/npm-cli.js
NODE_BIN_DIRECTORY=/absolute/stable/path/bin
SERVICE_USER=finance
PROJECT_ROOT="$(pwd -P)"

PATH="$NODE_BIN_DIRECTORY:$PATH" "$NODE_EXECUTABLE" --version
PATH="$NODE_BIN_DIRECTORY:$PATH" "$NODE_EXECUTABLE" "$NPM_CLI_JS" --version
test ! -e node_modules/.bin/node
PATH="$NODE_BIN_DIRECTORY:$PATH" "$NODE_EXECUTABLE" "$NPM_CLI_JS" ci
test ! -e node_modules/.bin/node
PATH="$NODE_BIN_DIRECTORY:$PATH" "$NODE_EXECUTABLE" "$NPM_CLI_JS" run build
```

The files in `deploy/` are intentionally unresolved templates and must never be
copied directly. Render them into a new staging directory through that same
Node. The renderer validates the Node engine floor, runs the matching npm CLI,
resolves and runs the installed Next and tsx CLIs under that Node, requires the
exact installed Next dependency, rejects unsafe paths, root/unsafe service
accounts, and a dependency-provided `node`, and refuses unknown or unresolved
unit tokens. It renders the current canonical project root and service account;
do not hand-edit either value afterward:

```bash
UNIT_STAGE_ROOT="$(mktemp -d)"
UNIT_STAGE="$UNIT_STAGE_ROOT/units"
PATH="$NODE_BIN_DIRECTORY:$PATH" "$NODE_EXECUTABLE" scripts/render-systemd-units.mjs \
  --node "$NODE_EXECUTABLE" \
  --npm-cli "$NPM_CLI_JS" \
  --service-user "$SERVICE_USER" \
  --output "$UNIT_STAGE"
```

Verify the rendered files together without editing them. This check parses units
but does not install, enable, or start them:

```bash
if rg -n '@@[A-Z0-9_]+@@|/usr/bin/npm' "$UNIT_STAGE"; then
  echo "refusing unresolved systemd units" >&2
  exit 1
fi

SYSTEMD_UNIT_PATH="$UNIT_STAGE:" systemd-analyze \
  --system --generators=no --man=no --recursive-errors=yes verify \
  "$UNIT_STAGE/finance.service" \
  "$UNIT_STAGE/finance-backup.service" \
  "$UNIT_STAGE/finance-backup.timer"
```

Before installation, run `npm run audit:data-path`, resolve ownership explicitly,
and apply only the audit's exact non-recursive permission remediation as an
operator. The configured DB parent must already be canonical, writable by the
service account, and exact mode `0700`; an existing DB/WAL/SHM must be regular,
accessible, and exact mode `0600`.
The production build, `BUILD_ID`, and `required-server-files.json` must be
readable, and `.next/cache` must be writable/traversable by the service account.
An existing backup root and target namespace must be writable and exact mode
`0700`. Preflight reports these problems but never creates, repairs, or opens the
database.

Confirm the selected executable and both resolved local CLIs work without a
shell profile as the rendered account. Only then install the rendered files:

```bash
env -i PATH="$NODE_BIN_DIRECTORY:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin" \
  "$NODE_EXECUTABLE" --version
sudo -u "$SERVICE_USER" env -i \
  PATH="$NODE_BIN_DIRECTORY:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin" \
  "$NODE_EXECUTABLE" --version
sudo -u "$SERVICE_USER" env -i \
  PATH="$NODE_BIN_DIRECTORY:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin" \
  "$NODE_EXECUTABLE" --require "$PROJECT_ROOT/scripts/next-telemetry-disabled.cjs" \
  "$PROJECT_ROOT/node_modules/next/dist/bin/next" --version
sudo -u "$SERVICE_USER" env -i \
  PATH="$NODE_BIN_DIRECTORY:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin" \
  "$NODE_EXECUTABLE" "$PROJECT_ROOT/node_modules/tsx/dist/cli.mjs" \
  --no-cache --version
sudo cp "$UNIT_STAGE"/finance*.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now finance             # the app (restarts on failure)
sudo systemctl enable --now finance-backup.timer # daily db:backup --keep 14
```

The services invoke Node → Next and Node → tsx directly; npm is used only for
the operator-owned install/build workflow. Both units set `UMask=0077`,
`NoNewPrivileges=true`, production/telemetry environment, and the rendered root.
Preflight fail-closes if its effective UID is root or cannot be verified on
POSIX. App preflight additionally verifies the inherited
umask/no-new-privileges state, strict environment/path/migration policy, build
metadata/cache access, and database storage. Its early preload pins the same
root-`.env` database selection before Next can load production environment
variants and pins Next's graceful signal handler on. Backup preflight requires a
source and checks any existing backup destinations. The app remains explicitly
bound to `127.0.0.1:3100`; Next exit status 143 after a drained SIGTERM is treated
as a clean stop.

On every Node/npm or dependency upgrade, deliberately update the stable runtime
pair, repeat install/build/render/token/version/systemd verification, and
reinstall freshly rendered units. Keep the prior verified pair and rendered
units for rollback; never fall back to `/usr/bin/npm`, an interactive shell
profile, or a version-specific NVM path. A real-host reboot/start, loopback
socket check, SIGTERM/restart-policy check, and timer-created synthetic backup
remain operator gates after installation.

Logs go to journald (`journalctl -u finance -f`). Health check for uptime
monitoring: `curl 127.0.0.1:3100/api/health` → `{"ok":true}` (it doesn't
touch balances, unlike `/api/accounts`). Reach it remotely via Tailscale
(below).

## Remote access (Tailscale)

The app stays loopback-bound; [Tailscale](https://tailscale.com) extends
who can reach it without opening any port to the internet:

1. Install Tailscale on the server and on your phone/laptop; `sudo
   tailscale up` on each and sign into the same tailnet.
2. On the server, run `tailscale serve --bg 3100` and note the exact HTTPS
   address it assigns, such as `https://<host>.<tailnet>.ts.net`.
3. Set `EXTRA_ALLOWED_ORIGINS` to that complete HTTPS origin in the app's root
   environment configuration. Multiple exact origins are comma-separated;
   HTTP URLs, paths, wildcards, and suffix patterns are refused.
4. For production, run `npm run build` with that configuration present, then
   restart `npm start` with the same configuration. A restart of an old build
   does not adopt a changed origin list. Development mode needs a restart.
5. Open the configured HTTPS address from a tailnet device. Tailscale provides
   the TLS certificate automatically.

Privacy properties: traffic is end-to-end WireGuard-encrypted between your
own devices; your financial data never touches a third-party server
(Tailscale's coordination service sees connection metadata only — use
[Headscale](https://github.com/juanfont/headscale) if you want that
self-hosted too). The local binding does not change: on the LAN the app still
answers only on 127.0.0.1 unless you use the `:lan` scripts. The app has no
auth — tailnet membership is the access boundary, so scope your tailnet
(or its ACLs) accordingly.

Browser mutations accept only the exact direct origin or an exact configured
HTTPS proxy origin. The upload route and every Server Action enforce that full
scheme/host/port boundary; wildcard `*.ts.net` trust is intentionally absent.
Global response headers also deny iframe embedding. These checks prevent
cross-origin browser mutation and clickjacking; they do not add authentication.

**Install as an app (PWA)**: browse the `ts.net` URL, then — Android
Chrome: accept the install prompt (or ⋮ → "Add to Home screen"); iOS
Safari: Share → "Add to Home Screen". You get a home-screen icon and a
standalone window. There is deliberately no offline mode: the ledger lives
on the server.

## Importing statements

Via the web UI (`/import`), or the CLI:

```bash
npm run import -- --file statement.csv --account "Everyday Checking" [--type CHECKING] [--currency USD] [--date-format MDY]
```

Accepted CSVs: `Date,Description,Amount` or split `Debit`/`Credit` columns;
header synonyms (Posted Date, Memo, Payee, …) with sensible priority when a
file carries several (Description beats Memo, Transaction Date beats Posted
Date); `$1,234.56`, `(96.31)`, `45.00-`, and unambiguous European `45,00`
amount forms (mixed forms like `1.234,56` are rejected as row errors, never
guessed); ISO/MDY/DMY dates. In split columns, zero is an inactive side,
negative Debit values are refunds, and negative Credit values are reversals;
two nonzero sides refuse the file. Auto date mode refuses ambiguous dates until
you select MDY or DMY. Every row and explicit column map is validated before
the database opens: one malformed row/map refuses the whole file without
creating an account, batch, or partial import. Re-importing the same valid file
is safe — duplicates are skipped and reported row by row.

Web uploads allow an exact 5 MiB CSV plus up to 64 KiB of multipart framing and
form fields. The server measures the incoming stream even when the browser omits
or understates `Content-Length`, so the full request cannot be buffered without
that explicit bound. Recorded import names are display metadata only: both web
and CLI imports keep the final `/` or `\\` basename, normalize Unicode, and
reject empty, overlong, dot-only, or control-containing names. Financial API
responses and exports are marked `Cache-Control: no-store`; no permissive CORS
policy is added.

Amounts typed into account, category-budget, transaction, and split forms use
strict exact decimal text: plain digits, an optional leading sign, and at most
two fractional digits. Form input such as `$12.34`, `1,234.56`, `1e2`, or
`1.005` is rejected rather than normalized or rounded; those broader bank
formats are accepted only by the statement parser where documented above.

Every account has a required three-letter currency code (for example `USD`,
`EUR`, or `JPY`). Codes are normalized on explicit save and must be renderable
by the installed JavaScript runtime. One-currency dashboards format every
combined value in that currency. If accounts are mixed, have an invalid legacy
code, or produce a total outside the exact safe-integer range, the app hides
combined net-worth, income, spending, chart, and budget values instead of
relabeling or adding incompatible amounts. Individual valid account and
transaction values remain available; repair invalid codes on the Accounts
page. Money Bags does not convert currencies or fetch exchange rates.

Split allocations are enforced inside the transaction service: a nonempty split
needs at least two safe, nonzero parts whose exact sum equals the current parent
amount. A split parent amount cannot be changed until the split is reviewed and
removed. Historical mismatches are surfaced for explicit repair or clearing and
are never silently rescaled.

## Accessibility and destructive actions

Submitted server-form errors render as linked alert summaries and focus only on
the pending-to-failure transition; known failing fields receive `aria-invalid`
and `aria-describedby`. Active desktop/mobile navigation links expose
`aria-current="page"`, and Escape closes the controlled mobile menu and restores
its toggle.

Transaction/category deletion and import undo require a visible consequence,
move focus to Confirm when armed, restore the trigger on Cancel/Escape, remain
actionable after a refusal, and focus a stable surviving page control after
success. Account deletion keeps its server-verified typed-name guard with an
explicit label and the same cancellation/surviving-focus behavior. Split part
controls are at least 44×44 CSS pixels and include part/category context in
repeated accessible names. The reproducible browser/screen-reader matrix remains
a manual release gate; automated Node tests do not claim to replace it.

## Exporting transactions

The **Export CSV** control on `/transactions` downloads every parent transaction
matching the current filters, not only the visible 50-row page. It uses the
currency-explicit detailed format:

```text
Date,Description,Amount,Currency,Account,Category,Split Details
```

Unsplit rows use their active category or `Uncategorized`. Split rows remain one
full parent-ledger row, use `Category=Split`, and carry deterministic compact JSON
for every allocation. A category filter therefore means “the transaction
contains this active category/allocation”; the export still includes the full
parent amount and all of its split details. Rows are ordered oldest-first by
date, creation time, then stable ID.

Local scripts may keep using `/api/export` or
`/api/export?format=legacy`, whose compatibility header remains exactly:

```text
Date,Description,Amount,Account,Category
```

Because legacy rows have no currency column, a mixed-currency selection returns
a non-cacheable `409` response; use `format=detailed` or filter to one account.
Both formats refuse an invalid stored account currency and direct you to repair
it on **Accounts**. Unknown formats return `400`. Empty selections contain only
the selected format's header.

CSV text fields are spreadsheet-safe by default. A description, currency,
account, category, or split-details cell whose first character after leading
ASCII control/whitespace is `=`, `+`, `-`, or `@` receives one leading
apostrophe before RFC 4180 quoting.
This can be visible to strict CSV consumers, but prevents spreadsheet formula
interpretation; signed numeric Amount cells such as `-12.34` remain numeric and
unchanged. Stored descriptions, categorization, and import hashes are never
modified.

Keep real statement CSVs in the default `data/imports/` directory; it and the
rest of `data/` are gitignored. Only explicitly fake files in `data/samples/`
are trackable. Use `npm run audit:data-path` after changing `DB_FILE_NAME`; a
canonical absolute target outside the repository is outside Git's protection,
so its permissions and backup lifecycle remain the operator's responsibility.

## Release, update, and rollback

Before changing a real installation, record the current code revision, selected
Node/npm pair, rendered units, configured database target, and one freshly
validated backup. Keep that code/runtime/unit set and the backup together until
the update has passed its real-host checks.

Run the fake release matrix without a configured ledger:

```bash
npm test
npm test -- --sequence.shuffle --sequence.seed 171717
npm run lint
node node_modules/typescript/bin/tsc --noEmit
npm run validate:build-privacy
```

The wrappers give tests and builds fresh temporary databases; the privacy
validator builds only an allowlisted copied workspace. Then perform the
operator-owned install/build/render procedure above with the selected Node pair,
verify the rendered units, and complete the documented real-host socket,
SIGTERM/restart, timer-created synthetic-backup, and manual accessibility gates.

For rollback, restore the prior code/runtime/rendered-unit set. If the update did
not migrate the database, keep the current validated ledger. If it did migrate,
do not start older code against the newer schema: keep all writers stopped and
use the manual offline procedure to restore the backup paired with the older code.
Retain the rescue/quarantine until that older revision passes health and ledger
validation. Code rollback and database rollback are related decisions, not one
blind file copy.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` / `npm run build && npm start` | dev / production server on 127.0.0.1:3100 |
| `npm run dev:lan` / `npm run start:lan` | same, bound to all interfaces (no auth — deliberate opt-in) |
| `npm run smoke:dev` / `npm run smoke:start` | bounded loopback health smoke with a temporary ledger (`smoke:start` requires an existing build) |
| `npm run audit:data-path` | Read-only configured target, Git-boundary, backup-location, and mode audit |
| `npm run db:backup [-- --keep N]` | Private, validated WAL-safe backup in the active target's isolated namespace (durability is platform-qualified) |
| `npm run db:verify-backup -- /absolute/path` | Read-only standalone backup integrity/FK/schema verification |
| `npm test` | Vitest suite (parser, categorizer, dedupe, DB integration) |
| `npm run lint` | ESLint |
| `npm run db:generate` / `db:migrate` | create / apply schema migrations |
| `npm run db:seed` | one-time fail-closed initializer for an existing, migrated, empty/default-only disposable ledger |
| `npm run db:studio` | Drizzle Studio DB browser |
| `npm run import -- …` | CLI statement import |

## Architecture

See [CLAUDE.md](CLAUDE.md) for the full architecture map, money/date
conventions, and the dedupe contract.
