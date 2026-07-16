export type AccountCurrencyState =
  | { kind: "valid"; currency: string }
  | { kind: "invalid" };

export type CurrencyState =
  | { kind: "empty" }
  | { kind: "single"; currency: string }
  | { kind: "mixed"; currencies: string[] }
  | { kind: "invalid"; accounts: Array<{ id: string; name: string }> };

interface PersistedAccountCurrency {
  id: string;
  name: string;
  rawCurrency: unknown;
}

// Intl accepts well-formed identifiers beyond currencies currently in active
// circulation. This check intentionally guarantees a structurally valid code
// that this runtime can render; it is not a currency-registry lookup.
export function normalizeCurrencyCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) return null;

  try {
    const formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalized,
    });
    formatter.format(0);
    return normalized;
  } catch {
    return null;
  }
}

export function inspectCurrencyCode(value: unknown): AccountCurrencyState {
  const currency = normalizeCurrencyCode(value);
  return currency ? { kind: "valid", currency } : { kind: "invalid" };
}

function compareAccountIdentity(
  left: { id: string; name: string },
  right: { id: string; name: string },
): number {
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

export function deriveCurrencyState(accounts: PersistedAccountCurrency[]): CurrencyState {
  if (accounts.length === 0) return { kind: "empty" };

  const currencies = new Set<string>();
  const invalidAccounts: Array<{ id: string; name: string }> = [];

  for (const account of accounts) {
    const state = inspectCurrencyCode(account.rawCurrency);
    if (state.kind === "valid") {
      currencies.add(state.currency);
    } else {
      invalidAccounts.push({ id: account.id, name: account.name });
    }
  }

  if (invalidAccounts.length > 0) {
    return { kind: "invalid", accounts: invalidAccounts.sort(compareAccountIdentity) };
  }

  const sortedCurrencies = [...currencies].sort();
  const [currency] = sortedCurrencies;
  return currency && sortedCurrencies.length === 1
    ? { kind: "single", currency }
    : { kind: "mixed", currencies: sortedCurrencies };
}
