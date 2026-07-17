import { describe, expect, it } from "vitest";
import {
  ANNOTATED_EXPORT_HEADER,
  DETAILED_EXPORT_HEADER,
  LEGACY_EXPORT_HEADER,
  serializeExportRow,
  spreadsheetSafeText,
} from "./transaction-export";

interface ExportRow {
  date: string;
  description: string;
  amountCents: number;
  currency: string;
  accountName: string;
  categoryName: string | null;
  isSplit: boolean;
  splitDetails: { category: string | null; amountCents: number }[];
  notes: string;
  tags: string[];
}

function row(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    date: "2026-06-01",
    description: "CORNER MARKET",
    amountCents: -1234,
    currency: "USD",
    accountName: "Everyday Checking",
    categoryName: "Groceries",
    isSplit: false,
    splitDetails: [],
    notes: "",
    tags: [],
    ...overrides,
  };
}

describe("transaction export headers", () => {
  it("keeps the legacy compatibility header exact", () => {
    expect(LEGACY_EXPORT_HEADER).toBe("Date,Description,Amount,Account,Category");
  });

  it("keeps the detailed header exact", () => {
    expect(DETAILED_EXPORT_HEADER).toBe(
      "Date,Description,Amount,Currency,Account,Category,Split Details",
    );
  });

  it("adds annotations only in the annotated format", () => {
    expect(ANNOTATED_EXPORT_HEADER).toBe(
      "Date,Description,Amount,Currency,Account,Category,Split Details,Notes,Tags",
    );
    const annotated = row({
      notes: "\t=private, note",
      tags: ["reimbursable", "work"],
    });
    expect(serializeExportRow(annotated, "detailed")).toBe(
      "2026-06-01,CORNER MARKET,-12.34,USD,Everyday Checking,Groceries,",
    );
    expect(serializeExportRow(annotated, "annotated")).toBe(
      '2026-06-01,CORNER MARKET,-12.34,USD,Everyday Checking,Groceries,,"\'\t=private, note","[""reimbursable"",""work""]"',
    );
  });
});

describe("spreadsheetSafeText", () => {
  it("prefixes every dangerous marker with exactly one apostrophe", () => {
    for (const marker of ["=", "+", "-", "@"]) {
      expect(spreadsheetSafeText(`${marker}PAYLOAD`)).toBe(`'${marker}PAYLOAD`);
    }
  });

  it("detects a marker after every leading U+0000 through U+0020 character", () => {
    for (let codePoint = 0; codePoint <= 0x20; codePoint += 1) {
      const leading = String.fromCharCode(codePoint);
      for (const marker of ["=", "+", "-", "@"]) {
        const value = `${leading}${marker}PAYLOAD`;
        expect(spreadsheetSafeText(value), `U+${codePoint.toString(16).padStart(4, "0")}`).toBe(
          `'${value}`,
        );
      }
    }
  });

  it("handles multiple leading controls and does not alter ordinary text", () => {
    expect(spreadsheetSafeText("\u0000\t \r\n=PAYLOAD")).toBe("'\u0000\t \r\n=PAYLOAD");
    expect(spreadsheetSafeText("merchant - refund")).toBe("merchant - refund");
    expect(spreadsheetSafeText("already '=literal")).toBe("already '=literal");
    expect(spreadsheetSafeText("'=PAYLOAD")).toBe("'=PAYLOAD");
  });
});

describe("serializeExportRow", () => {
  it("applies RFC 4180 quoting after spreadsheet protection", () => {
    const output = serializeExportRow(
      row({
        description: "\t=SUM(1,2)",
        accountName: 'A "checking"',
        categoryName: "Food,\r\nDining",
      }),
      "detailed",
    );

    expect(output).toBe(
      '2026-06-01,"\'\t=SUM(1,2)",-12.34,USD,"A ""checking""","Food,\r\nDining",',
    );
  });

  it("marks split parents without exposing their ignored parent category", () => {
    const split = row({
      categoryName: "IGNORED PARENT",
      isSplit: true,
      splitDetails: [
        { category: "Groceries", amountCents: -500 },
        { category: null, amountCents: -734 },
      ],
    });

    expect(serializeExportRow(split, "legacy")).toBe(
      "2026-06-01,CORNER MARKET,-12.34,Everyday Checking,Split",
    );
    expect(serializeExportRow(split, "detailed")).toBe(
      '2026-06-01,CORNER MARKET,-12.34,USD,Everyday Checking,Split,"[{""category"":""Groceries"",""amountCents"":-500},{""category"":null,""amountCents"":-734}]"',
    );
  });

  it("sorts compact split JSON by binary category, null last, then amount", () => {
    const splitDetails = [
      { category: null, amountCents: 2 },
      { category: "apple", amountCents: 3 },
      { category: "Zebra", amountCents: -2 },
      { category: "apple", amountCents: -4 },
      { category: "éclair", amountCents: -1 },
      { category: null, amountCents: -5 },
      { category: "apple", amountCents: -4 },
    ];
    const before = structuredClone(splitDetails);
    const input = row({ isSplit: true, splitDetails });

    const first = serializeExportRow(input, "detailed");
    const second = serializeExportRow(input, "detailed");

    expect(first).toBe(
      '2026-06-01,CORNER MARKET,-12.34,USD,Everyday Checking,Split,"[{""category"":""Zebra"",""amountCents"":-2},{""category"":""apple"",""amountCents"":-4},{""category"":""apple"",""amountCents"":-4},{""category"":""apple"",""amountCents"":3},{""category"":""éclair"",""amountCents"":-1},{""category"":null,""amountCents"":-5},{""category"":null,""amountCents"":2}]"',
    );
    expect(second).toBe(first);
    expect(splitDetails).toEqual(before);
  });

  it("serializes all safe cent boundaries exactly", () => {
    const cases = [
      [Number.MIN_SAFE_INTEGER, "-90071992547409.91"],
      [-9007199254740990, "-90071992547409.90"],
      [-1234, "-12.34"],
      [-1, "-0.01"],
      [0, "0.00"],
      [1, "0.01"],
      [9007199254740990, "90071992547409.90"],
      [Number.MAX_SAFE_INTEGER, "90071992547409.91"],
    ] as const;

    for (const [amountCents, decimal] of cases) {
      expect(serializeExportRow(row({ amountCents }), "legacy")).toBe(
        `2026-06-01,CORNER MARKET,${decimal},Everyday Checking,Groceries`,
      );
    }
  });

  it("rejects unsafe parent or split cents instead of emitting rounded values", () => {
    expect(() =>
      serializeExportRow(row({ amountCents: Number.MAX_SAFE_INTEGER + 1 }), "legacy"),
    ).toThrow(RangeError);
    expect(() =>
      serializeExportRow(
        row({
          isSplit: true,
          splitDetails: [{ category: "Groceries", amountCents: Number.MAX_SAFE_INTEGER + 1 }],
        }),
        "detailed",
      ),
    ).toThrow(RangeError);
  });

  it("protects every textual column while leaving negative Amount numeric", () => {
    const output = serializeExportRow(
      row({
        description: "\u0000+DESCRIPTION",
        amountCents: -1234,
        currency: "\u001f-USD",
        accountName: "\t@ACCOUNT",
        categoryName: " =CATEGORY",
      }),
      "detailed",
    );

    expect(output).toBe(
      "2026-06-01,'\u0000+DESCRIPTION,-12.34,'\u001f-USD,'\t@ACCOUNT,' =CATEGORY,",
    );
    expect(output).not.toContain("'-12.34");
  });

  it("rejects an invalid date-only value rather than treating Date as arbitrary text", () => {
    expect(() => serializeExportRow(row({ date: "=TODAY()" }), "detailed")).toThrow(
      RangeError,
    );
  });

  it("preserves Unicode and does not add a byte-order mark", () => {
    const output = serializeExportRow(
      row({
        description: "東京 café 🙂",
        currency: "EUR",
        accountName: "Crédit",
        categoryName: "Café",
      }),
      "detailed",
    );

    expect(output).toBe("2026-06-01,東京 café 🙂,-12.34,EUR,Crédit,Café,");
    expect(LEGACY_EXPORT_HEADER.startsWith("\uFEFF")).toBe(false);
    expect(DETAILED_EXPORT_HEADER.startsWith("\uFEFF")).toBe(false);
    expect(output.startsWith("\uFEFF")).toBe(false);
  });
});
