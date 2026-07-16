import { CATEGORICAL_SLOTS } from "./palette";

// The default category set: installed automatically on an empty database
// (src/db/default-categories.ts). The one-time demo initializer may install or
// exactly reuse this set, but never refreshes existing rows. Pure data — no DB
// access here.
export interface DefaultCategoryDef {
  name: string;
  color: string | null;
  keywords: string[];
  excludeFromSpending?: boolean;
}

const slot = (n: number) => CATEGORICAL_SLOTS[n - 1]?.light ?? null;

// First 8 take the validated palette slots in order; the tail stays neutral
// (never generate a 9th hue — badges render uncolored).
export const DEFAULT_CATEGORIES: readonly DefaultCategoryDef[] = [
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
