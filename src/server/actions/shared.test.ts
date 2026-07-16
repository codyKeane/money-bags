import { z } from "zod";
import { describe, expect, it } from "vitest";
import { firstFormError, serviceFormError } from "./shared";

describe("form action error metadata", () => {
  it("keeps the first Zod field path and supports UI field aliases", () => {
    const parsed = z
      .object({ amountCents: z.number().int() })
      .safeParse({ amountCents: "12.00" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    expect(firstFormError(parsed.error, { amountCents: "amount" })).toEqual({
      error: "Invalid input: expected number, received string",
      field: "amount",
    });
  });

  it("maps service validation fields without losing the safe message", () => {
    expect(
      serviceFormError(
        { field: "openingBalanceCents", message: "Opening balance must be exact cents" },
        { openingBalanceCents: "openingBalance" },
      ),
    ).toEqual({
      error: "Opening balance must be exact cents",
      field: "openingBalance",
    });
  });
});
