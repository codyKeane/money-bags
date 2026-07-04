// Idempotent demo seed: accounts/categories upsert by unique name;
// transactions get real importHashes (dogfooding src/lib/import-hash) and
// insert with ON CONFLICT DO NOTHING, so re-running adds nothing. Rows are
// generated deterministically per CALENDAR MONTH (last 6 months up to the
// current UTC month), so runs in different months converge on the same rows
// for overlapping months.
try {
  process.loadEnvFile();
} catch {
  // no .env — client falls back to the default path
}

import { getDb } from "./client";
import { accounts, categories, transactions } from "./schema";
import { computeImportHashes, type HashableRow } from "../lib/import-hash";
import { CATEGORICAL_SLOTS } from "../lib/palette";

const db = getDb();

// ---------- categories ----------

const slot = (n: number) => CATEGORICAL_SLOTS[n - 1]?.light ?? null;

// First 8 take the validated palette slots in order; the tail stays neutral
// (never generate a 9th hue — badges render uncolored).
const CATEGORY_DEFS: {
  name: string;
  color: string | null;
  keywords: string[];
  excludeFromSpending?: boolean;
}[] = [
  { name: "Groceries", color: slot(1), keywords: ["market", "grocery", "supermarket", "harvest"] },
  { name: "Dining", color: slot(2), keywords: ["restaurant", "cafe", "coffee", "grill", "pizza", "noodle", "taco"] },
  { name: "Housing", color: slot(3), keywords: ["rent", "apartments", "mortgage"] },
  { name: "Transportation", color: slot(4), keywords: ["shell", "fuel", "gas station", "uber", "lyft", "transit"] },
  { name: "Utilities", color: slot(5), keywords: ["power", "light", "electric", "water", "internet", "fibernet"] },
  { name: "Shopping", color: slot(6), keywords: ["amazon", "mktplace", "target", "walmart"] },
  { name: "Entertainment", color: slot(7), keywords: ["cineplex", "cinema", "theater", "tickets"] },
  { name: "Subscriptions", color: slot(8), keywords: ["netflix", "spotify", "subscription"] },
  { name: "Income", color: null, keywords: ["payroll", "salary", "direct deposit"] },
  { name: "Health", color: null, keywords: ["pharmacy", "clinic", "dental"] },
  { name: "Insurance", color: null, keywords: ["insurance"] },
  {
    name: "Transfers",
    color: null,
    keywords: ["payment to rewards card", "payment received", "transfer"],
    excludeFromSpending: true,
  },
];

// ---------- deterministic transaction generation ----------

interface SeedTxn extends HashableRow {
  category: string | null;
}

// Small deterministic variance so months differ without randomness.
function vary(base: number, ym: number, salt: number, spreadCents: number): number {
  const step = (ym * 31 + salt * 7) % 5; // 0..4
  return base + (step - 2) * Math.round(spreadCents / 4);
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// rows for one calendar month (month: 1-12); ym = year*12+month for variance
function checkingMonth(year: number, month: number): SeedTxn[] {
  const ym = year * 12 + month;
  const d = (day: number) => isoDate(year, month, day);
  return [
    { date: d(1), description: "ACME CORP PAYROLL", amountCents: 260000, category: "Income" },
    { date: d(15), description: "ACME CORP PAYROLL", amountCents: 260000, category: "Income" },
    { date: d(2), description: "CITYVIEW APARTMENTS RENT", amountCents: -185000, category: "Housing" },
    { date: d(5), description: "SHIELD AUTO INSURANCE", amountCents: -14500, category: "Insurance" },
    { date: d(8), description: "METRO POWER & LIGHT", amountCents: vary(-9200, ym, 1, 3200), category: "Utilities" },
    { date: d(10), description: "FIBERNET INTERNET", amountCents: -6999, category: "Utilities" },
    { date: d(25), description: "PAYMENT TO REWARDS CARD", amountCents: -70000, category: "Transfers" },
  ];
}

const DINING_SPOTS = [
  "BLUE DOOR CAFE",
  "GOLDEN NOODLE HOUSE",
  "LA PIAZZA PIZZA",
  "EL CAMINO TACO BAR",
  "RIVERSIDE GRILL",
];

function creditCardMonth(year: number, month: number): SeedTxn[] {
  const ym = year * 12 + month;
  const d = (day: number) => isoDate(year, month, day);
  const dining = (i: number) =>
    DINING_SPOTS[(ym + i * 3) % DINING_SPOTS.length] ?? DINING_SPOTS[0]!;
  return [
    { date: d(3), description: "WHOLE HARVEST MARKET", amountCents: vary(-7800, ym, 2, 2400), category: "Groceries" },
    { date: d(9), description: "WHOLE HARVEST MARKET", amountCents: vary(-6400, ym, 3, 2000), category: "Groceries" },
    { date: d(17), description: "WHOLE HARVEST MARKET", amountCents: vary(-8900, ym, 4, 2800), category: "Groceries" },
    { date: d(24), description: "WHOLE HARVEST MARKET", amountCents: vary(-7100, ym, 5, 2200), category: "Groceries" },
    { date: d(6), description: dining(0), amountCents: vary(-4600, ym, 6, 1800), category: "Dining" },
    { date: d(13), description: dining(1), amountCents: vary(-6200, ym, 7, 2400), category: "Dining" },
    { date: d(20), description: dining(2), amountCents: vary(-3800, ym, 8, 1400), category: "Dining" },
    { date: d(7), description: "SHELL GAS STATION #42", amountCents: vary(-4200, ym, 9, 1200), category: "Transportation" },
    { date: d(21), description: "SHELL GAS STATION #42", amountCents: vary(-3900, ym, 10, 1200), category: "Transportation" },
    { date: d(12), description: "NETFLIX.COM", amountCents: -1599, category: "Subscriptions" },
    { date: d(14), description: "SPOTIFY USA", amountCents: -1199, category: "Subscriptions" },
    { date: d(11), description: "AMAZON MKTPLACE", amountCents: vary(-5600, ym, 11, 4000), category: "Shopping" },
    { date: d(19), description: "CINEPLEX ODEON", amountCents: -2800, category: "Entertainment" },
    { date: d(16), description: "GREENLEAF PHARMACY", amountCents: vary(-2350, ym, 12, 900), category: "Health" },
    { date: d(26), description: "PAYMENT RECEIVED - THANK YOU", amountCents: 70000, category: "Transfers" },
  ];
}

// ---------- run ----------

async function main() {
  // Accounts (upsert by unique name)
  const accountDefs = [
    {
      name: "Everyday Checking",
      type: "CHECKING",
      institution: "First Local Bank",
      openingBalanceCents: 250000,
    },
    {
      name: "Rewards Credit Card",
      type: "CREDIT_CARD",
      institution: "First Local Bank",
      openingBalanceCents: 0,
    },
  ];
  const accountIds = new Map<string, string>();
  for (const def of accountDefs) {
    const [row] = await db
      .insert(accounts)
      .values(def)
      .onConflictDoUpdate({
        target: accounts.name,
        set: {
          type: def.type,
          institution: def.institution,
          openingBalanceCents: def.openingBalanceCents,
        },
      })
      .returning({ id: accounts.id, name: accounts.name });
    if (!row) throw new Error(`upsert failed for account ${def.name}`);
    accountIds.set(row.name, row.id);
  }

  // Categories (upsert by unique name)
  const categoryIds = new Map<string, string>();
  for (const def of CATEGORY_DEFS) {
    const [row] = await db
      .insert(categories)
      .values({
        name: def.name,
        color: def.color,
        keywords: JSON.stringify(def.keywords),
        excludeFromSpending: def.excludeFromSpending ?? false,
      })
      .onConflictDoUpdate({
        target: categories.name,
        set: {
          color: def.color,
          keywords: JSON.stringify(def.keywords),
          excludeFromSpending: def.excludeFromSpending ?? false,
        },
      })
      .returning({ id: categories.id, name: categories.name });
    if (!row) throw new Error(`upsert failed for category ${def.name}`);
    categoryIds.set(row.name, row.id);
  }

  // Transactions: last 6 calendar months incl. current, per account
  const now = new Date();
  const months: { year: number; month: number }[] = [];
  for (let offset = 5; offset >= 0; offset--) {
    const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    months.push({ year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1 });
  }

  let inserted = 0;
  let skipped = 0;
  for (const [accountName, generate] of [
    ["Everyday Checking", checkingMonth],
    ["Rewards Credit Card", creditCardMonth],
  ] as const) {
    const accountId = accountIds.get(accountName);
    if (!accountId) throw new Error(`missing account ${accountName}`);
    const rows = months.flatMap(({ year, month }) => generate(year, month));
    const hashes = computeImportHashes(accountId, rows);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const result = await db
        .insert(transactions)
        .values({
          date: row.date,
          description: row.description,
          amountCents: row.amountCents,
          accountId,
          categoryId: row.category ? (categoryIds.get(row.category) ?? null) : null,
          importHash: hashes[i],
        })
        .onConflictDoNothing({ target: transactions.importHash });
      if (result.changes > 0) inserted++;
      else skipped++;
    }
  }

  console.log(
    `Seed complete: ${accountIds.size} accounts, ${categoryIds.size} categories, ` +
      `${inserted} transactions inserted, ${skipped} already present.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
