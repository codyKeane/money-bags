// CLI statement importer.
// Usage: npm run import -- --file <csv> --account "<name>" [--type CHECKING]
//        [--date-format MDY] [--col-date "<header>"] [--col-description ...]
//        [--col-amount ...] [--col-debit ...] [--col-credit ...]
try {
  process.loadEnvFile();
} catch {
  // no .env — defaults apply
}

import { readFileSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { ACCOUNT_TYPES } from "../src/lib/account-types";
import { formatCents } from "../src/lib/money";
import { getOrCreateAccountByName } from "../src/server/services/accounts";
import { importStatement } from "../src/server/services/import";

const MAX_BYTES = 5 * 1024 * 1024;

const ArgsSchema = z.object({
  file: z.string().min(1, "--file is required"),
  account: z.string().min(1, "--account is required"),
  type: z.enum(ACCOUNT_TYPES).default("CHECKING"),
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
  if (args["col-date"]) map.date = args["col-date"];
  if (args["col-description"]) map.description = args["col-description"];
  if (args["col-amount"]) map.amount = args["col-amount"];
  if (args["col-debit"]) map.debit = args["col-debit"];
  if (args["col-credit"]) map.credit = args["col-credit"];
  return Object.keys(map).length > 0 ? map : undefined;
}

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      account: { type: "string" },
      type: { type: "string" },
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
      'Usage: npm run import -- --file <csv> --account "<name>" [--type CHECKING] [--date-format auto|MDY|DMY] [--col-date "<header>"] [--col-amount "<header>"] …',
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

  const { account, created } = await getOrCreateAccountByName(args.account, args.type);
  if (created) console.log(`Created account "${account.name}" (${account.type}).`);

  const result = await importStatement({
    accountId: account.id,
    csvText,
    dateFormat: args["date-format"],
    columnMap: buildColumnMap(args),
  });

  for (const warning of result.warnings) console.log(`Warning: ${warning}`);
  console.log(`\nImported: ${result.imported}`);
  console.log(`Skipped as duplicates: ${result.skipped.length}`);
  for (const row of result.skipped) {
    console.log(
      `  line ${row.rowNumber}: ${row.date}  ${formatCents(row.amountCents)}  ${row.description}`,
    );
  }
  if (result.skipped.length > 0) {
    console.log(
      "  (If any skipped row is a real transaction that also appears in another file,",
    );
    console.log("   add it manually — identical rows split across files dedupe as one.)");
  }
  console.log(`Rows with errors: ${result.errors.length}`);
  for (const err of result.errors) {
    console.log(`  line ${err.rowNumber}: ${err.message}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
