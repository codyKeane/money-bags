import { describe, expect, it } from "vitest";
import { transactionsToCsv, type CsvTransactionRow } from "./export";

const row = (over: Partial<CsvTransactionRow> = {}): CsvTransactionRow => ({
  date: "2026-06-01",
  description: "CORNER MARKET",
  amountCents: -1234,
  accountName: "Everyday Checking",
  categoryName: "Groceries",
  ...over,
});

describe("transactionsToCsv", () => {
  it("emits a header row and trailing CRLF for an empty list", () => {
    expect(transactionsToCsv([])).toBe("Date,Description,Amount,Account,Category\r\n");
  });

  it("formats amounts as signed dollars with two decimals", () => {
    const csv = transactionsToCsv([
      row({ amountCents: -1234 }),
      row({ amountCents: 5000 }),
      row({ amountCents: 0 }),
    ]);
    const amounts = csv.trim().split("\r\n").slice(1).map((l) => l.split(",")[2]);
    expect(amounts).toEqual(["-12.34", "50.00", "0.00"]);
  });

  it("renders a null category as Uncategorized", () => {
    const csv = transactionsToCsv([row({ categoryName: null })]);
    expect(csv).toContain(",Uncategorized\r\n");
  });

  it("quotes and escapes fields containing commas, quotes, or newlines", () => {
    const csv = transactionsToCsv([
      row({ description: 'ACME, INC "PAYMENT"\nthanks' }),
    ]);
    expect(csv).toContain('"ACME, INC ""PAYMENT""\nthanks"');
  });

  it("uses CRLF between records", () => {
    const csv = transactionsToCsv([row(), row({ description: "SECOND" })]);
    expect(csv.split("\r\n")).toHaveLength(4); // header + 2 rows + trailing empty
  });
});
