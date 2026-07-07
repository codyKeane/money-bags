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
six months of **fake demo data** and click around with zero risk to real
information. One command does it:

```bash
npm run db:seed
```

Then open the app and explore. When you're ready for your real money, you can
delete the demo accounts or start a fresh database.

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
`-250.00`.

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
(the app assumes US dollars). If it ever detects accounts in different
currencies, the dashboard shows a warning instead of a misleading total — see
the [Troubleshooting & FAQ](#11-troubleshooting--faq) note on currencies.

### Income vs. spending

- **Income** = money that came in during a month (all the positive amounts).
- **Spending** = money that went out during a month (all the negative amounts,
  shown as a positive dollar figure so it's easy to read).

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
which is correct.

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

### Try it with demo data (recommended for your first look)

Before you load real statements, load fake data to explore safely:

```bash
npm run db:seed
```

This creates **two demo accounts** (an *Everyday Checking* and a *Rewards Credit
Card*) and about **six months of realistic transactions** — paychecks, rent,
groceries, gas, Netflix, a credit-card payment, and more. It's safe to run more
than once; it won't create duplicates. Now the dashboard has something to show.

### Running it "for real" (production mode)

`npm run dev` is the development mode — great for everyday use. For a slightly
faster version that you leave running on a home server, use:

```bash
npm run build        # prepare an optimized version (do this once after updates)
npm start            # run that optimized version on 127.0.0.1:3100
```

### Stopping the app

In the terminal where it's running, press **Ctrl + C**. Your data is saved in
the database file and will be there next time you start it.

---

## 4. A tour of every screen

The app has **five pages**. On a computer, they're links down the **left
sidebar**. On a phone, they're in a **bar across the top**. The pages are:

**Dashboard · Transactions · Accounts · Categories · Import**

The app automatically matches your system's **light or dark theme**.

### 4.1 Dashboard (the home page)

This is your at-a-glance summary. If you have no transactions yet, it shows a
short "Welcome" message pointing you to import data or run the demo seed.
Otherwise you'll see:

**A month switcher** (top right): `← July 2026 →`. Click the arrows to move
between months. The dashboard always opens on the **most recent month that
actually has data**, so it's never blank. You can't go past the current month.

**Three summary cards:**

| Card | What it shows |
|---|---|
| **Net worth** | Every account's balance added together. Click it to jump to the Accounts page. (If your accounts span more than one currency, a warning appears below the cards instead of a meaningless total.) |
| **Income · [month]** | Money that came in during the selected month. |
| **Spending · [month]** | Money that went out during the selected month. |

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
| **Balance** | The current balance, computed for you. |
| **Transactions** | How many transactions are in this account. |

**Buttons:**

- **New account** — opens a form with: **Name**, **Type**, **Institution
  (optional)**, and **Opening balance** (signed dollars, e.g. `-250.00`).
- **Edit** (on each row) — change any of those fields.
- **Delete** (on each row) — permanently removes the account **and all its
  transactions**. Because that can't be undone, you must **type the account's
  exact name** to confirm before the Delete button will work.

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
- A **Monthly budget (optional)** — a dollar target (e.g. `500`). Leave it blank
  for no budget. When set, it powers the dashboard's [Budget vs
  actual](#41-dashboard-the-home-page) bars. See [Budget](#budget-optional).
- An **"Exclude from income/spending"** checkbox — turn this on for
  transfer-type categories so they don't distort your totals (see
  [Transfers](#transfer-and-why-it-isnt-spending)).

The table columns are **Category**, **Keywords**, **Budget** (the monthly target
or a dash), **Excluded** (Yes/blank), and **Transactions** (how many
transactions currently use it).

**Buttons:**

- **New category** — create your own.
- **Edit** — change a category's name, keywords, color, or exclude setting.
- **Delete** — removes the category. Its transactions aren't deleted; they simply
  become **Uncategorized**. The app asks you to confirm first.
- **Apply rules to uncategorized** (top right) — re-runs the keyword matching
  over every currently-uncategorized transaction. It **never** changes a
  category you set by hand. After it runs, it tells you how many it labeled,
  e.g. *"Categorized 8 of 20 uncategorized."*

### 4.4 Transactions

Your full, searchable ledger. The header notes: *"Change a category to
recategorize a single row."*

**Add a transaction by hand** — click **Add transaction** to open a form:

| Field | Notes |
|---|---|
| **Account** | Which account it belongs to. |
| **Date** | A date picker. |
| **Description** | What it was (e.g. *Farmers market*). |
| **Amount** | Signed dollars. **Negative = money out.** The form literally says so, with `-12.50` as the example. |
| **Category** | Pick one, or leave it **Uncategorized**. |

Click **Add transaction** to save.

**Filter and search** — a row of controls above the table:

- **Search descriptions…** — type any text to find matching transactions.
- **All accounts** — narrow to one account.
- **All categories** — narrow to one category, or pick **Uncategorized** to find
  transactions that still need a label.
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

**The table** shows Date, Description, Account, Category, and Amount. When you're
on this page (not the dashboard), two extra things are true:

- The **Category** column is a dropdown — change it to instantly re-label that
  one transaction. (A transaction you've **split** across categories shows a
  **Split** link here instead of the dropdown — see below.)
- Each row has an **Edit** link (change any field) and a **Delete** button
  (remove it; it asks you to confirm).

The **Account** name in each row is a link that filters the table down to that
account.

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
single-category transaction.

**Export CSV** — next to the "Showing …" count sits an **Export CSV** link. It
downloads exactly the rows your current filters produce (not just the page
you're looking at) as a spreadsheet file — handy for taxes, sharing with an
accountant, or your own analysis. Clear the filters first to export everything.

**Pagination** — the table shows 50 transactions at a time. At the bottom you'll
see *"Showing 1–50 of 320"* with **← Prev** and **Next →** links. Your filters
carry across pages.

### 4.5 Import

Where you load a bank statement file. Covered in full in
[Section 7](#7-importing-bank-statements). In short: pick the account, choose the
`.csv` file your bank gave you, and click **Import statement**. The app tells you
how many transactions it added, skipped, or couldn't read.

---

## 5. Step-by-step recipes

Concrete, numbered walkthroughs for the things you'll actually do.

### Recipe A — Set up your first account

1. Go to **Accounts**.
2. Click **New account**.
3. Enter a **Name** (e.g. *Everyday Checking*).
4. Choose the **Type** (e.g. CHECKING).
5. Optionally add the **Institution** (your bank's name).
6. Set the **Opening balance** to whatever was in the account before your first
   statement. If you're starting from scratch, `0.00` is fine.
7. Click **Create account**.

Repeat for each real account you have (checking, credit card, cash, etc.).

### Recipe B — Import your first bank statement

1. **Get a CSV from your bank.** Log in to your bank's website, find your
   account's transaction history, and look for an **Export** or **Download**
   button. Choose the **CSV** format (sometimes labeled "spreadsheet" or
   "comma-separated"). Save the file somewhere you can find it.
2. In the app, go to **Import**.
3. Pick the **Account** this statement belongs to. (If you haven't made it yet,
   click **New account…** right there to create one without leaving the page.)
4. Click **Choose file** and select the CSV you downloaded (max size 5 MB).
5. Leave **Date format** on **Auto-detect** unless the import gets dates wrong
   (see [Section 7](#7-importing-bank-statements)).
6. Click **Import statement**.
7. Read the result: how many were **imported**, **skipped as duplicates**, and
   how many **rows had errors**. You're done.

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
npm run db:backup
```

This writes a timestamped copy into `data/backups/`. It's safe to run even while
the app is open. Do it regularly (or on a schedule).

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
4. Your browser downloads a `.csv` file containing exactly those rows. Open it in
   any spreadsheet program, or hand it to your accountant.

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
Categories page. It never overwrites a category you chose by hand.

### How duplicate detection works (and its one limit)

Every imported transaction gets a hidden fingerprint built from its account,
date, amount, cleaned-up description, and its position among identical rows. If a
new import produces a fingerprint the database already has, that row is
**skipped** instead of added. This is what makes re-importing the same file safe.

> **The one limitation to know about:** if the *exact same* transaction (same
> account, date, amount, and description) appears in **two different statement
> files**, the app can't tell the second one is a genuinely separate event — it
> looks identical to the first — so it skips it as a duplicate. That's why the
> import screen **lists every skipped row**. Scan that list; if one of them is a
> real second transaction, add it by hand ([Recipe D](#recipe-d--add-a-cash-purchase-by-hand)).

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
- **Uncategorized** transactions **do** count — a missing label never hides money
  from your totals.

The **Spending by category** chart uses the same rules and additionally leaves
out transfers, so the chart reflects real spending only.

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
  coming back **in**.

A typical accepted file looks like this:

```csv
Date,Description,Amount
2026-06-01,ACME CORP PAYROLL,2600.00
2026-06-02,CITYVIEW APARTMENTS RENT,"-$1,850.00"
2026-06-03,"WHOLE HARVEST MARKET, DOWNTOWN",-82.45
2026-06-04,BLUE DOOR CAFE,-14.75
```

If a required column is missing entirely, the app stops and gives you **one
clear message** ("Could not find a date … column. Headers seen: …") instead of
flagging every single row — so you know immediately it's a header problem, not
bad data.

### Advanced: telling the app which column is which

If your bank uses unusual header names the app doesn't recognize, expand
**Advanced: column mapping** on the Import screen. It gives you a box for each
field — **Date, Description, Amount, Debit, Credit** — where you type the *exact*
header text from your file. Fill in only the ones that need it; leave the rest
blank to keep auto-detection. For example, if your file's date column is headed
`Txn Day`, put `Txn Day` in the Date box and import as normal.

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

Auto-detect works for almost everything. Force a specific order only if you check
your imported dates and they look swapped (e.g. a June 3rd showing up as March
6th). When auto-detect meets a genuinely ambiguous date (like `03/04`, which
could be March 4th or April 3rd), it reads it as **MM/DD** and adds a
**warning** to the import result so you can re-import with the right order if
your bank uses DD/MM.

### The import result

After you click **Import statement**, you get a summary like:

> *"48 imported · 2 skipped as duplicates · 1 rows with errors"*

- **Imported** — new transactions added.
- **Skipped as duplicates** — already in your data; each is listed with its line
  number, date, amount, and description so you can check them (see the
  [duplicate limitation](#how-duplicate-detection-works-and-its-one-limit)).
- **Rows with errors** — lines the app couldn't read, each with its line number
  and the reason. Fix those lines in the file and re-import; the good rows are
  already saved and won't double up.
- **Warnings** — non-fatal notes (like the ambiguous-date warning above). The
  rows still imported; a warning is just a heads-up worth a glance.

### Undoing an import

Imported the wrong file, picked the wrong account, or realized the amounts were
parsed wrong? You don't have to hunt down the rows by hand. Below the import form
is a **Recent imports** list — one line per import that actually added
transactions, newest first, showing **when** it ran, the **account**, the
**file** name, and how many rows it **added**. Click **Undo** on any line and the
app permanently deletes exactly the transactions that import added — nothing
else. Rows you typed in by hand, and rows from other imports, are left alone.

A few things worth knowing:

- Undo asks you to confirm first, and tells you how many transactions it will
  remove.
- Even if you later re-categorized or edited one of those imported rows, Undo
  still removes it — it belongs to that import.
- An import that added **nothing** (every row was a duplicate) doesn't appear in
  the list, because there's nothing to undo.
- Undo is permanent; there's no "redo." But re-importing the same file puts the
  rows right back, so a mistaken undo is easy to reverse.

This is the clean way to recover from the re-import edge case described under
[duplicate detection](#how-duplicate-detection-works-and-its-one-limit): undo the
bad import, fix the file or the settings, and import again.

### Where to keep your statement files

Put real statement CSVs in the project's `data/imports/` folder. That folder —
and the database itself — is deliberately kept out of version control, so your
financial files are never uploaded or shared. The `data/samples/` folder holds
fake data for testing.

### Importing from the command line (optional)

If you prefer the terminal, you can import without the web page:

```bash
npm run import -- --file statement.csv --account "Everyday Checking" --type CHECKING --date-format MDY
```

`--type` and `--date-format` are optional. For unusual headers, the same column
mapping the web UI offers is available as flags — `--col-date "Txn Day"`,
`--col-amount "Value"`, and likewise `--col-description`, `--col-debit`,
`--col-credit`. Any warnings are printed alongside the imported/skipped counts.

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
3. On your phone, open the address Tailscale gives you — it looks like
   `https://your-computer.your-tailnet.ts.net`. Tailscale handles the secure
   `https` connection automatically.

Now only your own signed-in devices can reach the app. Your financial data still
never touches anyone else's server.

### Install it as an app on your phone (PWA)

Once you can open it on your phone over that `ts.net` address, you can add it to
your home screen so it opens like a real app:

- **Android (Chrome):** accept the install prompt, or tap **⋮ → Add to Home
  screen**.
- **iPhone (Safari):** tap **Share → Add to Home Screen**.

You'll get an icon and a clean, full-screen window. (There's intentionally no
offline mode — your data lives on the server computer, so the app needs to reach
it.)

> **Advanced / not recommended:** there are `npm run dev:lan` and
> `npm run start:lan` commands that expose the app to your whole local network
> **with no password**. Only use these if you fully understand the risk.
> Tailscale is the better choice.

---

## 9. Keeping your data safe

Everything lives in **one file**: `data/finance.db` inside the project folder.
That's great for privacy, but it means **you** are responsible for backups — no
cloud is doing it for you.

### Make a backup

```bash
npm run db:backup
```

This safely copies the database to `data/backups/finance-<timestamp>.db`, even
while the app is running. Run it often. (A good habit: back up before and after
importing a big statement.)

### Restore from a backup

1. **Stop the app** (Ctrl + C in its terminal).
2. Copy your chosen backup file over `data/finance.db` (replace the current one).
3. Delete the leftover helper files `data/finance.db-wal` and
   `data/finance.db-shm` if they exist.
4. **Start the app** again.

### Privacy reminders

- The app makes **zero** network calls while running. It doesn't phone home.
- The database and your imported statements are excluded from version control, so
  they can't be accidentally committed or uploaded.
- Because there's **no login**, treat "who can reach the app" as "who can see
  your money." Keep it on `127.0.0.1` or behind Tailscale.

---

## 10. Command cheat-sheet

Run these from the project folder in a terminal.

| Command | What it does |
|---|---|
| `npm install` | One-time: download the app's building blocks. |
| `npm run dev` | Start the app (development mode) at `http://127.0.0.1:3100`. |
| `npm run build` then `npm start` | Start the faster production version. |
| `npm run db:migrate` | Create/upgrade the database file. |
| `npm run db:seed` | Load six months of fake demo data (safe to repeat). |
| `npm run db:backup` | Make a timestamped backup in `data/backups/`. |
| `npm run import -- --file <f> --account "<name>"` | Import a statement from the terminal. |
| `npm run db:studio` | Open a database browser to inspect the raw data. |
| `npm test` | Run the app's automated self-checks. |

> **Tip:** in these commands, the app listens on port **3100** (not the usual
> 3000). If your browser shows nothing, double-check the address is
> `http://127.0.0.1:3100`.

---

## 11. Troubleshooting & FAQ

**The dashboard is blank / says "Welcome."**
You have no transactions yet. Run `npm run db:seed` for demo data, or go to
**Import** and load a statement.

**My credit card shows a negative balance — is that a bug?**
No, that's correct. A credit-card balance is money you **owe**, so it's stored as
a negative number. It correctly pulls your net worth down.

**My spending total looks too high — it's counting my credit-card payment.**
Label that payment (and its matching entry on the other account) as
**Transfers**. That category is excluded from spending totals. See
[Recipe E](#recipe-e--record-a-credit-card-payment-without-inflating-your-spending).

**The import said "could not reach the local server."**
The app isn't running, or you closed its terminal. Start it again with
`npm run dev` and retry the import.

**My imported dates look wrong (e.g. day and month swapped).**
Re-import and set the **Date format in file** dropdown to your bank's real order
(`MM/DD/YYYY` or `DD/MM/YYYY`) instead of Auto-detect.

**A transaction I know is real got "skipped as duplicate."**
It's identical (same account, date, amount, description) to one already in your
data, possibly from another file. If it's genuinely a separate transaction, add
it by hand ([Recipe D](#recipe-d--add-a-cash-purchase-by-hand)). This is the
known limitation described in [Section 6](#how-duplicate-detection-works-and-its-one-limit).

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
Amounts are shown in US dollars, and mixing currencies in one database isn't
supported yet, so stick to one currency. As a safeguard, if the app ever sees
accounts in more than one currency it shows a warning on the dashboard instead
of adding them into a meaningless net-worth total.

**How do I set a budget?**
On the **Categories** page, edit a category and fill in **Monthly budget**. The
dashboard then shows a Budget vs actual bar for it. See
[Recipe I](#recipe-i--set-a-monthly-budget-for-a-category).

**How do I get my transactions out of the app?**
Use the **Export CSV** link on the Transactions page — it downloads whatever
your current filters show. See [Recipe J](#recipe-j--export-transactions-to-a-spreadsheet).

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
