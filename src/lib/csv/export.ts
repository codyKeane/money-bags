// RFC 4180 CSV serialization of ledger rows for the "Export CSV" feature (F2).
// Pure and structurally typed so it stays in the DB-free lib layer — any object
// with these fields (e.g. TransactionListItem) works.

export interface CsvTransactionRow {
  date: string;
  description: string;
  amountCents: number;
  accountName: string;
  categoryName: string | null;
}

const HEADERS = ["Date", "Description", "Amount", "Account", "Category"] as const;

// Quote when the field holds a comma, double-quote, CR or LF; double any
// embedded quotes. Numeric/date fields never need it but pass through unchanged.
function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function transactionsToCsv(rows: readonly CsvTransactionRow[]): string {
  const lines = [HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.date,
        field(r.description),
        (r.amountCents / 100).toFixed(2), // signed dollars; negative = outflow
        field(r.accountName),
        field(r.categoryName ?? "Uncategorized"),
      ].join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
