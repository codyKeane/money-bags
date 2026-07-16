import { describe, expect, it } from "vitest";
import { parseAmountToCents, parseStatementCsv } from "./parse-statement";

describe("parseStatementCsv", () => {
  it("parses a basic 3-column ISO statement", () => {
    const { rows, errors } = parseStatementCsv(
      "Date,Description,Amount\n2026-06-01,ACME PAYROLL,2600.00\n2026-06-03,COFFEE SHOP,-4.50\n",
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { rowNumber: 2, date: "2026-06-01", description: "ACME PAYROLL", amountCents: 260000 },
      { rowNumber: 3, date: "2026-06-03", description: "COFFEE SHOP", amountCents: -450 },
    ]);
  });

  it("handles quoted descriptions containing commas", () => {
    const { rows, errors } = parseStatementCsv(
      'Date,Description,Amount\n2026-06-05,"AMAZON MKTPLACE, SEATTLE WA",-35.99\n',
    );
    expect(errors).toEqual([]);
    expect(rows[0]?.description).toBe("AMAZON MKTPLACE, SEATTLE WA");
    expect(rows[0]?.amountCents).toBe(-3599);
  });

  it("normalizes currency symbols and thousands separators", () => {
    const { rows } = parseStatementCsv(
      "Date,Description,Amount\n2026-06-01,RENT,\"-$1,850.00\"\n",
    );
    expect(rows[0]?.amountCents).toBe(-185000);
  });

  it("treats parenthesized amounts as negative", () => {
    const { rows } = parseStatementCsv(
      'Date,Description,Amount\n2026-06-02,UTILITY CO,"(92.31)"\n',
    );
    expect(rows[0]?.amountCents).toBe(-9231);
  });

  it("treats trailing-minus amounts as negative", () => {
    const { rows } = parseStatementCsv(
      "Date,Description,Amount\n2026-06-02,GAS STATION,45.00-\n",
    );
    expect(rows[0]?.amountCents).toBe(-4500);
  });

  it("merges split Debit/Credit columns with correct signs", () => {
    const { rows, errors } = parseStatementCsv(
      "Date,Description,Debit,Credit\n2026-06-01,GROCERY,78.12,\n2026-06-02,PAYCHECK,,2600.00\n",
    );
    expect(errors).toEqual([]);
    expect(rows[0]?.amountCents).toBe(-7812);
    expect(rows[1]?.amountCents).toBe(260000);
  });

  it("keeps the sign of negative Debit/Credit values (refunds and reversals)", () => {
    const { rows, errors } = parseStatementCsv(
      "Date,Description,Debit,Credit\n2026-06-01,REFUND,-25.00,\n2026-06-02,REVERSAL,,-25.00\n",
    );
    expect(errors).toEqual([]);
    expect(rows[0]?.amountCents).toBe(2500); // negative debit = money back in
    expect(rows[1]?.amountCents).toBe(-2500); // negative credit = money back out
  });

  it("prefers Description over Memo when both columns exist", () => {
    const populated = parseStatementCsv(
      "Date,Description,Memo,Amount\n2026-06-01,REAL DESC,note text,-4.50\n",
    );
    expect(populated.errors).toEqual([]);
    expect(populated.rows[0]?.description).toBe("REAL DESC");
    // an empty memo must not blank the description and drop the row
    const emptyMemo = parseStatementCsv(
      "Date,Description,Memo,Amount\n2026-06-01,REAL DESC,,-4.50\n",
    );
    expect(emptyMemo.errors).toEqual([]);
    expect(emptyMemo.rows[0]?.description).toBe("REAL DESC");
  });

  it("prefers Transaction Date over Posted Date and Payee over Memo", () => {
    const { rows, errors } = parseStatementCsv(
      "Transaction Date,Posted Date,Payee,Memo,Amount\n2026-06-01,2026-06-03,MERCHANT,note,-1.00\n",
    );
    expect(errors).toEqual([]);
    expect(rows[0]?.date).toBe("2026-06-01");
    expect(rows[0]?.description).toBe("MERCHANT");
  });

  it("lets columnMap overrides displace a competing synonym column", () => {
    const { rows, errors } = parseStatementCsv(
      "Date,Description,Memo,Amount\n2026-06-01,ignored,USE THIS,-1.00\n",
      { columnMap: { description: "Memo" } },
    );
    expect(errors).toEqual([]);
    expect(rows[0]?.description).toBe("USE THIS");
  });

  it("uses the first column when identical headers are duplicated", () => {
    const { rows, errors } = parseStatementCsv(
      "Date,Description,Description,Amount\n2026-06-01,FIRST,SECOND,-1.00\n",
    );
    expect(errors).toEqual([]);
    expect(rows[0]?.description).toBe("FIRST");
  });

  it("respects MDY vs DMY date formats", () => {
    const csv = "Date,Description,Amount\n02/03/2026,SHOP,-1.00\n";
    expect(parseStatementCsv(csv, { dateFormat: "MDY" }).rows[0]?.date).toBe("2026-02-03");
    expect(parseStatementCsv(csv, { dateFormat: "DMY" }).rows[0]?.date).toBe("2026-03-02");
    // auto: unambiguous day > 12 forces DMY
    const auto = parseStatementCsv(
      "Date,Description,Amount\n25/03/2026,SHOP,-1.00\n",
    );
    expect(auto.rows[0]?.date).toBe("2026-03-25");
  });

  it("tolerates BOM and CRLF line endings", () => {
    const { rows, errors } = parseStatementCsv(
      "﻿Date,Description,Amount\r\n2026-06-01,SALARY,2600.00\r\n",
    );
    expect(errors).toEqual([]);
    expect(rows[0]?.date).toBe("2026-06-01");
  });

  it("rejects the whole file when any row is malformed", () => {
    const result = parseStatementCsv(
      "Date,Description,Amount\nnot-a-date,BAD ROW,1.00\n2026-06-02,GOOD ROW,-2.00\n2026-06-03,NO AMOUNT,abc\n",
    );
    expect(result.status).toBe("invalid-file");
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatchObject({ rowNumber: 2 });
    expect(result.errors[1]).toMatchObject({ rowNumber: 4 });
  });

  it("returns empty results for a header-only file", () => {
    const { rows, errors } = parseStatementCsv("Date,Description,Amount\n");
    expect(rows).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("maps header synonyms (Posted Date / Memo)", () => {
    const { rows, errors } = parseStatementCsv(
      "Posted Date,Memo,Amount\n2026-06-01,TRANSIT PASS,-50.00\n",
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ date: "2026-06-01", description: "TRANSIT PASS" });
  });

  it("honors columnMap overrides", () => {
    const { rows, errors } = parseStatementCsv(
      "When,What,How Much\n2026-06-01,THING,-1.23\n",
      { columnMap: { date: "When", description: "What", amount: "How Much" } },
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ date: "2026-06-01", description: "THING", amountCents: -123 });
  });

  it("emits a single file-level error when a required column is missing (F3)", () => {
    const { rows, errors } = parseStatementCsv(
      "Date,Notes\n2026-06-01,no amount here\n2026-06-02,still none\n",
    );
    expect(rows).toEqual([]);
    // One error for the file, NOT one per data row.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ rowNumber: 0 });
    expect(errors[0]?.message).toMatch(/description/);
    expect(errors[0]?.message).toMatch(/amount/);
  });

  it("a columnMap rescues a file whose required column has an unknown header (F3)", () => {
    const { rows, errors } = parseStatementCsv(
      "Date,Notes,Value\n2026-06-01,COFFEE,-3.50\n",
      { columnMap: { description: "Notes", amount: "Value" } },
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ description: "COFFEE", amountCents: -350 });
  });

  it("requires an explicit format before exposing ambiguous auto-date rows", () => {
    const result = parseStatementCsv(
      "Date,Description,Amount\n03/04/2026,THING,-1.00\n",
    );
    expect(result).toMatchObject({
      status: "date-format-required",
      rows: [],
      errors: [],
      ambiguousRowNumbers: [2],
    });
  });

  it("does not warn on unambiguous or explicitly-formatted dates (F3)", () => {
    // 25 > 12 forces DMY — unambiguous.
    expect(parseStatementCsv("Date,Description,Amount\n25/12/2026,GIFT,-1.00\n").warnings).toEqual(
      [],
    );
    // Explicit format = the user already told us; no guess to warn about.
    expect(
      parseStatementCsv("Date,Description,Amount\n03/04/2026,THING,-1.00\n", {
        dateFormat: "MDY",
      }).warnings,
    ).toEqual([]);
  });

  it("accepts ISO, equal-component, and component-over-12 dates in auto mode", () => {
    const result = parseStatementCsv(
      [
        "Date,Description,Amount",
        "2026-05-01,ISO,-1.00",
        "05/05/2026,EQUAL,-2.00",
        "25/12/2026,DAY FIRST,-3.00",
        "12/25/2026,MONTH FIRST,-4.00",
      ].join("\n"),
    );
    expect(result.status).toBe("ready");
    expect(result.rows.map((row) => row.date)).toEqual([
      "2026-05-01",
      "2026-05-05",
      "2026-12-25",
      "2026-12-25",
    ]);
  });

  it("prefers invalid-file over ambiguity and never exposes a valid subset", () => {
    const result = parseStatementCsv(
      "Date,Description,Amount\n03/04/2026,AMBIGUOUS,-1.00\n2026-06-02,BAD,not-money\n",
    );
    expect(result.status).toBe("invalid-file");
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ rowNumber: 3, message: "Unparseable amount" }]);
  });

  it.each([
    ["inconsistent columns", "Date,Description,Amount\n2026-06-01,ONE,-1.00,EXTRA\n"],
    ["malformed quotes", 'Date,Description,Amount\n2026-06-01,"UNCLOSED,-1.00\n'],
  ])("rejects %s as an invalid whole file", (_label, csv) => {
    const result = parseStatementCsv(csv);
    expect(result.status).toBe("invalid-file");
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toBe("Unparseable CSV structure");
  });

  it.each([
    ["12.34", "0.00", -1234],
    ["0", "12.34", 1234],
    ["-12.34", "0", 1234],
    ["0", "-12.34", -1234],
    ["0", "0", 0],
    ["0", "", 0],
    ["", "0", 0],
    ["-0.00", "", 0],
    ["(0.00)", "", 0],
    ["0.00-", "", 0],
  ])("parses Debit=%j Credit=%j as exact cents %i", (debit, credit, expected) => {
    const result = parseStatementCsv(
      `Date,Description,Debit,Credit\n2026-06-01,ROW,${debit},${credit}\n`,
    );
    expect(result.status).toBe("ready");
    expect(result.rows[0]?.amountCents).toBe(expected);
    expect(Object.is(result.rows[0]?.amountCents, -0)).toBe(false);
  });

  it.each([
    ["12.34", "56.78", "Both debit and credit contain nonzero values"],
    ["garbage", "12.34", "Unparseable debit"],
    ["", "", "No amount, debit, or credit value"],
  ])("rejects invalid Debit=%j Credit=%j without rows", (debit, credit, message) => {
    const result = parseStatementCsv(
      `Date,Description,Debit,Credit\n2026-06-01,ROW,${debit},${credit}\n`,
    );
    expect(result.status).toBe("invalid-file");
    expect(result.rows).toEqual([]);
    expect(result.errors).toContainEqual({ rowNumber: 2, message });
  });

  it("keeps a populated canonical Amount column authoritative", () => {
    const result = parseStatementCsv(
      "Date,Description,Amount,Debit,Credit\n2026-06-01,ROW,-1.23,garbage,99.00\n",
    );
    expect(result.status).toBe("ready");
    expect(result.rows[0]?.amountCents).toBe(-123);
  });

  it.each([
    [null, "invalid-shape"],
    [[], "invalid-shape"],
    ["not-an-object", "invalid-shape"],
    [{}, "empty-map"],
    [{ unknown: "Date" }, "unknown-field"],
    [{ date: 42 }, "invalid-header"],
    [{ date: "" }, "invalid-header"],
    [{ date: "x".repeat(121) }, "invalid-header"],
    [{ date: "Date\u0007" }, "invalid-header"],
    [{ date: " Date ", description: "date" }, "duplicate-claim"],
  ])("strictly rejects column map %j", (columnMap, code) => {
    const result = parseStatementCsv(
      "Date,Description,Amount\n2026-06-01,ROW,-1.00\n",
      { columnMap },
    );
    expect(result.status).toBe("invalid-column-map");
    if (result.status === "invalid-column-map") {
      expect(result.issues.some((issue) => issue.code === code)).toBe(true);
    }
    expect(result.rows).toEqual([]);
  });

  it("rejects mapped headers that are missing or duplicated in the file", () => {
    const missing = parseStatementCsv(
      "Date,Description,Amount\n2026-06-01,ROW,-1.00\n",
      { columnMap: { description: "Memo" } },
    );
    expect(missing.status).toBe("invalid-column-map");
    if (missing.status === "invalid-column-map") {
      expect(missing.issues).toContainEqual(
        expect.objectContaining({ field: "description", code: "missing-header" }),
      );
    }

    const duplicated = parseStatementCsv(
      "Date,Memo,Memo,Amount\n2026-06-01,FIRST,SECOND,-1.00\n",
      { columnMap: { description: "Memo" } },
    );
    expect(duplicated.status).toBe("invalid-column-map");
    if (duplicated.status === "invalid-column-map") {
      expect(duplicated.issues).toContainEqual(
        expect.objectContaining({ field: "description", code: "duplicate-header" }),
      );
    }
  });
});

describe("parseAmountToCents", () => {
  it("parses integer-dollar and single-decimal amounts", () => {
    expect(parseAmountToCents("12")).toBe(1200);
    expect(parseAmountToCents("12.5")).toBe(1250);
    expect(parseAmountToCents("+3.07")).toBe(307);
  });

  it("rejects garbage", () => {
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents(".5")).toBeNull();
    expect(parseAmountToCents("+-3.00")).toBeNull();
    expect(parseAmountToCents("-+3.00")).toBeNull();
    expect(parseAmountToCents("1.234")).toBeNull();
    expect(parseAmountToCents("1.005")).toBeNull();
  });

  it("parses unambiguous European decimal commas", () => {
    expect(parseAmountToCents("45,00")).toBe(4500);
    expect(parseAmountToCents("1234,56")).toBe(123456);
    expect(parseAmountToCents("(45,00)")).toBe(-4500);
    expect(parseAmountToCents("€45,00")).toBe(4500);
    expect(parseAmountToCents("1 234,56")).toBe(123456);
  });

  it("rejects ambiguous mixed-separator forms instead of guessing", () => {
    expect(parseAmountToCents("1.234,56")).toBeNull();
    expect(parseAmountToCents("1,234,56")).toBeNull();
  });

  it("keeps US thousands-separator semantics", () => {
    expect(parseAmountToCents("12,345")).toBe(1234500);
    expect(parseAmountToCents("1,234.56")).toBe(123456);
    expect(parseAmountToCents("-$1,850.00")).toBe(-185000);
  });

  it("rejects amounts past the safe-integer cents boundary", () => {
    expect(parseAmountToCents("90071992547409.91")).toBe(9007199254740991);
    expect(parseAmountToCents("-90071992547409.91")).toBe(-9007199254740991);
    expect(parseAmountToCents("90071992547409.92")).toBeNull();
    expect(parseAmountToCents("99999999999999999.99")).toBeNull();
  });

  it("normalizes negative zero after bank-format sign handling", () => {
    expect(parseAmountToCents("-0.00")).toBe(0);
    expect(Object.is(parseAmountToCents("(0.00)"), -0)).toBe(false);
  });
});
