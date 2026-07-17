import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  replaceSplits: vi.fn(),
  setTransactionCategory: vi.fn(),
  updateTransaction: vi.fn(),
  revalidateAfterMutation: vi.fn(),
  assertTrustedActionOrigin: vi.fn(),
}));

vi.mock("@/server/revalidation", () => ({
  revalidateAfterMutation: mocks.revalidateAfterMutation,
}));
vi.mock("@/server/security/trusted-origin", () => ({
  assertTrustedActionOrigin: mocks.assertTrustedActionOrigin,
}));
vi.mock("@/server/services/transactions", () => ({
  createTransaction: mocks.createTransaction,
  deleteTransaction: mocks.deleteTransaction,
  replaceSplits: mocks.replaceSplits,
  setTransactionCategory: mocks.setTransactionCategory,
  updateTransaction: mocks.updateTransaction,
}));

import { createTransactionAction, updateTransactionAction } from "./transactions";

function transactionForm(options: {
  notes?: string;
  tags?: string;
  transactionId?: string;
} = {}): FormData {
  const formData = new FormData();
  formData.set("accountId", "account-1");
  formData.set("categoryId", "");
  formData.set("date", "2026-07-16");
  formData.set("description", "Team lunch");
  formData.set("amount", "-12.34");
  if (options.notes !== undefined) formData.set("notes", options.notes);
  if (options.tags !== undefined) formData.set("tags", options.tags);
  if (options.transactionId !== undefined) {
    formData.set("transactionId", options.transactionId);
  }
  return formData;
}

describe("transaction annotation actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertTrustedActionOrigin.mockResolvedValue(null);
  });

  it("defaults omitted annotations and forwards normalized create input", async () => {
    mocks.createTransaction.mockResolvedValue({
      status: "created",
      transaction: { id: "created-transaction" },
    });

    await expect(
      createTransactionAction({ ok: true }, transactionForm()),
    ).resolves.toEqual({ ok: true });
    expect(mocks.createTransaction).toHaveBeenCalledWith({
      accountId: "account-1",
      categoryId: null,
      date: "2026-07-16",
      description: "Team lunch",
      amountCents: -1234,
      notes: "",
      tags: [],
    });
    expect(mocks.revalidateAfterMutation).toHaveBeenCalledOnce();
  });

  it("normalizes notes and comma-separated tags before update", async () => {
    mocks.updateTransaction.mockResolvedValue({
      status: "updated",
      id: "transaction-1",
    });

    await expect(
      updateTransactionAction(
        { ok: true },
        transactionForm({
          transactionId: "transaction-1",
          notes: "  cafe\u0301\r\nmeeting  ",
          tags: " Travel, work   lunch, TRAVEL ",
        }),
      ),
    ).resolves.toEqual({ ok: true });
    expect(mocks.updateTransaction).toHaveBeenCalledWith(
      "transaction-1",
      expect.objectContaining({
        notes: "café\nmeeting",
        tags: ["travel", "work lunch"],
      }),
    );
  });

  it.each([
    {
      name: "unsafe notes",
      form: () => transactionForm({ notes: "misleading\u202etext" }),
      field: "notes",
    },
    {
      name: "too many tags",
      form: () =>
        transactionForm({
          tags: Array.from({ length: 21 }, (_, index) => `tag-${index}`).join(","),
        }),
      field: "tags",
    },
    {
      name: "overlong tag",
      form: () => transactionForm({ tags: "x".repeat(41) }),
      field: "tags",
    },
  ])("returns a field-specific error for $name", async ({ form, field }) => {
    await expect(createTransactionAction({ ok: true }, form())).resolves.toMatchObject({
      ok: false,
      field,
    });
    expect(mocks.createTransaction).not.toHaveBeenCalled();
  });
});
