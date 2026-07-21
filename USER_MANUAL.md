# Finance Engine — User Manual

A complete, plain-English guide to your private personal-finance app. No prior
finance knowledge required. If you can read a bank statement, you can use this.

**What it is, in one sentence:** Finance Engine is a private money tracker that
runs entirely on *your own computer* — you load in your bank statements, and it
shows you where your money goes.

> **The one thing that makes this app different:** your financial data never
> leaves your machine. There are no accounts to sign up for, no company
> servers, no ads, and no internet connection is used while you run it. The
> data lives in a single file on your computer that only you can see.

---

## Table of contents

1. [Read this first (5-minute overview)](#1-read-this-first)
2. [Money words, explained simply](#2-money-words-explained-simply)
3. [Getting the app running](#3-getting-the-app-running)
4. [A tour of every screen](#4-a-tour-of-every-screen)
5. [Step-by-step recipes](#5-step-by-step-recipes)
6. [How the app thinks (the rules behind the numbers)](#6-how-the-app-thinks)
7. [Importing bank statements (the full reference)](#7-importing-bank-statements)
8. [Using it on your phone](#8-using-it-on-your-phone)
9. [Keeping your data safe (backups)](#9-keeping-your-data-safe)
10. [Command cheat-sheet](#10-command-cheat-sheet)
11. [Troubleshooting & FAQ](#11-troubleshooting--faq)
12. [Glossary](#12-glossary)
13. [Appendix: the built-in categories](#13-appendix-the-built-in-categories)

---

## 1. Read this first

### What the app does

You give it two things:

1. **Accounts** — your real-world money buckets (a checking account, a credit
   card, cash in your wallet).
2. **Transactions** — every time money moves (a paycheck comes in, you buy
   groceries, you pay a bill).

In return, it shows you:

- **Net worth** — everything you own minus everything you owe, as one number.
- **Where your money went** — spending grouped into categories like Groceries,
  Dining, and Housing.
- **The trend** — how your income and spending compare, month by month.

### The mental model (learn this once)

Everything in the app fits into four ideas, and they stack on top of each other:

```
ACCOUNTS  ──hold──►  TRANSACTIONS  ──sorted into──►  CATEGORIES  ──shown on──►  DASHBOARD
(checking,           (a $52 grocery              (Groceries,               (charts and
 credit card)         run on June 3)              Dining, …)                totals)
```

- An **account** holds many **transactions**.
- Each **transaction** gets one **category** (or stays "Uncategorized").
- The **dashboard** adds it all up into charts and totals.

That's the whole app. The rest of this manual is just detail.

### The fastest way to try it

If the app is set up (see [Section 3](#3-getting-the-app-running)), you can load
six months of **fake demo data** into a separate disposable demo ledger. Create
and migrate that target first, then seed the same explicit target:

```bash
DB_FILE_NAME=data/demo.sqlite npm run db:migrate
DB_FILE_NAME=data/demo.sqlite npm run db:seed
```

> **Important:** seeding is a one-time initializer, not a reset command. It
> accepts only an existing current schema with no accounts, transactions,
> imports, or splits and either no categories or the exact untouched built-ins.
> It refuses every other target without changing it, including a target already
> seeded once. There is no force flag. Keep the demo target separate from real
> money.

Then open the disposable demo ledger and explore. Start a separate fresh
database before loading real money.

### Who this manual is for

- People **brand new to personal finance** — every money term is explained the
  first time it appears.
- People who have never **self-hosted** an app — Section 3 walks through it.

You do **not** need to be an accountant, and you do **not** need to understand
the code.

---

## 2. Money words, explained simply

These are the only terms you need. Each one is exactly how the app uses it.

### Transaction

One movement of money. A paycheck is a transaction. Buying coffee is a
transaction. Every transaction has a **date**, a **description** (like
`BLUE DOOR CAFE`), an **amount**, and an **account** it belongs to.

### The sign of money: positive vs. negative (**important**)

The app records each amount as a single number that is either positive or
negative. This is the most important idea in the whole app:

| If money… | The amount is… | Example |
|---|---|---|
| **comes IN** to you | **positive** | Paycheck: `+2600.00` |
| **goes OUT** from you | **negative** | Groceries: `-82.45` |

So a $82.45 grocery run is stored as **`-82.45`**, and a $2,600 paycheck is
stored as **`+2600.00`**. When you type an amount into a form, you include the
minus sign yourself for money going out. This is called a **signed amount**.

Amounts you type into app forms are exact decimal text: use plain digits with
an optional leading `+` or `-` and no more than two digits after the decimal
point. For example, `12`, `-12.50`, `+.5`, and `-.05` are accepted. Currency
symbols, commas, spaces inside the number, exponent notation, and extra decimal
places such as `1.005` or `1.230` are refused instead of rounded. Saved values
always reopen with exactly two decimal places. Bank-statement imports remain
different: the CSV parser also understands documented bank formats such as
`$1,234.56`, parentheses, a trailing minus, and an unambiguous decimal comma.

> **Why it works this way:** using one signed number (instead of separate "money
> in" and "money out" columns) means the app can add up a whole month with plain
> arithmetic. Add every transaction together and a positive result means you
> came out ahead; a negative result means you spent more than you earned.

### Account

A real place your money lives. When you create one, you pick a **type**:

| Type | What it is |
|---|---|
| **CHECKING** | Your everyday bank account — paychecks in, bills out. |
| **SAVINGS** | A bank account for money you're setting aside. |
| **CREDIT_CARD** | A card you borrow on and pay back later. Its balance is money you **owe**, so it shows as a **negative** number. |
| **CASH** | Physical cash in your wallet or a drawer. |
| **INVESTMENT** | A brokerage or retirement account. |

### Opening balance

The amount of money in an account *before* the first transaction you load in.
Say your checking account had **$2,500** in it on the day you started using the
app, but your first statement only covers transactions after that. You set the
**opening balance** to `2500.00` so the running total is correct. It can be
negative — a credit card you already owe $250 on has an opening balance of
`-250.00`. You can also enter an **opening balance date**. The date is retained
for historical balance calculations; Money Bags does not currently draw a
net-worth-over-time chart. Leave it blank when the amount is only a current
baseline.

### Balance

How much is in an account right now. The app computes it for you:

```
Balance  =  Opening balance  +  (all transactions added together)
```

### Net worth

Your single most important number: **everything you own minus everything you
owe.** The app gets it by adding up the balance of every account. Because credit
cards have negative balances, debts subtract automatically. If your checking is
`+$3,000` and your credit card is `-$700`, your net worth is `+$2,300`.

Net worth only makes sense when all your accounts use the **same currency**
(for example, all USD or all EUR). If accounts use different valid currencies,
the dashboard hides the cross-currency scalar and shows a separate exact
financial section for each currency instead. An invalid legacy currency remains
a repair blocker until you fix it on Accounts. Money Bags never guesses an
exchange rate. See the [Troubleshooting & FAQ](#11-troubleshooting--faq) note
on currencies.

### Income vs. spending

- **Income** = money that came in during a month (positive amounts), except for
  positive rows explicitly linked as refunds or rows in a transfer pair.
- **Spending** = money that went out during a month (negative amounts, shown as
  a positive dollar figure so it's easy to read), reduced by explicitly linked
  refunds. A linked refund uses its own category or split allocations.

(One exception — **transfers** — is explained just below.)

### Category

A label that groups similar transactions: `Groceries`, `Dining`, `Housing`,
`Transportation`, and so on. Categories are what turn a long list of
transactions into a useful picture of your spending. The app comes with 12
sensible categories already set up (see the
[appendix](#13-appendix-the-built-in-categories)), and it can sort many
transactions into them **automatically**.

### Uncategorized

A transaction the app couldn't confidently label is left **Uncategorized**.
That's normal — you can label it yourself in one click, and it still counts
toward your income and spending totals.

### Budget (optional)

A **monthly spending target** you can attach to any category — say $500 for
Groceries. Budgets are entirely optional; a category with none behaves exactly
as before. Once you set one, the dashboard shows a **Budget vs actual** bar for
that category: how much you've spent this month against the target, with the bar
turning **red** and reading "Over by …" if you cross it. Refunds and other
categories' spending never affect the bar. Setting a budget changes nothing
about your totals — it's just a goalpost.

### Transfer (and why it isn't spending)

A **transfer** is money you move between your *own* accounts — for example,
paying your credit card from your checking account. No money actually left your
life; it just moved from one pocket to another. If the app counted that $700
credit-card payment as "spending," your spending chart would be wrong.

So the app has a special category called **Transfers** that is marked *"exclude
from income/spending."* Anything in it is ignored by the income and spending
totals and by the spending chart — but it still affects each account's balance,
which is correct. You can also open **Transfers** to review advisory pairs of
equal-and-opposite rows from different same-currency accounts within three
days. Pairing is always explicit; it never guesses or deletes rows.

---

## 3. Getting the app running

Finance Engine runs on your own computer. You start it once, and then you use it
in a normal web browser like any website — except the "website" is running on
your machine.

### What you need

- A computer running macOS, Linux, or Windows.
- **Node.js version 20.12 or newer** (version 22 is recommended). Node is the
  program that runs the app. If you don't have it, install it from
  [nodejs.org](https://nodejs.org).
- A **terminal** (Terminal on macOS, or your shell on Linux/Windows) to type a
  few commands. You only do this part once.

### First-time setup

Open a terminal, go into the project folder, and run these three commands:

```bash
npm install          # 1. download the pieces the app is built from (one time)
npm run db:migrate   # 2. create the empty database file (data/finance.db)
npm run dev          # 3. start the app
```

Then open your browser to:

```
http://127.0.0.1:3100
```

That's it — the app is running.

> **What is `127.0.0.1:3100`?** `127.0.0.1` (also called *localhost* or
> *loopback*) means "this very computer." No one else on your network or the
> internet can reach it — the app is talking only to you. `3100` is the "door
> number" (the *port*) the app listens on.

**Notes:**

- Step 2 is optional in practice — if you skip it, the app sets up its own
  database automatically the first time it starts. Running it yourself just
  makes the first start faster.
- The first time it starts, the app also installs the 12 built-in categories
  automatically, so auto-sorting works right away.

### Try it with demo data (separate disposable ledger only)

Create and migrate a separate disposable target, then load fake data into that
same target:

```bash
DB_FILE_NAME=data/demo.sqlite npm run db:migrate
DB_FILE_NAME=data/demo.sqlite npm run db:seed
```

This creates **two demo accounts** (an *Everyday Checking* and a *Rewards Credit
Card*) and about **six months of realistic transactions** — paychecks, rent,
groceries, gas, Netflix, a credit-card payment, and more. Before writing, the
command requires the reviewed current schema and atomically verifies that the
ledger is empty and its categories are absent or exactly untouched defaults. A
missing, old, customized, populated, or previously seeded target refuses. The
command never creates, migrates, refreshes, merges, or force-resets a target.

### Running it "for real" (production mode)

`npm run dev` is the development mode — great for everyday use. For a slightly
faster version that you leave running on a home server, use:

```bash
npm run build        # prepare an optimized version (do this once after updates)
npm start            # run that optimized version on 127.0.0.1:3100
```

The build command runs with a new database in the operating system's temporary
directory; it does not open the configured ledger. The wrapper removes that
database and its SQLite sidecars when the build finishes or receives Ctrl+C or
a catchable termination signal. `npm start` then opens the configured ledger at
runtime, as normal. The build also checks every generated server trace and
refuses paths that could
package a ledger, SQLite sidecar, import, backup, private environment file, or
operator-only script. The separate `npm run validate:build-privacy` release
check proves ordinary and standalone output in a temporary copied workspace;
standalone packaging is not enabled for normal builds. A forced kill or power
loss can leave the uniquely marked temporary folder behind. The safe build/test
wrappers currently require macOS, Linux, or WSL. They stop before creating a
temporary folder on native Windows because that platform needs a stronger
child-process supervisor; ordinary development mode still works on Windows.

For an unattended Linux home server, use only the rendered systemd units and
installation procedure in `README.md`; the files in `deploy/` are unresolved
templates, not installable units. The rendered app stays on
`127.0.0.1:3100`, runs as the selected non-root account without npm in the
service process, and refuses startup if the checked-out root, private process
settings, non-root effective identity, reviewed migrations, production
build/cache, or database storage do not match. Before Next loads, the app pins
the database selected by the supported root `.env` (or its documented default),
so a production-specific environment file cannot redirect the running service
away from the database that preflight checked. The daily backup service also
refuses a missing source or unsafe existing backup destination. These checks
report the problem in the journal but do not create or repair files for you.

### Stopping the app

In the terminal where it's running, press **Ctrl + C**. Your data is saved in
the database file and will be there next time you start it.

---

## 4. A tour of every screen

The app has **six pages**. On a computer, they're links down the **left
sidebar**. On a phone, they're in a **bar across the top**. The pages are:

**Dashboard · Transactions · Transfers · Accounts · Categories · Import**

The app automatically matches your system's **light or dark theme**.

### 4.1 Dashboard (the home page)

This is your at-a-glance summary. If you have no transactions yet, it shows a
short "Welcome" message pointing you to import a statement.
Otherwise you'll see:

**A month switcher** (top right): `← July 2026 →`. Click the arrows to move
between months. The dashboard always opens on the **most recent month that
actually has data**, so it's never blank. You can't go past the current month.

**Three summary cards:**

| Card | What it shows |
|---|---|
| **Net worth** | Every account's balance added together when all accounts share one valid currency. Click it to jump to the Accounts page. |
| **Income · [month]** | Money that came in during the selected month. |
| **Spending · [month]** | Money that went out during the selected month. |

**Needs categorization** — appears when one or more transactions still need a
category. It counts the whole ledger across all months, not only the dashboard's
selected month. The count covers an unsplit transaction with no category and
counts a split transaction once when at least one split part is uncategorized. A
blank parent category is ignored when all of that transaction's split parts are
categorized. Follow the link to open the Transactions page with the
**Uncategorized** filter already selected. This data-quality reminder remains
available even when mixed or invalid currencies hide combined financial totals.

**Spending by category** — a chart breaking that month's spending into
categories, biggest first. If nothing was spent that month, it says so.

**Budget vs actual** — only appears once you've given at least one category a
[monthly budget](#budget-optional). It lists each budgeted category with a
progress bar: this month's spending against the target. Bars go **red** with an
"Over by …" note when you exceed the budget, and stay neutral with a "… left"
note while you're under.

**Income vs. spending · last 6 months** — a chart comparing what came in versus
what went out for each of the last six months. This is the best view for
answering "am I saving or overspending lately?"

**Recent transactions** — your 10 most recent transactions, so you can eyeball
the latest activity without leaving the page.

If account currencies are mixed, the dashboard replaces one combined scalar
with one exact financial section per valid currency; Money Bags does not perform
currency conversion. If an account currency needs repair, the dashboard keeps
the repair warning and does not present a partial valid-currency view. The
categorization reminder, recent transactions, and individual valid account
balances remain available. If an exact total would exceed the supported integer
range, the affected area reports that totals are unavailable instead of showing
a rounded number.

### 4.2 Accounts

Where you manage your money buckets. The page reminds you at the top:
*"Balance = opening balance + all transactions."*

The table shows one row per account with these columns:

| Column | Meaning |
|---|---|
| **Account** | The name you gave it (e.g. *Everyday Checking*). Click it to see just that account's transactions. |
| **Type** | CHECKING, SAVINGS, CREDIT_CARD, CASH, or INVESTMENT. |
| **Institution** | The bank or company (optional). |
| **Opening** | The opening balance you set. |
| **Opening date** | Optional date retained for historical balance calculations; blank means current baseline. |
| **Balance** | The current balance, computed for you. |
| **Transactions** | How many transactions are in this account. |

**Buttons:**

- **New account** — opens a form with: **Name**, **Type**, **Institution
  (optional)**, **Currency** (a three-letter code, default `USD`), and **Opening
  balance** (signed currency units, e.g. `-250.00`), and optional **Opening
  balance date**.
- **Edit** (on each row) — change any of those fields.
- **Delete** (on each row) — permanently removes the account, **all its
  transactions and split allocations**, and its import history. Data in other
  accounts and all categories remain. The confirmation has a real label and
  requires the account's **exact name** before the Delete button will work.
  **Cancel** or **Escape** returns focus to that row's Delete button.

The Accounts page is also the currency repair path. A legacy invalid value is
shown in the edit field without being logged, silently changed, or formatted as
USD. Its amounts say **Unavailable** until you enter a valid three-letter code
and save. Lowercase or space-padded valid codes are presented normalized in
memory and are written back only when you explicitly save.

### 4.3 Categories

Where you control how transactions get labeled. The page explains: *"Keywords
auto-categorize imported transactions (longest match wins)."*

Each category has:

- A **Name** (e.g. *Groceries*).
- **Keywords** — a comma-separated list of words the app looks for in a
  transaction's description. If a keyword appears, the transaction gets that
  category. Example: the *Groceries* category has keywords
  `market, grocery, supermarket, harvest`, so a transaction described
  `WHOLE HARVEST MARKET` is auto-labeled Groceries.
- A **Color** — pick **None** or one of eight named colors (Blue, Aqua, Yellow,
  Green, Violet, Red, Magenta, Orange). Color is just for the charts and badges.
- A **Monthly budget (optional)** — a target in the ledger's one shared
  currency (e.g. `500`). Leave it blank for no budget. Budget values are not
  shown or editable while account currencies are mixed or need repair, because
  categories do not have their own currency. When set, it powers the dashboard's [Budget vs
  actual](#41-dashboard-the-home-page) bars. See [Budget](#budget-optional).
- An **"Exclude from income/spending"** checkbox — turn this on for
  transfer-type categories so they don't distort your totals (see
  [Transfers](#transfer-and-why-it-isnt-spending)). Excluded categories also
  disappear from budget progress. Their saved budget is preserved and returns
  if you include the category again.

The table columns are **Category**, **Keywords**, **Budget** (the monthly target
or a dash), **Excluded** (Yes/blank), and **Active transactions** (how many
transactions currently use the category, including split transactions once
even when several parts use it).

**Buttons:**

- **New category** — create your own.
- **Edit** — change a category's name, keywords, color, or exclude setting.
- **Delete** — removes the category without deleting transactions or split
  allocations. The armed confirmation discloses how many active transactions
  and split parts become **Uncategorized**, plus any inactive parent fallback
  that cannot return if its splits are later removed.
- **Merge into…** — choose another category to move all parent categories, split
  allocations, and inactive fallback references into it, then delete the source
  category in one operation. The source and target must be different.
- **Apply rules to uncategorized** (top right) — re-runs the keyword matching
  over unsplit transactions whose single category is currently blank. It
  **never** changes a category you set by hand or the ignored parent of a split
  transaction. A blank split part needs deliberate manual allocation. After it
  runs, it tells you how many it labeled, e.g. *"Categorized 8 of 20
  uncategorized."*

### 4.4 Transactions

Your full, searchable ledger. The header notes: *"Change a category to
recategorize a single row."*

**Add a transaction by hand** — click **Add transaction** to open a form:

| Field | Notes |
|---|---|
| **Account** | Which account it belongs to. |
| **Date** | A date picker. |
| **Description** | What it was (e.g. *Farmers market*). |
| **Merchant (optional)** | A short merchant label used by the dashboard rollup. Leave blank to derive a stable label from the description. |
| **Notes (optional)** | Up to 2,000 characters; line breaks are preserved. |
| **Tags (optional)** | Up to 20 comma-separated tags, 40 characters each. Tags are saved in lowercase, de-duplicated, and sorted. |
| **Amount** | Signed dollars. **Negative = money out.** The form literally says so, with `-12.50` as the example. |
| **Category** | Pick one, or leave it **Uncategorized**. |
| **Cleared / reconciled** | Mark the row after it agrees with the bank statement. |
| **Exclude from income/spending** | Suppress this row from aggregate income, spending, budgets, merchant rollups, and trends without changing its category. |

Click **Add transaction** to save.

**Filter and search** — a row of controls above the table:

- **Search descriptions, notes, or tags…** — type any text to find matching transactions. `%` and `_` are treated as ordinary characters, not wildcards.
- **Tag badge** — select a `#tag` beneath any description to apply an exact tag filter; select the filter chip's × to remove it.
- **All accounts** — narrow to one account.
- **All categories** — narrow to one category, or pick **Uncategorized** to find
  transactions that still need a label.
- **Cleared: all / Cleared only / Uncleared only** — review reconciliation work
  without changing the ledger rows.
- **Month picker** — narrow to one month.
- **From / To dates** — narrow to a custom date range (either end can be left
  blank for an open-ended range). Use this instead of the month picker when you
  want, say, "the last two weeks" or "the whole tax year."
- **Clear filters** — appears once any filter is active; resets everything.

Every filter is saved in the page's web address, so you can **bookmark a filtered
view** (like "all Dining transactions") and it'll still work later. If you land
on a filter for an account or category that no longer exists (e.g. an old
bookmark after you deleted it), the app simply ignores that filter and shows
everything, rather than a confusing empty page.

Category filters follow the active allocation. An unsplit transaction matches
its one category. A split transaction matches every category used by at least
one part, never its inactive parent category, and still appears only once in
the table or export. **Uncategorized** includes an unsplit blank category and a
split with at least one blank part, so a split transaction can appear in both a
named-category view and the Uncategorized view.

**The table** shows Date, Description, Account, Category, Amount, and Status.
When you filter to one account it also shows a deterministic **Running balance**
from the opening balance plus rows ordered by date, creation time, and ID. Notes
and tag badges appear beneath the Description when present. Dates read
as **"Jul 7, 2026"** (hover to see the exact `YYYY-MM-DD`), and money coming
**in** (a paycheck, a refund) is tinted **green** so it stands out; money going
out stays in the normal text color, with its minus sign. (Red is saved for
things that need attention — an error, or a budget you've gone over — so it keeps
its meaning.) When you're on this page (not the dashboard), two extra things are
true:

- The **Category** column is a dropdown, with a **colored dot** that matches the
  chosen category — change it to instantly re-label that one transaction. (A
  transaction you've **split** across categories shows a **Split** link here
  instead of the dropdown — see below.)
- Each row has an **Edit** link (change any field) and a **Delete** button. Click
  **Delete** and the full permanent consequence plus a **Confirm** button appear
  right there in the row (no browser pop-up). Keyboard focus moves to Confirm;
  **Cancel** or **Escape** returns to Delete. A successful deletion moves focus
  to the surviving **Add transaction** control. Deleting a transaction also
  deletes its split allocations, while other transactions remain.

- The **Status** controls let you mark a row **Cleared** or **Excluded**. These
  flags are independent of category and remain attached to the transaction.

The **Account** name in each row is a link that filters the table down to that
account.

**Link a transfer or refund** — open a transaction's **Edit** page. The
**Ledger relationships** box lets you unpair an existing transfer, link a
positive row to an eligible same-account negative original, or unlink a refund.
Partial refunds are allowed, but the total linked refund cannot exceed the
original outflow. A linked refund reduces spending instead of appearing as
income. Use the **Transfers** page to review and pair advisory equal-and-
opposite candidates across accounts.

**Split a transaction across categories** — sometimes one charge is really
several things: a single store run might be $60 groceries, $30 household, and a
$10 gift. Open the transaction's **Edit** page and use the **Split across
categories** box: add a part for each category and type how much of the total
goes to it. A running **Remainder** shows how much is still unassigned; once the
parts add up exactly to the transaction total it reads **Balanced ✓** and you can
**Save split**. From then on, each part counts toward *its own* category in your
spending, budgets, and charts — and if one part is a category you've marked "not
spending" (like a reimbursed item), only that part is left out, not the whole
charge. The transaction keeps its single line in the ledger; only the category
breakdown changes. Click **Remove split** to turn it back into a normal
single-category transaction. While a split exists, changing the transaction's
amount is blocked; review and remove the split first if the ledger amount really
must change. If older stored allocations do not add up to their transaction, the
edit page shows a red warning and blocks ordinary transaction edits. Correct the
parts so they add up to the unchanged transaction amount, or deliberately remove
the split after reviewing it—the app never rescales, clears, or repairs parts on
its own.

Every add, remove, and clear split control is at least 44×44 CSS pixels. Screen
readers distinguish repeated controls by the one-based part number and current
category (for example, “Remove split part 2, Groceries”).

**Export CSV** — next to the "Showing …" count sits an **Export CSV** link. It
downloads exactly the rows your current filters produce (not just the page
you're looking at) as a spreadsheet file — handy for taxes, sharing with an
accountant, or your own analysis. Clear the filters first to export everything.
The downloaded columns are **Date, Description, Amount, Currency, Account,
Category, Split Details, Notes, and Tags**. Tags are compact JSON in one cell. A
split transaction stays one row with its full ledger amount, says **Split** in
Category, and includes all allocations in Split Details. When a category filter
matches one allocation, or an exact tag filter matches the parent, the complete
parent row and every allocation are exported; the ignored parent category never
matches.

The download can safely contain accounts in different currencies because every
row names its currency. If a stored account currency needs repair, export is
refused with instructions to fix it on **Accounts**. Text that could be mistaken
for a spreadsheet formula receives a leading apostrophe in the downloaded CSV;
that apostrophe may be visible in a strict text/CSV reader. The saved transaction
and its categorization are unchanged, and signed Amount cells remain numbers.

Imported rows start with empty notes/tags. Adding them later does not change the
statement duplicate hash, so re-importing the same source still skips the row
without overwriting your annotations. Undoing the import deletes the annotated
transaction with the rest of its batch.

**Pagination** — the table shows 50 transactions at a time. At the bottom you'll
see *"Showing 1–50 of 320"* with **← Prev** and **Next →** links. Your filters
carry across pages.

### 4.5 Transfers

The **Transfers** page is a review queue for likely movements between your own
accounts. It does not infer or silently change anything. A candidate appears
only when two nonzero rows have equal-and-opposite safe cents, different
accounts, the same valid currency, and dates no more than three calendar days
apart.

Each candidate shows both ledger rows and offers an explicit **Pair** action.
Pairing keeps both rows in the ledger and in exports, but removes them from
income, spending, budget, merchant, and trend aggregates. Pairing is one-to-one
and reversible from either transaction's Edit page. A transfer-linked row
cannot also be linked as a refund.

### 4.6 Import

Where you load a bank statement file. Covered in full in
[Section 7](#7-importing-bank-statements). In short: pick the account, choose the
`.csv` file your bank gave you, and click **Import statement**. A valid file is
imported as one unit; if any row, date choice, or explicit column mapping is
invalid, nothing from the file is saved.

---

## 5. Step-by-step recipes

Concrete, numbered walkthroughs for the things you'll actually do.

### Recipe A — Set up your first account

1. Go to **Accounts**.
2. Click **New account**.
3. Enter a **Name** (e.g. *Everyday Checking*).
4. Choose the **Type** (e.g. CHECKING).
5. Optionally add the **Institution** (your bank's name).
6. Set the three-letter **Currency** code (for example `USD`, `EUR`, or `JPY`).
7. Set the **Opening balance** to whatever was in the account before your first
   statement. If you're starting from scratch, `0.00` is fine.
8. Click **Create account**.

Repeat for each real account you have (checking, credit card, cash, etc.).

### Recipe B — Import your first bank statement

1. **Get a CSV from your bank.** Log in to your bank's website, find your
   account's transaction history, and look for an **Export** or **Download**
   button. Choose the **CSV** format (sometimes labeled "spreadsheet" or
   "comma-separated"). Save the file somewhere you can find it.
2. In the app, go to **Import**.
3. Pick the **Account** this statement belongs to. (If you haven't made it yet,
   click **New account…** right there to create one without leaving the page.)
4. Click **Choose file** and select the CSV you downloaded (max size 5 MiB).
5. Leave **Date format** on **Auto-detect**. If the file contains a date such as
   `03/04/2026`, the app saves nothing and asks you to choose **MM/DD/YYYY** or
   **DD/MM/YYYY** (see [Section 7](#7-importing-bank-statements)).
6. Click **Import statement**.
7. Read the result: how many were **imported** and **skipped as duplicates**.
   If the file is refused, correct the listed rows or setting and submit the
   whole file again; no partial rows were saved.

> **Tip:** It is completely safe to import the same file twice. The app
> recognizes transactions it already has and skips them, so you'll never get
> doubles.

### Recipe C — Fix a wrongly-labeled transaction (and teach the app)

There are two levels of fix:

**Fix just this one transaction:**

1. Go to **Transactions**.
2. Find the row (use the search box).
3. Change the **Category** dropdown on that row. Done — it's saved instantly.

**Fix it for the future too** (so every similar transaction is auto-labeled):

1. Go to **Categories**.
2. **Edit** the category you want (say, *Dining*).
3. Add a new **keyword** that appears in those transactions' descriptions (e.g.
   add `bistro` if your favorite spot is "CORNER BISTRO").
4. Save, then click **Apply rules to uncategorized** to label any existing
   uncategorized transactions that now match.

### Recipe D — Add a cash purchase by hand

Your bank statement won't include cash you spent from your wallet. Add it
yourself:

1. Make sure you have a **CASH** account (Recipe A).
2. Go to **Transactions** → **Add transaction**.
3. Account: your cash account. Date: when you spent it. Description: what it was.
   Amount: the negative amount, e.g. `-8.00` for an $8 lunch. Pick a category.
4. Click **Add transaction**.

### Recipe E — Record a credit-card payment without inflating your spending

When you pay your credit card from checking, that's a **transfer**, not
spending. Record it so your totals stay honest:

1. In your **checking** account, the payment appears as money out, e.g.
   `-700.00`. Set its category to **Transfers**.
2. On your **credit card**, the payment appears as money in, e.g. `+700.00`
   (it reduces what you owe). Set its category to **Transfers** too.

Because **Transfers** is marked "exclude from income/spending," neither of these
$700 entries counts as spending or income — but both correctly change their
account balances. (The demo data does exactly this with *"PAYMENT TO REWARDS
CARD"* and *"PAYMENT RECEIVED – THANK YOU."*)

### Recipe F — See where last month's money went

1. Go to the **Dashboard**.
2. Use the **← →** month arrows to land on the month you want.
3. Read the **Spending by category** chart (biggest categories first) and the
   **Income · [month]** and **Spending · [month]** cards.
4. To dig into any category, go to **Transactions**, set the **Month** filter and
   the **Category** filter, and you'll see every transaction behind the number.

### Recipe G — Correct or remove a mistake

- **Wrong amount, date, or description?** Transactions → find the row →
  **Edit** → fix it → **Save changes**.
- **A transaction that shouldn't exist?** Transactions → find the row →
  **Delete** → confirm.

### Recipe H — Back up your data

Your data is one file on your computer. Protect it (details in
[Section 9](#9-keeping-your-data-safe)):

```bash
npm run audit:data-path
npm run db:backup
```

The audit reads configuration, migration files, Git rules, and path metadata;
it does not open the database or read any ledger table. It prints the exact
active target, the `backups/` root beside it, and that target's isolated
`backups/target-<24-hex-path-hash>/` directory. The backup command writes,
validates, and publishes a private timestamp-and-UUID image in that scoped
directory and is safe while the app is open. On POSIX, the command reports
confirmed durability; on native Windows it reports platform-best-effort
durability and unverified ACL privacy. Do it regularly (or on a schedule). If
the target is an external absolute path, its sibling backup root is external too
and must be included explicitly in your backup plan.

### Recipe I — Set a monthly budget for a category

1. Go to **Categories**.
2. Click **Edit** on the category you want to budget (e.g. *Groceries*).
3. In **Monthly budget**, type the dollar target (e.g. `500`). Leave it blank
   later if you ever want to remove the budget.
4. Click **Save**.
5. Open the **Dashboard**. A **Budget vs actual** section now shows a bar for
   that category — green-ish and "… left" while you're under, red and "Over
   by …" once you pass it. Switch months with the arrows to check other months.

### Recipe J — Export transactions to a spreadsheet

1. Go to **Transactions**.
2. (Optional) Set any filters — account, category, month, a From/To date range,
   or a search — to narrow down what you export. To export everything, click
   **Clear filters** first.
3. Click **Export CSV** (next to the "Showing …" count).
4. Your browser downloads a `.csv` file containing every matching parent row in
   deterministic oldest-first order, including a Currency column and truthful
   split details. Open it in your spreadsheet program, or hand it to your
   accountant.

---

## 6. How the app thinks

You don't *need* this section to use the app, but understanding these rules
explains why the numbers look the way they do.

### How auto-categorization works

When you import a statement, the app reads each transaction's **description** and
compares it (ignoring capital letters) against every category's **keywords**. If
a keyword appears anywhere in the description, that category is a match.

- If **several** keywords match, the **longest** keyword wins. This lets a
  specific rule beat a general one. Example: if *Coffee* has the keyword
  `blue bottle coffee` and *Dining* has `coffee`, a "BLUE BOTTLE COFFEE" charge
  goes to *Coffee* because the matching keyword is longer.
- If there's still a tie, the category whose **name comes first alphabetically**
  wins (so results are always consistent).
- If **nothing** matches, the transaction is left **Uncategorized**.

Auto-categorization runs at **import time**. To re-run it later over
uncategorized rows, use **Apply rules to uncategorized** on the Transactions or
Categories page. It never overwrites a category you chose by hand. Split
transactions are skipped because a whole-description keyword cannot decide how
to allocate one blank split part safely.

### How duplicate detection works and how to review a collision

Every imported transaction gets a hidden fingerprint built from its account,
date, amount, cleaned-up description, and its position among identical rows. If a
new import produces a fingerprint the database already has, that row is
**skipped** instead of added. This is what makes re-importing the same file safe.

If the *exact same* transaction appears in two different statement files, the
frozen hash still treats it as a duplicate. The import screen lists every
skipped row and offers **Import separately**. That explicit action writes the
normal transaction with a null import hash plus source-file fingerprint, source
row, and original-hash provenance. The same source row cannot be overridden
twice while its batch exists, and **Undo** removes the override with the batch.
Ordinary re-imports remain idempotent; the hash formula itself never changes.

### How money is stored (no rounding errors)

Behind the scenes the app stores every amount as a whole number of **cents**
(so $82.45 is stored as `8245`), never as a decimal. This is a deliberate,
standard choice for money software: it completely avoids the tiny rounding
errors that decimals can introduce. You always type and read normal dollars —
the cents are just how it's kept safe internally.

### How income vs. spending is decided

For a given month, the app looks at every transaction and applies these rules:

- **Positive amount** → counts as **income**.
- **Negative amount** → counts as **spending** (displayed as a positive dollar
  figure).
- Transactions in a category marked **"exclude from income/spending"** (i.e.
  transfers) are **skipped** in both totals.
- A transaction marked **Exclude from income/spending** is skipped in all
  income, spending, budget, merchant, and trend aggregates without changing its
  category.
- An explicit transfer pair is skipped in those same aggregates regardless of
  category. A positive transaction explicitly linked as a refund is not income;
  it reduces spending in its own active category or split allocations.
- **Uncategorized** transactions **do** count — a missing label never hides money
  from your totals.

The **Spending by category** chart uses the same rules and additionally leaves
out transfers, so the chart reflects real spending only.

### How relationships and running balances work

Transfers are never inferred from a description. The **Transfers** page shows
advisory candidates only when two nonzero rows have equal opposite cents,
different accounts, valid matching currencies, and dates within three days.
Pairing is an explicit one-to-one action; both rows remain visible and
exportable, but they leave aggregate income, spending, budgets, merchant
rollups, and trends. Unpairing restores their ordinary semantics.

A refund is an explicit link from a positive row to a negative original on the
same account and currency. Partial refunds are allowed up to the original
outflow's absolute amount. The refund's own active category or splits determine
where the spending reduction appears. Linking never rewrites either row.

When the Transactions page is filtered to one account, its running balance is
the opening balance plus each transaction in date, creation-time, and ID order.
An opening balance without a date is a current baseline; it is not projected
back into historical trend points.

### How dates and months work

Transaction dates are plain calendar dates (like `2026-06-03`) with no time zone
attached, so a transaction never "slips" into the wrong day. A "month" is just
the year-and-month part (`2026-06`), which is how the dashboard and the month
filter group things.

---

## 7. Importing bank statements

The import feature reads **CSV files** — the plain, spreadsheet-style export
almost every bank offers. This section is the complete reference for what it
accepts.

The web upload accepts a CSV up to exactly 5 MiB. It also reserves 64 KiB for
the browser's multipart framing and the small Account, Date format, and optional
column-mapping fields. The server measures the body as it arrives, so missing or
incorrect size metadata cannot bypass the limit. A request that exceeds either
the CSV limit or the total upload limit is refused before any ledger change.

The filename shown in **Recent imports** is metadata, never a save destination.
Money Bags keeps only the final name after either `/` or `\\`, normalizes Unicode
for consistent display, and rejects empty, dot-only, overlong, or control-
containing names. The same rule applies to browser and command-line imports.

### The columns it looks for

At minimum, your file needs a **date**, a **description**, and an **amount**. The
app recognizes common header names and their synonyms, and picks sensibly when a
file has more than one option:

- **Date** — `Date`, `Transaction Date`, `Posted Date`, … (Transaction Date is
  preferred over Posted Date).
- **Description** — `Description`, `Memo`, `Payee`, … (Description is preferred
  over Memo, so an empty Memo never blanks a row).
- **Amount** — either a single `Amount` column, **or** separate `Debit` and
  `Credit` columns (money-out and money-in). If your bank uses split columns, a
  **negative value in the Debit column** is treated as a refund — i.e. money
  coming back **in**. A zero-filled side is inactive, so Debit=`0.00` with
  Credit=`100.00` is a $100 inflow. Two nonzero sides are an error; two zero
  sides produce an exact zero-cent row.

A typical accepted file looks like this:

```csv
Date,Description,Amount
2026-06-01,ACME CORP PAYROLL,2600.00
2026-06-02,CITYVIEW APARTMENTS RENT,"-$1,850.00"
2026-06-03,"WHOLE HARVEST MARKET, DOWNTOWN",-82.45
2026-06-04,BLUE DOOR CAFE,-14.75
```

If a required column is missing entirely, the app stops and gives you **one
clear missing-column message** instead of
flagging every single row — so you know immediately it's a header problem, not
bad data.

### Advanced: telling the app which column is which

If your bank uses unusual header names the app doesn't recognize, expand
**Advanced: column mapping** on the Import screen. It gives you a box for each
field — **Date, Description, Amount, Debit, Credit** — where you type the *exact*
header text from your file. Fill in only the ones that need it; leave the rest
blank to keep auto-detection. For example, if your file's date column is headed
`Txn Day`, put `Txn Day` in the Date box and import as normal.

An explicit map is strict: each supplied value must be a unique, 1–120 character
header that appears exactly once in the file. Unknown fields, missing/duplicate
headers, empty values, and two fields claiming the same header refuse the file;
the app never silently falls back to auto-detection.

### Amount formats it understands

The parser is flexible about how amounts are written. All of these are accepted:

| You might see | Means |
|---|---|
| `2600.00` | +$2,600.00 |
| `-82.45` | −$82.45 |
| `$1,234.56` | +$1,234.56 (dollar sign and thousands commas are fine) |
| `(96.31)` | −$96.31 (accountants write negatives in parentheses) |
| `45.00-` | −$45.00 (trailing minus) |
| `45,00` | +$45.00 (European style, comma as the decimal point) |

The **one** form it refuses to guess at is an ambiguous mixed style like
`1.234,56`. Rather than risk reading it wrong, it reports that row as an error so
you can fix the file. It never silently guesses.

### Date formats

Dates can be ISO (`2026-06-03`), US (`MM/DD/YYYY`), or European (`DD/MM/YYYY`).
The **Date format in file** dropdown offers:

- **Auto-detect** (the default) — figures it out from the file.
- **MM/DD/YYYY** — force US order.
- **DD/MM/YYYY** — force European order.

Auto-detect accepts ISO dates, equal dates such as `05/05`, and dates where a
component over 12 makes the order certain. When it meets a genuinely ambiguous
date such as `03/04`, it imports **nothing**, focuses the date-format control,
and asks you to choose **MM/DD/YYYY** or **DD/MM/YYYY** before submitting again.
The choice happens before duplicate hashes or database writes.

### The import result

After you click **Import statement**, you get a summary like:

> *"48 imported · 2 skipped as duplicates"*

- **Imported** — new transactions added.
- **Skipped as duplicates** — already in your data; each is listed with its line
  number, date, amount, and description so you can check them (see the
  [duplicate review rules](#how-duplicate-detection-works-and-how-to-review-a-collision)).
  If a listed row is a legitimate second occurrence, choose **Import
  separately**. That explicit override keeps the frozen hash unchanged,
  records the source file/row provenance, and can be removed with the import's
  normal **Undo** action. Ordinary re-imports remain idempotent.
- **A refused file** — if any row, CSV structure, or explicit column map is
  invalid, the app identifies safe line/field details and saves zero rows. Fix
  the source and import the full file again. Ambiguous dates are a separate
  refusal that asks for an explicit order.

### Undoing an import

Imported the wrong file, picked the wrong account, or realized the amounts were
parsed wrong? You don't have to hunt down the rows by hand. Below the import form
is a **Recent imports** list — one line per import that actually added
transactions, newest first, showing **when** it ran, the **account**, the
**file** name, and how many rows it **added**. Click **Undo** on any line and the
app permanently deletes exactly the transactions that import added — nothing
else. Rows you typed in by hand, and rows from other imports, are left alone.

A few things worth knowing:

- Undo asks you to confirm first: clicking **Undo** shows the exact count, file,
  later-edit/split consequence, and what remains as visible text beside an
  **Undo import** Confirm button — no hover or browser pop-up is required. Focus
  moves to Confirm. **Cancel** or **Escape** returns to Undo; success moves focus
  to the surviving **Recent imports** heading.
- Even if you later re-categorized or edited one of those imported rows, Undo
  still removes it — it belongs to that import.
- An import that added **nothing** (every row was a duplicate) doesn't appear in
  the list, because there's nothing to undo.
- Undo is permanent; there's no "redo." But re-importing the same file puts the
  rows right back, so a mistaken undo is easy to reverse.

This is the clean way to recover from the re-import edge case described under
[duplicate detection](#how-duplicate-detection-works-and-how-to-review-a-collision): undo the
bad import, fix the file or the settings, and import again.

### Where to keep your statement files

Put real statement CSVs in the project's `data/imports/` folder. That folder
and every other path below `data/` are deliberately kept out of version
control. Only explicitly fake files below `data/samples/` are trackable. Run
`npm run audit:data-path` after changing `DB_FILE_NAME`. A canonical absolute
target outside the repository is outside Git's protection, so you are
responsible for its permissions and backup lifecycle.

### Importing from the command line (optional)

If you prefer the terminal, you can import without the web page:

```bash
npm run import -- --file statement.csv --account "Everyday Checking" --type CHECKING --currency USD --date-format MDY
```

`--type`, `--currency`, and `--date-format` are optional (defaults: CHECKING,
USD, and auto). For unusual headers, the same strict column
mapping the web UI offers is available as flags — `--col-date "Txn Day"`,
`--col-amount "Value"`, and likewise `--col-description`, `--col-debit`,
`--col-credit`. An ambiguous auto date exits with MDY/DMY instructions. A new
named account is created only after the whole file is ready, inside the same
transaction as the import; a same-name account is reused only when its type and
currency match, and is never updated by the command.

A command-line import is recorded the same way a web import is, so if it went in
wrong you can undo the whole thing from the **Recent imports** list on the Import
page — no need to delete rows by hand.

---

## 8. Using it on your phone

By default the app answers **only** on the computer it runs on. That's the safe
default, because **the app has no password** — anyone who can reach it can see
everything. To use it from your phone the *right* way, don't open it to the
whole internet. Use **Tailscale**, a free tool that builds a private, encrypted
tunnel between your own devices only.

### Set up remote access with Tailscale

1. Install [Tailscale](https://tailscale.com) on both the computer running the
   app **and** your phone. Sign both into the same account.
2. On the computer running the app, run:
   ```bash
   tailscale serve --bg 3100
   ```
3. Note the complete secure address Tailscale gives you. It looks like
   `https://your-computer.your-tailnet.ts.net`. In the app's root environment
   configuration, set `EXTRA_ALLOWED_ORIGINS` to that exact address. If you
   deliberately use more than one proxy address, separate the complete HTTPS
   addresses with commas; wildcards and partial domain names are not accepted.
4. If you use production mode, rebuild with `npm run build` and restart with
   the same setting available to `npm start`. Changing the setting and only
   restarting an old build is not enough. For development mode, stop and
   restart `npm run dev`.
5. On your phone, open that configured address. Tailscale handles the secure
   `https` connection automatically.

Now only your own signed-in devices can reach the app. Your financial data still
never touches anyone else's server. Money Bags checks the exact browser origin
before uploads or other changes and prevents the interface from being embedded
in another site's frame. It still has no login: tailnet membership and ACLs are
the access boundary.

### Install it as an app on your phone (PWA)

Once you can open it on your phone over that `ts.net` address, you can add it to
your home screen so it opens like a real app:

- **Android (Chrome):** accept the install prompt, or tap **⋮ → Add to Home
  screen**.
- **iPhone (Safari):** tap **Share → Add to Home Screen**.

You'll get an icon and a clean, full-screen window. (There's intentionally no
offline mode — your data lives on the server computer, so the app needs to reach
it.)

The interface is built to work under a thumb: buttons, menus, and the navigation
bar are sized to comfortable **touch targets**, number fields pop the numeric
keypad, confirmations happen **inline** (a Confirm button appears right where you
tapped, instead of a browser pop-up), and wide tables show a soft shadow at the
edge when there's more to scroll sideways to.

With a keyboard, the current page is exposed to assistive technology, the mobile
menu toggle names the menu it controls, and **Escape** closes that menu and
returns focus to the toggle. Submitted form errors are announced and receive
focus once; when the server identifies a specific field, that control is marked
invalid and linked to the error summary. Destructive confirmations always show
their full consequence without relying on a tooltip.

> **Advanced / not recommended:** there are `npm run dev:lan` and
> `npm run start:lan` commands that expose the app to your whole local network
> **with no password**. Only use these if you fully understand the risk.
> Tailscale is the better choice.

---

## 9. Keeping your data safe

Everything lives in **one file**. By default it is `data/finance.db` inside the
project folder. `DB_FILE_NAME` can select another path below `data/`, or a
canonical absolute path outside the project. Other relative paths, traversal,
symlink aliases, and paths elsewhere inside the project are refused before a
file is created. That's great for privacy, but it means **you** are responsible
for backups — no cloud is doing it for you.

Before opening the database, Money Bags also checks that the optional root
`.env` file is valid UTF-8 assignment syntax and that every migration named by
the migration journal is the reviewed, unchanged SQL file. Only a missing
`.env` is ignored; malformed or unreadable configuration stops startup instead
of silently selecting a different ledger.

You can inspect this configuration safely before startup:

```bash
npm run audit:data-path
```

The audit reports the normalized target, whether it is protected by the
repository's `data/` Git boundary, the exact sibling backup root, the isolated
target-scoped backup directory, and existing direct parent/main/WAL/SHM/backup
artifact POSIX modes when available. Existing POSIX directories/files must be
exactly `0700`/`0600`; the audit fails with exact non-recursive `chmod`
remediation but never changes permissions. On Windows it says explicitly that
ACL privacy is unverified. It reads metadata only and never queries ledger
tables. For an external absolute target, Git protection is not applicable;
protect that target and its reported backup root yourself.

On POSIX, each Money Bags application or operational Node process that may open
SQLite sets `umask 0077` before the first open and intentionally keeps that
process-global setting. Later files created by that process therefore inherit a
private default. The service's `UMask=0077` adds defense in depth; neither
mechanism sets or verifies Windows ACLs.

If an older setup uses a database elsewhere inside the project, stop before
upgrading. With the old version, stop all writers and make and verify a backup.
Then explicitly restore or move the offline ledger below `data/`, update
`DB_FILE_NAME`, and start the new version. If an older relative path actually
points outside the project, replace it with that ledger's canonical absolute
path. Money Bags never moves a database automatically.

### Make a backup

```bash
npm run audit:data-path
npm run db:backup
```

First confirm the exact active target and target-scoped backup directory reported
by the audit. The command uses SQLite's live backup API, normalizes the completed
image as standalone, validates integrity, foreign keys, reviewed migration
history, and schema, then fsyncs and publishes it without overwriting anything:

`backups/target-<24-hex-path-hash>/moneybags-<UTC-millisecond-stamp>-<UUID>.sqlite3`

With the default target, the backup root is `data/backups/`; use the exact
target-scoped child printed by the audit instead of guessing its hash. Each
normalized database path has a separate namespace, so retention for one ledger
cannot delete another ledger's finals. Changing `DB_FILE_NAME` selects a new
namespace. Legacy `finance-*.db` and other unscoped files directly under the
backup root are reported by the audit but preserved and never selected by
automatic retention. New backup directories/files are private (`0700`/`0600`
on POSIX). A failed incomplete copy never becomes final. A complete image that
is logically invalid is retained as `.invalid` for diagnosis, but it is not a
restore or retention candidate. Run backups often—especially before and after a
large import.

The successful command prints its durability and filesystem-privacy scope. On
POSIX, directory fsync and private modes are enforced and durability is
confirmed. On native Windows, directory fsync is unavailable and numeric POSIX
modes do not establish ACL privacy, so the command reports
`platform-best-effort` durability and `ACLs not enforced`; restrict and inspect
the target and backup ACLs separately before relying on them.

To check a published or offline-copied image without changing it, supply its
absolute path:

```bash
npm run db:verify-backup -- /absolute/path/to/moneybags-...sqlite3
```

Only `VALID` plus the current or supported historical schema revision is
printed. The verifier refuses the configured live target, filesystem aliases,
SQLite sidecars, `.partial`/`.invalid` files, corrupt or foreign-key-invalid
images, forged/divergent migration history, mismatched schemas, and unknown or
newer revisions. It does not migrate the image or print ledger rows.

### Restore from a backup (manual offline procedure)

Restore changes the ledger and must preserve a rollback path through every step.
The guarded CLI is preview-only unless you explicitly provide both confirmation
flags:

```bash
npm run db:restore -- --backup /absolute/path/to/backup.sqlite3 --target /absolute/path/to/data/finance.db
npm run db:restore -- --backup /absolute/path/to/backup.sqlite3 --target /absolute/path/to/data/finance.db --confirm --quiesced
```

The first command validates and prints the plan without changes. The second is
allowed only after every writer is stopped; it requires the target to be the
configured canonical ledger, creates a validated rescue beside it, publishes a
verified replacement with a no-clobber lock, and retains the rescue. Use the
manual sequence below to verify service quiescence and the operator's intended
code/runtime pairing before executing it.

1. Run `npm run audit:data-path`; record the exact normalized target, backup
   root, and target-scoped backup directory. Never substitute the default path
   or another target's namespace for a custom target.
2. Make a fresh WAL-safe rescue with `npm run db:backup`, record the exact final
   path printed by the command, and validate that rescue with
   `npm run db:verify-backup -- <absolute-rescue-path>`.
3. Validate the separately selected restore source with the same command. Use a
   standalone regular file only—never a live SQLite main file, `.partial`,
   `.invalid`, or a file accompanied by WAL/SHM sidecars.
4. Stop the app or service and confirm it is stopped. From this point until the
   final health check, do not allow any process to open the configured target.
5. In the target's own directory, make a new uniquely named copy of the selected
   source without overwriting any existing name. Set that restore-ready copy to
   `0600` on POSIX and validate the copy by its absolute path. Keep it on the
   same filesystem as the target so the later rename preserves the verified
   inode.
6. Immediately before replacement, move—not delete—the exact current main file
   and its matching `<target>-wal`/`<target>-shm` files, if present, to unique
   private quarantine names in that directory. Do not touch another ledger's
   sidecars.
7. Rename the verified restore-ready file to the exact configured target. Do not
   copy or edit it after verification. If any operation from step 6 onward
   fails, keep the service stopped and restore the quarantined original or the
   validated rescue before doing anything else.
8. Start the same intended application revision and check its health plus the
   expected ledger. A supported historical image may be migrated by this newer
   application; a downgrade instead requires the backup paired with the older
   code revision.
9. Keep the rescue and quarantine until startup and validation are successful.
   Only then remove the quarantined files through a deliberate operator action.

Never delete the current database or its sidecars before a validated rescue
exists and service inactivity is confirmed.

### Privacy reminders

- The app makes **zero** network calls while running. It doesn't phone home.
- Everything below `data/` is excluded from version control except explicitly
  fake files below `data/samples/`. A canonical external absolute target is
  outside Git's protection; audit and back it up explicitly.
- Because there's **no login**, treat "who can reach the app" as "who can see
  your money." Keep it on `127.0.0.1` or behind Tailscale.

---

## 10. Command cheat-sheet

Run these from the project folder in a terminal.

| Command | What it does |
|---|---|
| `npm install` | One-time: download the app's building blocks. |
| `npm run dev` | Start the app (development mode) at `http://127.0.0.1:3100`. |
| `npm run build` then `npm start` | Build on a temporary ledger, enforce the server-trace privacy gate, then start the faster production version on the configured runtime ledger. |
| `npm run validate:build-privacy` | In an allowlisted temporary copy, build and health-check ordinary and standalone output and scan the complete packaged tree. |
| `npm run smoke:dev` / `npm run smoke:start` | Run a bounded loopback health check with a temporary ledger; the start smoke needs an existing build. |
| `npm run audit:data-path` | Read-only check of the configured target, Git boundary, backup location, and path modes. |
| `npm run db:migrate` | Create/upgrade the database file. |
| `npm run db:seed` | One-time fail-closed initializer for an existing, migrated, empty/default-only disposable ledger. |
| `npm run db:backup [-- --keep N]` | Make a private validated WAL-safe backup in the target's isolated namespace, report platform-qualified durability, and optionally retain its newest N validated finals. |
| `npm run db:verify-backup -- /absolute/path` | Read-only integrity, foreign-key, migration, and schema check for a standalone backup. |
| `npm run db:restore -- --backup <path> --target <path> [--confirm --quiesced]` | Preview or execute the guarded, rescue-retaining restore workflow. |
| `npm run import -- --file <f> --account "<name>"` | Import a statement from the terminal. |
| `npm run db:studio` | Open a database browser to inspect the raw data. |
| `npm test` | Run the app's automated self-checks with fresh temporary DB targets. |

> **Tip:** in these commands, the app listens on port **3100** (not the usual
> 3000). If your browser shows nothing, double-check the address is
> `http://127.0.0.1:3100`.

---

## 11. Troubleshooting & FAQ

**The dashboard is blank / says "Welcome."**
You have no transactions yet. Go to **Import** and load a statement. Use
`npm run db:seed` only with the separate, explicitly migrated disposable demo
target described above; it safely refuses a populated or customized ledger.

**My credit card shows a negative balance — is that a bug?**
No, that's correct. A credit-card balance is money you **owe**, so it's stored as
a negative number. It correctly pulls your net worth down.

**My spending total looks too high — it's counting my credit-card payment.**
Use the **Transfers** page to pair the matching source and destination rows, or
assign both rows to the excluded **Transfers** category. A confirmed pair is
excluded from spending and income regardless of category. See
[Recipe E](#recipe-e--record-a-credit-card-payment-without-inflating-your-spending).

**I received money back for a purchase.**
Open the positive transaction's **Edit** page and link it to the original
negative outflow. The link can be partial, but linked refunds cannot exceed the
original. The refund reduces spending in its own category or split and stops
counting as income. An unlinked positive row remains ordinary income.

**The import said "could not reach the local server."**
The app isn't running, or you closed its terminal. Start it again with
`npm run dev` and retry the import.

**My imported dates look wrong (e.g. day and month swapped).**
Current auto-detect blocks ambiguous dates before saving. If rows were imported
under an older version's warning behavior, first **Undo** that import from the
Recent imports list. Then select your bank's real order (`MM/DD/YYYY` or
`DD/MM/YYYY`) and import the corrected file. The app does not guess which old
rows need repair.

**A transaction I know is real got "skipped as duplicate."**
It's identical (same account, date, amount, description) to one already in your
data, possibly from another file. Review the skipped row and choose **Import
separately** when it is genuinely a second occurrence. The override is explicit
and provenance-tracked; it does not change the frozen hash or future ordinary
dedupe behavior.

**Some transactions are "Uncategorized."**
That's fine — they still count in your totals. Label them one-by-one on the
Transactions page, or add matching **keywords** to a category and click **Apply
rules to uncategorized**.

**Port 3100 is already in use.**
Something else is using that port. Stop the other program, or stop and restart
the app.

**Will running this share my data with anyone?**
No. It runs entirely on your computer and makes no outbound network calls. The
only time the internet is used is `npm install` during setup, which downloads the
app's code — not your data.

**Can I track more than one account? Different banks?**
Yes — create as many accounts as you like, of any types, from any institutions.

**Does it handle multiple currencies?**
Each account has its own required currency code, and a database containing one
currency is formatted in that currency—not automatically as USD. You may keep
accounts with different valid currencies; Money Bags does not convert them, so
the dashboard shows separate exact sections instead of one combined number. If
an old account code is invalid, use **Accounts → Edit** to repair it; the repair
blocker suppresses partial currency groups until the save succeeds.

**How do I set a budget?**
On the **Categories** page, edit a category and fill in **Monthly budget**. The
dashboard then shows a Budget vs actual bar for it. See
[Recipe I](#recipe-i--set-a-monthly-budget-for-a-category). If the category is
excluded from income/spending, its budget bar is hidden without deleting the
saved target; the bar returns when you include the category again.

**How do I get my transactions out of the app?**
Use the **Export CSV** link on the Transactions page — it downloads whatever
your current filters show, including all matches beyond the current 50-row page.
Split matches remain one full parent row with all allocation details. See
[Recipe J](#recipe-j--export-transactions-to-a-spreadsheet).

---

## 12. Glossary

- **Account** — a real place your money lives (checking, credit card, cash, …).
- **Amount** — how much a transaction was, as a **signed** number: positive =
  money in, negative = money out.
- **Balance** — how much is currently in an account (opening balance + all its
  transactions).
- **Budget** — an optional monthly spending target on a category, shown as a
  Budget vs actual bar on the dashboard.
- **Category** — a label that groups similar transactions (Groceries, Dining, …).
- **Column mapping** — telling the import which CSV header is the date, amount,
  etc., when the app can't guess (the Import screen's "Advanced" section).
- **CSV** — a plain "comma-separated values" file; the standard export from banks.
- **Export** — downloading your (optionally filtered) transactions as a CSV file
  from the Transactions page.
- **Dashboard** — the home screen with your totals and charts.
- **Import** — loading transactions into the app from a bank's CSV file.
- **Income** — money that came in during a month (positive amounts).
- **Keyword** — a word the app searches for in a description to auto-pick a
  category.
- **Localhost / loopback / `127.0.0.1`** — an address that means "this computer
  only."
- **Net worth** — everything you own minus everything you owe, as one number.
- **Opening balance** — an account's starting amount, before your first loaded
  transaction.
- **PWA** — "progressive web app"; a website you can install like a phone app.
- **Self-hosted** — you run the software yourself, on your own machine.
- **Signed amount** — a number that can be positive or negative to show direction
  of money.
- **Spending** — money that went out during a month (negative amounts).
- **Tailscale** — a tool that creates a private, encrypted network between your
  own devices.
- **Transaction** — one movement of money (a purchase, a paycheck, a payment).
- **Transfer** — money moved between your own accounts; excluded from spending.
- **Uncategorized** — a transaction with no category yet (still counts in totals).

---

## 13. Appendix: the built-in categories

Your database starts with these 12 categories. The **keywords** are what the app
looks for in a transaction's description to auto-sort it. You can edit, delete,
or add to any of them on the **Categories** page.

The first installation is all-or-nothing. After that, startup respects your
category table exactly: it does not overwrite edits or restore an individually
deleted category. The one unavoidable edge case is a completely empty category
table—without a separate initialization marker, that looks like a fresh
database, so the next startup or valid statement import reinstalls all 12
defaults.

If you suspect an older version left only some defaults, use the **Categories**
page and the table below as a read-only comparison. Do not delete the remaining
categories as a repair: deleting a category makes its linked transactions
Uncategorized, and deleting the final one also triggers full reinstallation on
the next startup or valid statement import. First make and verify a backup, then
review a manual repair separately; recreating a missing category gives it a new
identity, so affected transactions may need deliberate recategorization.

| Category | Catches things like… | Keywords |
|---|---|---|
| **Groceries** | Supermarkets, grocery runs | `market`, `grocery`, `supermarket`, `harvest` |
| **Dining** | Restaurants, cafés, coffee | `restaurant`, `cafe`, `coffee`, `grill`, `pizza`, `noodle`, `taco` |
| **Housing** | Rent, mortgage | `rent`, `apartments`, `mortgage` |
| **Transportation** | Gas, rideshare, transit | `shell`, `fuel`, `gas station`, `uber`, `lyft`, `transit` |
| **Utilities** | Power, water, internet | `power`, `light`, `electric`, `water`, `internet`, `fibernet` |
| **Shopping** | General retail | `amazon`, `mktplace`, `target`, `walmart` |
| **Entertainment** | Movies, shows, tickets | `cineplex`, `cinema`, `theater`, `tickets` |
| **Subscriptions** | Streaming and memberships | `netflix`, `spotify`, `subscription` |
| **Income** | Paychecks, deposits | `payroll`, `salary`, `direct deposit` |
| **Health** | Pharmacy, clinics, dental | `pharmacy`, `clinic`, `dental` |
| **Insurance** | Insurance premiums | `insurance` |
| **Transfers** *(excluded from spending)* | Moving money between your own accounts | `payment to rewards card`, `payment received`, `transfer` |

---

*Finance Engine keeps your money data private, on your own machine. This manual
describes the app as built. If a screen looks different after an update, the
on-screen labels are always the source of truth.*
