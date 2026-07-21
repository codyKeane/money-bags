import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertTrustedActionOrigin: vi.fn(),
  revalidatePath: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  getAccountById: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  mergeCategory: vi.fn(),
  applyRulesToUncategorized: vi.fn(),
  undoImport: vi.fn(),
  overrideDuplicateImport: vi.fn(),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  setTransactionCategory: vi.fn(),
  replaceSplits: vi.fn(),
  setTransactionCleared: vi.fn(),
  setTransactionSpendingExclusion: vi.fn(),
  pairTransferTransactions: vi.fn(),
  unpairTransferTransaction: vi.fn(),
  linkRefund: vi.fn(),
  unlinkRefund: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/security/trusted-origin", () => ({
  assertTrustedActionOrigin: mocks.assertTrustedActionOrigin,
}));
vi.mock("@/server/services/accounts", () => ({
  createAccount: mocks.createAccount,
  updateAccount: mocks.updateAccount,
  deleteAccount: mocks.deleteAccount,
  getAccountById: mocks.getAccountById,
}));
vi.mock("@/server/services/categories", () => ({
  createCategory: mocks.createCategory,
  updateCategory: mocks.updateCategory,
  deleteCategory: mocks.deleteCategory,
  mergeCategory: mocks.mergeCategory,
  applyRulesToUncategorized: mocks.applyRulesToUncategorized,
}));
vi.mock("@/server/services/import", () => ({
  undoImport: mocks.undoImport,
  overrideDuplicateImport: mocks.overrideDuplicateImport,
}));
vi.mock("@/server/services/transactions", () => ({
  createTransaction: mocks.createTransaction,
  updateTransaction: mocks.updateTransaction,
  deleteTransaction: mocks.deleteTransaction,
  setTransactionCategory: mocks.setTransactionCategory,
  replaceSplits: mocks.replaceSplits,
  setTransactionCleared: mocks.setTransactionCleared,
  setTransactionSpendingExclusion: mocks.setTransactionSpendingExclusion,
}));
vi.mock("@/server/services/transaction-links", () => ({
  pairTransferTransactions: mocks.pairTransferTransactions,
  unpairTransferTransaction: mocks.unpairTransferTransaction,
  linkRefund: mocks.linkRefund,
  unlinkRefund: mocks.unlinkRefund,
}));

import * as actions from "./index";

const ORIGIN_FAILURE = Object.freeze({
  ok: false as const,
  error: "Request origin is not trusted.",
});
const poison = new Proxy(
  {},
  {
    get() {
      throw new Error("decoded action arguments must not be inspected");
    },
  },
);

const invocations: Record<keyof typeof actions, () => Promise<unknown>> = {
  applyRulesAction: () => actions.applyRulesAction(),
  clearSplitsAction: () => actions.clearSplitsAction(poison as string),
  createAccountAction: () =>
    actions.createAccountAction(poison as never, poison as FormData),
  createCategoryAction: () =>
    actions.createCategoryAction(poison as never, poison as FormData),
  createTransactionAction: () =>
    actions.createTransactionAction(poison as never, poison as FormData),
  deleteAccountAction: () =>
    actions.deleteAccountAction(poison as string, poison as string),
  deleteCategoryAction: () => actions.deleteCategoryAction(poison as string),
  mergeCategoryAction: () =>
    actions.mergeCategoryAction(poison as string, poison as string),
  deleteTransactionAction: () =>
    actions.deleteTransactionAction(poison as string),
  recategorizeAction: () =>
    actions.recategorizeAction(poison as string, poison as string),
  splitTransactionAction: () =>
    actions.splitTransactionAction(poison as string, poison as never),
  undoImportAction: () => actions.undoImportAction(poison as string),
  overrideDuplicateImportAction: () =>
    actions.overrideDuplicateImportAction(poison as never),
  updateAccountAction: () =>
    actions.updateAccountAction(poison as never, poison as FormData),
  updateCategoryAction: () =>
    actions.updateCategoryAction(poison as never, poison as FormData),
  updateTransactionAction: () =>
    actions.updateTransactionAction(poison as never, poison as FormData),
  setTransactionClearedAction: () =>
    actions.setTransactionClearedAction(poison as string, poison as boolean),
  setTransactionSpendingExclusionAction: () =>
    actions.setTransactionSpendingExclusionAction(poison as string, poison as boolean),
  pairTransferAction: () =>
    actions.pairTransferAction(poison as string, poison as string),
  unpairTransferAction: () => actions.unpairTransferAction(poison as string),
  linkRefundAction: () =>
    actions.linkRefundAction(poison as string, poison as string),
  unlinkRefundAction: () => actions.unlinkRefundAction(poison as string),
};

const serviceMocks = [
  mocks.createAccount,
  mocks.updateAccount,
  mocks.deleteAccount,
  mocks.getAccountById,
  mocks.createCategory,
  mocks.updateCategory,
  mocks.deleteCategory,
  mocks.mergeCategory,
  mocks.applyRulesToUncategorized,
  mocks.undoImport,
  mocks.overrideDuplicateImport,
  mocks.createTransaction,
  mocks.updateTransaction,
  mocks.deleteTransaction,
  mocks.setTransactionCategory,
  mocks.replaceSplits,
  mocks.setTransactionCleared,
  mocks.setTransactionSpendingExclusion,
  mocks.pairTransferTransactions,
  mocks.unpairTransferTransaction,
  mocks.linkRefund,
  mocks.unlinkRefund,
];

describe("first-operation Server Action origin guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertTrustedActionOrigin.mockResolvedValue(ORIGIN_FAILURE);
  });

  it("keeps the guard inventory synchronized with every exported action", () => {
    expect(new Set(Object.keys(invocations))).toEqual(new Set(Object.keys(actions)));
  });

  it.each(Object.keys(invocations) as (keyof typeof invocations)[])(
    "guards %s before argument inspection, services, or revalidation",
    async (name) => {
      await expect(invocations[name]()).resolves.toEqual(ORIGIN_FAILURE);
      expect(mocks.assertTrustedActionOrigin).toHaveBeenCalledTimes(1);
      for (const serviceMock of serviceMocks) expect(serviceMock).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );
});
