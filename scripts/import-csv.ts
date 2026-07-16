// CLI statement importer.
// Usage: npm run import -- --file <csv> --account "<name>" [--type CHECKING]
//        [--currency USD] [--date-format MDY] [--col-date "<header>"] [--col-description ...]
//        [--col-amount ...] [--col-debit ...] [--col-credit ...]
import { readFileSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { ACCOUNT_TYPES } from "../src/lib/account-types";
import { formatCents } from "../src/lib/money";
import { normalizeCurrencyCode } from "../src/lib/currency";
import { importStatement } from "../src/server/services/import";

const MAX_BYTES = 5 * 1024 * 1024;

const ArgsSchema = z.object({
  file: z.string().min(1, "--file is required"),
  account: z.string().min(1, "--account is required"),
  type: z.enum(ACCOUNT_TYPES).default("CHECKING"),
  currency: z.string().default("USD"),
  "date-format": z.enum(["auto", "MDY", "DMY"]).default("auto"),
  "col-date": z.string().optional(),
  "col-description": z.string().optional(),
  "col-amount": z.string().optional(),
  "col-debit": z.string().optional(),
  "col-credit": z.string().optional(),
});

// Assemble a columnMap from the --col-* flags, or undefined if none were given.
function buildColumnMap(args: z.infer<typeof ArgsSchema>) {
  const map: Partial<Record<"date" | "description" | "amount" | "debit" | "credit", string>> = {};
  if (args["col-date"] !== undefined) map.date = args["col-date"];
  if (args["col-description"] !== undefined) map.description = args["col-description"];
  if (args["col-amount"] !== undefined) map.amount = args["col-amount"];
  if (args["col-debit"] !== undefined) map.debit = args["col-debit"];
  if (args["col-credit"] !== undefined) map.credit = args["col-credit"];
  return Object.keys(map).length > 0 ? map : undefined;
}

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      account: { type: "string" },
      type: { type: "string" },
      currency: { type: "string" },
      "date-format": { type: "string" },
      "col-date": { type: "string" },
      "col-description": { type: "string" },
      "col-amount": { type: "string" },
      "col-debit": { type: "string" },
      "col-credit": { type: "string" },
    },
  });
  const parsed = ArgsSchema.safeParse(values);
  if (!parsed.success) {
    console.error(
      'Usage: npm run import -- --file <csv> --account "<name>" [--type CHECKING] [--currency USD] [--date-format auto|MDY|DMY] [--col-date "<header>"] [--col-amount "<header>"] …',
    );
    for (const issue of parsed.error.issues) console.error(`  ${issue.message}`);
    process.exit(2);
  }
  const args = parsed.data;

  if (statSync(args.file).size > MAX_BYTES) {
    console.error(`File exceeds the ${MAX_BYTES / 1024 / 1024} MB import cap.`);
    process.exit(2);
  }
  const csvText = readFileSync(args.file, "utf8");

  const result = await importStatement({
    account: {
      kind: "by-name",
      name: args.account,
      type: args.type,
      currency: args.currency,
    },
    csvText,
    dateFormat: args["date-format"],
    columnMap: buildColumnMap(args),
    filename: args.file,
  });
  if (result.status === "date-format-required") {
    console.error(
      "Import refused: ambiguous dates require --date-format MDY or --date-format DMY.",
    );
    process.exit(2);
  }
  if (result.status === "invalid-column-map") {
    console.error("Import refused: invalid column mapping.");
    for (const issue of result.issues) console.error(`  ${issue.field}: ${issue.message}`);
    process.exit(2);
  }
  if (result.status === "invalid-file") {
    console.error("Import refused: the CSV contains invalid rows or structure.");
    for (const error of result.errors) {
      console.error(`  line ${error.rowNumber}: ${error.message}`);
    }
    process.exit(2);
  }
  if (result.status !== "completed") {
    console.error(result.message);
    process.exit(2);
  }

  const outputCurrency = normalizeCurrencyCode(result.account?.currency);
  if (!outputCurrency) {
    throw new Error("Imported account currency is invalid; repair the account before rendering amounts.");
  }

  if (result.account?.created) {
    console.log(
      `Created account "${result.account.name}" (${result.account.type}, ${result.account.currency}).`,
    );
  }
  console.log(`\nImported: ${result.imported}`);
  if (result.batchId) {
    console.log(
      `Recorded import batch ${result.batchId} — undo it from the Import page if needed.`,
    );
  }
  console.log(`Skipped as duplicates: ${result.skipped.length}`);
  for (const row of result.skipped) {
    console.log(
      `  line ${row.rowNumber}: ${row.date}  ${formatCents(row.amountCents, outputCurrency)}  ${row.description}`,
    );
  }
  if (result.skipped.length > 0) {
    console.log(
      "  (If any skipped row is a real transaction that also appears in another file,",
    );
    console.log("   add it manually — identical rows split across files dedupe as one.)");
  }
}

main().catch(() => {
  console.error("Import failed unexpectedly.");
  process.exit(1);
});
