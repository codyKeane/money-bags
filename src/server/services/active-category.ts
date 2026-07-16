import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { transactions, transactionSplits } from "@/db/schema";

// Active categorization is split-owned whenever any split exists. These
// predicates stay correlated to the current `transactions` row, so list/count
// queries retain one parent row even when several parts match.
export function transactionHasSplits(): SQL {
  return sql`exists (
    select 1 from ${transactionSplits}
    where ${transactionSplits.transactionId} = ${transactions.id}
  )`;
}

export function transactionHasNoSplits(): SQL {
  return sql`not ${transactionHasSplits()}`;
}

export function transactionMatchesActiveCategory(
  categoryId: string | null | SQLWrapper,
): SQL {
  const splitMatch =
    categoryId === null
      ? sql`${transactionSplits.categoryId} is null`
      : sql`${transactionSplits.categoryId} = ${categoryId}`;
  const parentMatch =
    categoryId === null
      ? sql`${transactions.categoryId} is null`
      : sql`${transactions.categoryId} = ${categoryId}`;

  return sql`(
    exists (
      select 1 from ${transactionSplits}
      where ${transactionSplits.transactionId} = ${transactions.id}
        and ${splitMatch}
    )
    or (${transactionHasNoSplits()} and ${parentMatch})
  )`;
}
