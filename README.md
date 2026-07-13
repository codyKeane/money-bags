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
npm run dev          # http://localhost:3100
```

The app listens on **port 3100** (3000 is assumed taken) and binds
**127.0.0.1 only** by default — there is no authentication, so exposing it
to your LAN is an explicit choice: use `npm run dev:lan` / `npm run
start:lan` to bind all interfaces. For production: `npm run build && npm
start`. Migrations and the default category set are applied automatically
on startup.

> **Build-validation warning:** until WP-01D lands, `npm run build` can resolve,
> open, or migrate the configured database. Do not use a real ledger for build
> validation. Project build verification must wait for the temporary-target
> wrapper; follow `IMPLEMENTATION_GUIDE.md` for the guarded non-build checks
> permitted before then.

> **Demo seed warning:** the current `npm run db:seed` command is unguarded.
> Use it only with a new disposable demo ledger. It can update named accounts
> and categories in an existing ledger. If there is any uncertainty, do not run
> it until you have made and validated a backup; a code-level guard is planned
> in WP-03 of `IMPLEMENTATION_GUIDE.md`.

**Backups**: `npm run db:backup` writes a WAL-safe online copy to
the `backups/` directory beside the active database (safe while the server
runs); `npm run db:backup -- --keep 14` also prunes all but the 14 newest. To
restore, first stop the server. Copy the backup over the exact database target
resolved from `DB_FILE_NAME` (the default is `data/finance.db`), remove the
matching `<target>-wal` and `<target>-shm` sidecars if present, then restart.
Never restore a custom-path ledger into the default path by assumption.

## Run on a home server

Use `npm ci` (not `npm install`) for a reproducible install matching the
committed lockfile, then build once:

```bash
npm ci && npm run build
```

Node ≥ 20.12 is required (`.nvmrc` pins 22; `nvm use`). Run it under systemd
with the example units in `deploy/` — edit `User`/`WorkingDirectory`, then:

> The example units currently call `/usr/bin/npm`. That requires a compatible
> system-wide Node/npm installation; systemd does not load an interactive
> shell's NVM environment. Verify that path and version before enabling them.

```bash
sudo cp deploy/finance*.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now finance             # the app (restarts on failure)
sudo systemctl enable --now finance-backup.timer # daily db:backup --keep 14
```

Logs go to journald (`journalctl -u finance -f`). Health check for uptime
monitoring: `curl 127.0.0.1:3100/api/health` → `{"ok":true}` (it doesn't
touch balances, unlike `/api/accounts`). Reach it remotely via Tailscale
(below).

## Remote access (Tailscale)

The app stays loopback-bound; [Tailscale](https://tailscale.com) extends
who can reach it without opening any port to the internet:

1. Install Tailscale on the server and on your phone/laptop; `sudo
   tailscale up` on each and sign into the same tailnet.
2. On the server: `tailscale serve --bg 3100`
3. From any tailnet device, open `https://<host>.<tailnet>.ts.net` —
   Tailscale provides the TLS certificate automatically.

Privacy properties: traffic is end-to-end WireGuard-encrypted between your
own devices; your financial data never touches a third-party server
(Tailscale's coordination service sees connection metadata only — use
[Headscale](https://github.com/juanfont/headscale) if you want that
self-hosted too, and set `EXTRA_ALLOWED_ORIGINS` in `.env` for its custom
domain). The local binding does not change: on the LAN the app still
answers only on 127.0.0.1 unless you use the `:lan` scripts. The app has no
auth — tailnet membership is the access boundary, so scope your tailnet
(or its ACLs) accordingly.

Server Actions are pre-configured to accept `*.ts.net` origins (Next.js
otherwise rejects mutations arriving through a proxy whose Host differs
from the browser's Origin).

**Install as an app (PWA)**: browse the `ts.net` URL, then — Android
Chrome: accept the install prompt (or ⋮ → "Add to Home screen"); iOS
Safari: Share → "Add to Home Screen". You get a home-screen icon and a
standalone window. There is deliberately no offline mode: the ledger lives
on the server.

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

Keep real statement CSVs in the default `data/imports/` directory; it and the
default `data/*.db*` targets are gitignored. A custom `DB_FILE_NAME` is not
guaranteed to be covered by those rules before WP-12B, so keep custom targets
outside the repository or add and verify explicit protection.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` / `npm run build && npm start` | dev / production server on 127.0.0.1:3100 |
| `npm run dev:lan` / `npm run start:lan` | same, bound to all interfaces (no auth — deliberate opt-in) |
| `npm run db:backup` | WAL-safe online backup beside the active database |
| `npm test` | Vitest suite (parser, categorizer, dedupe, DB integration) |
| `npm run lint` | ESLint |
| `npm run db:generate` / `db:migrate` | create / apply schema migrations |
| `npm run db:seed` | unguarded demo seed; new disposable ledgers only |
| `npm run db:studio` | Drizzle Studio DB browser |
| `npm run import -- …` | CLI statement import |

## Architecture

See [CLAUDE.md](CLAUDE.md) for the full architecture map, money/date
conventions, and the dedupe contract.
