import { sql } from "drizzle-orm";
import type { Db } from "./client";
import {
  accounts,
  categories,
  importBatches,
  transactions,
  transactionSplits,
} from "./schema";
import {
  AppliedMigrationRow,
  assertCurrentMigrationHistory,
  CURRENT_SCHEMA_REQUIRED_MESSAGE,
  DemoSeedRefusal,
} from "./seed-target";
import { DEFAULT_CATEGORIES } from "../lib/default-categories";
import { computeImportHashes, type HashableRow } from "../lib/import-hash";
import {
  isBoolean,
  isSafeCents,
  normalizeAccountName,
  normalizeAccountType,
  normalizeCategoryColor,
  normalizeCategoryName,
  normalizeCurrencyCode,
  normalizeId,
  normalizeInstitution,
  normalizeKeywords,
  normalizeTransactionInput,
} from "../server/services/write-validation";

const INELIGIBLE_TARGET_MESSAGE =
  "Demo seed refused: the target is not empty or its categories are not the untouched defaults. Use an empty, current, disposable database.";

interface SeedTransaction extends HashableRow {
  category: string;
}

interface NormalizedDefaultCategory {
  name: string;
  color: string | null;
  keywords: string;
  excludeFromSpending: boolean;
}

export interface DemoSeedSummary {
  accounts: number;
  categories: number;
  transactions: number;
}

const ACCOUNT_DEFINITIONS = [
  {
    name: "Everyday Checking",
    type: "CHECKING",
    institution: "First Local Bank",
    currency: "USD",
    openingBalanceCents: 250_000,
  },
  {
    name: "Rewards Credit Card",
    type: "CREDIT_CARD",
    institution: "First Local Bank",
    currency: "USD",
    openingBalanceCents: 0,
  },
] as const;

function refuseIneligibleTarget(): never {
  throw new DemoSeedRefusal("ineligible-target", INELIGIBLE_TARGET_MESSAGE);
}

function readAppliedMigrations(db: Db): AppliedMigrationRow[] {
  try {
    return db.all<AppliedMigrationRow>(
      sql.raw(
        `SELECT hash, created_at AS createdAt
         FROM __drizzle_migrations
         ORDER BY created_at`,
      ),
    );
  } catch {
    throw new DemoSeedRefusal("schema-not-current", CURRENT_SCHEMA_REQUIRED_MESSAGE);
  }
}

function assertEmptyLedger(db: Db): void {
  const accountCount = db.select({ n: sql<number>`count(*)` }).from(accounts).get()?.n ?? 0;
  const transactionCount =
    db.select({ n: sql<number>`count(*)` }).from(transactions).get()?.n ?? 0;
  const importBatchCount =
    db.select({ n: sql<number>`count(*)` }).from(importBatches).get()?.n ?? 0;
  const splitCount =
    db.select({ n: sql<number>`count(*)` }).from(transactionSplits).get()?.n ?? 0;
  if (accountCount > 0 || transactionCount > 0 || importBatchCount > 0 || splitCount > 0) {
    refuseIneligibleTarget();
  }
}

function normalizeDefaultCategories(): NormalizedDefaultCategory[] {
  return DEFAULT_CATEGORIES.map((definition) => {
    const name = normalizeCategoryName(definition.name);
    const color = normalizeCategoryColor(definition.color);
    const keywords = normalizeKeywords(definition.keywords);
    const excludeFromSpending = definition.excludeFromSpending ?? false;
    if (
      !name ||
      color === undefined ||
      !keywords ||
      !isBoolean(excludeFromSpending)
    ) {
      throw new Error("Invalid built-in demo category definition.");
    }
    return {
      name,
      color,
      keywords: JSON.stringify(keywords),
      excludeFromSpending,
    };
  });
}

function loadOrInsertDefaultCategories(
  db: Db,
  createdAt: number,
): Map<string, string> {
  const defaults = normalizeDefaultCategories();
  const existing = db
    .select({
      id: categories.id,
      name: categories.name,
      color: categories.color,
      keywords: categories.keywords,
      excludeFromSpending: categories.excludeFromSpending,
      monthlyBudgetCents: categories.monthlyBudgetCents,
    })
    .from(categories)
    .all();

  if (existing.length === 0) {
    const ids = new Map<string, string>();
    for (const definition of defaults) {
      const row = db
        .insert(categories)
        .values({ ...definition, monthlyBudgetCents: null, createdAt })
        .returning({ id: categories.id, name: categories.name })
        .get();
      if (!row) throw new Error("Failed to insert a built-in demo category.");
      ids.set(row.name, row.id);
    }
    return ids;
  }

  if (existing.length !== defaults.length) refuseIneligibleTarget();
  const existingByName = new Map(existing.map((row) => [row.name, row]));
  const ids = new Map<string, string>();
  for (const definition of defaults) {
    const row = existingByName.get(definition.name);
    if (
      !row ||
      !normalizeId(row.id) ||
      row.color !== definition.color ||
      row.keywords !== definition.keywords ||
      row.excludeFromSpending !== definition.excludeFromSpending ||
      row.monthlyBudgetCents !== null
    ) {
      refuseIneligibleTarget();
    }
    ids.set(row.name, row.id);
  }
  return ids;
}

function insertAccounts(db: Db, timestamp: number): Map<string, string> {
  const ids = new Map<string, string>();
  for (const definition of ACCOUNT_DEFINITIONS) {
    const name = normalizeAccountName(definition.name);
    const type = normalizeAccountType(definition.type);
    const institution = normalizeInstitution(definition.institution);
    const currency = normalizeCurrencyCode(definition.currency);
    if (!name || !type || institution === undefined || !currency) {
      throw new Error("Invalid built-in demo account definition.");
    }
    if (currency !== "USD" || !isSafeCents(definition.openingBalanceCents)) {
      throw new Error("Invalid built-in demo account balance or currency.");
    }
    const row = db
      .insert(accounts)
      .values({
        name,
        type,
        institution,
        currency,
        openingBalanceCents: definition.openingBalanceCents,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning({ id: accounts.id, name: accounts.name })
      .get();
    if (!row) throw new Error("Failed to insert a built-in demo account.");
    ids.set(row.name, row.id);
  }
  return ids;
}

function vary(base: number, yearMonth: number, salt: number, spreadCents: number): number {
  const step = (yearMonth * 31 + salt * 7) % 5;
  return base + (step - 2) * Math.round(spreadCents / 4);
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function checkingMonth(year: number, month: number): SeedTransaction[] {
  const yearMonth = year * 12 + month;
  const date = (day: number) => isoDate(year, month, day);
  return [
    { date: date(1), description: "ACME CORP PAYROLL", amountCents: 260_000, category: "Income" },
    { date: date(15), description: "ACME CORP PAYROLL", amountCents: 260_000, category: "Income" },
    { date: date(2), description: "CITYVIEW APARTMENTS RENT", amountCents: -185_000, category: "Housing" },
    { date: date(5), description: "SHIELD AUTO INSURANCE", amountCents: -14_500, category: "Insurance" },
    { date: date(8), description: "METRO POWER & LIGHT", amountCents: vary(-9_200, yearMonth, 1, 3_200), category: "Utilities" },
    { date: date(10), description: "FIBERNET INTERNET", amountCents: -6_999, category: "Utilities" },
    { date: date(25), description: "PAYMENT TO REWARDS CARD", amountCents: -70_000, category: "Transfers" },
  ];
}

const DINING_SPOTS = [
  "BLUE DOOR CAFE",
  "GOLDEN NOODLE HOUSE",
  "LA PIAZZA PIZZA",
  "EL CAMINO TACO BAR",
  "RIVERSIDE GRILL",
] as const;

function creditCardMonth(year: number, month: number): SeedTransaction[] {
  const yearMonth = year * 12 + month;
  const date = (day: number) => isoDate(year, month, day);
  const dining = (index: number) =>
    DINING_SPOTS[(yearMonth + index * 3) % DINING_SPOTS.length] ?? DINING_SPOTS[0];
  return [
    { date: date(3), description: "WHOLE HARVEST MARKET", amountCents: vary(-7_800, yearMonth, 2, 2_400), category: "Groceries" },
    { date: date(9), description: "WHOLE HARVEST MARKET", amountCents: vary(-6_400, yearMonth, 3, 2_000), category: "Groceries" },
    { date: date(17), description: "WHOLE HARVEST MARKET", amountCents: vary(-8_900, yearMonth, 4, 2_800), category: "Groceries" },
    { date: date(24), description: "WHOLE HARVEST MARKET", amountCents: vary(-7_100, yearMonth, 5, 2_200), category: "Groceries" },
    { date: date(6), description: dining(0), amountCents: vary(-4_600, yearMonth, 6, 1_800), category: "Dining" },
    { date: date(13), description: dining(1), amountCents: vary(-6_200, yearMonth, 7, 2_400), category: "Dining" },
    { date: date(20), description: dining(2), amountCents: vary(-3_800, yearMonth, 8, 1_400), category: "Dining" },
    { date: date(7), description: "SHELL GAS STATION #42", amountCents: vary(-4_200, yearMonth, 9, 1_200), category: "Transportation" },
    { date: date(21), description: "SHELL GAS STATION #42", amountCents: vary(-3_900, yearMonth, 10, 1_200), category: "Transportation" },
    { date: date(12), description: "NETFLIX.COM", amountCents: -1_599, category: "Subscriptions" },
    { date: date(14), description: "SPOTIFY USA", amountCents: -1_199, category: "Subscriptions" },
    { date: date(11), description: "AMAZON MKTPLACE", amountCents: vary(-5_600, yearMonth, 11, 4_000), category: "Shopping" },
    { date: date(19), description: "CINEPLEX ODEON", amountCents: -2_800, category: "Entertainment" },
    { date: date(16), description: "GREENLEAF PHARMACY", amountCents: vary(-2_350, yearMonth, 12, 900), category: "Health" },
    { date: date(26), description: "PAYMENT RECEIVED - THANK YOU", amountCents: 70_000, category: "Transfers" },
  ];
}

function monthAnchors(anchor: Date): { year: number; month: number }[] {
  const months: { year: number; month: number }[] = [];
  for (let offset = 5; offset >= 0; offset--) {
    const date = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - offset, 1),
    );
    months.push({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 });
  }
  return months;
}

function insertTransactions(
  db: Db,
  accountIds: ReadonlyMap<string, string>,
  categoryIds: ReadonlyMap<string, string>,
  anchor: Date,
  timestamp: number,
): number {
  let inserted = 0;
  for (const [accountName, generate] of [
    ["Everyday Checking", checkingMonth],
    ["Rewards Credit Card", creditCardMonth],
  ] as const) {
    const accountId = accountIds.get(accountName);
    if (!accountId) throw new Error("Missing a built-in demo account.");
    const rows = monthAnchors(anchor).flatMap(({ year, month }) => generate(year, month));
    const hashes = computeImportHashes(accountId, rows);
    for (const [index, row] of rows.entries()) {
      const categoryId = categoryIds.get(row.category);
      if (!categoryId) throw new Error("Missing a built-in demo category.");
      const normalized = normalizeTransactionInput({
        accountId,
        categoryId,
        date: row.date,
        description: row.description,
        amountCents: row.amountCents,
      });
      if (!normalized.ok) {
        throw new Error(`Invalid built-in demo transaction field: ${normalized.result.field}.`);
      }
      const importHash = hashes[index];
      if (!importHash) throw new Error("Missing a built-in demo transaction hash.");
      const result = db
        .insert(transactions)
        .values({
          ...normalized.value,
          importHash,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
      if (result.changes !== 1) throw new Error("Failed to insert a built-in demo transaction.");
      inserted += 1;
    }
  }
  return inserted;
}

export function seedDemoData(
  db: Db,
  clock: () => Date = () => new Date(),
): DemoSeedSummary {
  const anchor = clock();
  const timestamp = anchor instanceof Date ? anchor.getTime() : Number.NaN;
  if (!Number.isSafeInteger(timestamp)) {
    throw new Error("Demo seed clock must return a finite Date.");
  }

  return db.transaction(
    (tx) => {
      assertCurrentMigrationHistory(readAppliedMigrations(tx));
      assertEmptyLedger(tx);
      const categoryIds = loadOrInsertDefaultCategories(tx, timestamp);
      const accountIds = insertAccounts(tx, timestamp);
      const transactionCount = insertTransactions(
        tx,
        accountIds,
        categoryIds,
        anchor,
        timestamp,
      );
      return {
        accounts: accountIds.size,
        categories: categoryIds.size,
        transactions: transactionCount,
      };
    },
    { behavior: "immediate" },
  );
}
