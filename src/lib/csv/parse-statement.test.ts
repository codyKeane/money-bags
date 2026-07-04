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

  it("collects malformed rows as errors while good rows succeed", () => {
    const { rows, errors } = parseStatementCsv(
      "Date,Description,Amount\nnot-a-date,BAD ROW,1.00\n2026-06-02,GOOD ROW,-2.00\n2026-06-03,NO AMOUNT,abc\n",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.description).toBe("GOOD ROW");
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ rowNumber: 2 });
    expect(errors[1]).toMatchObject({ rowNumber: 4 });
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
    expect(parseAmountToCents("1.234")).toBeNull();
  });
});
