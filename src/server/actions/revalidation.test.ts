import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  assertTrustedActionOrigin: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  getAccountById: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  applyRulesToUncategorized: vi.fn(),
  undoImport: vi.fn(),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  setTransactionCategory: vi.fn(),
  replaceSplits: vi.fn(),
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
  applyRulesToUncategorized: mocks.applyRulesToUncategorized,
}));
vi.mock("@/server/services/import", () => ({ undoImport: mocks.undoImport }));
vi.mock("@/server/services/transactions", () => ({
  createTransaction: mocks.createTransaction,
  updateTransaction: mocks.updateTransaction,
  deleteTransaction: mocks.deleteTransaction,
  setTransactionCategory: mocks.setTransactionCategory,
  replaceSplits: mocks.replaceSplits,
}));

import * as actions from "./index";

function accountForm(accountId?: string): FormData {
  const formData = new FormData();
  if (accountId) formData.set("accountId", accountId);
  formData.set("name", "Synthetic Account");
  formData.set("type", "CHECKING");
  formData.set("institution", "Synthetic Institution");
  formData.set("currency", "USD");
  formData.set("openingBalance", "0.00");
  return formData;
}

function categoryForm(categoryId?: string): FormData {
  const formData = new FormData();
  if (categoryId) formData.set("categoryId", categoryId);
  formData.set("name", "Synthetic Category");
  formData.set("keywords", "synthetic");
  formData.set("color", "");
  formData.set("monthlyBudget", "");
  return formData;
}

function transactionForm(transactionId?: string): FormData {
  const formData = new FormData();
  if (transactionId) formData.set("transactionId", transactionId);
  formData.set("accountId", "synthetic-account");
  formData.set("categoryId", "");
  formData.set("date", "2026-07-15");
  formData.set("description", "SYNTHETIC TRANSACTION");
  formData.set("amount", "-1.00");
  return formData;
}

const splitParts = [
  { categoryId: null, amountCents: -60 },
  { categoryId: null, amountCents: -40 },
];

const successInvocations: Record<keyof typeof actions, () => Promise<unknown>> = {
  applyRulesAction: () => actions.applyRulesAction(),
  clearSplitsAction: () => actions.clearSplitsAction("synthetic-transaction"),
  createAccountAction: () => actions.createAccountAction({ ok: true }, accountForm()),
  createCategoryAction: () => actions.createCategoryAction({ ok: true }, categoryForm()),
  createTransactionAction: () =>
    actions.createTransactionAction({ ok: true }, transactionForm()),
  deleteAccountAction: () =>
    actions.deleteAccountAction("synthetic-account", "Synthetic Account"),
  deleteCategoryAction: () => actions.deleteCategoryAction("synthetic-category"),
  deleteTransactionAction: () =>
    actions.deleteTransactionAction("synthetic-transaction"),
  recategorizeAction: () =>
    actions.recategorizeAction("synthetic-transaction", null),
  splitTransactionAction: () =>
    actions.splitTransactionAction("synthetic-transaction", splitParts),
  undoImportAction: () => actions.undoImportAction("synthetic-import"),
  updateAccountAction: () =>
    actions.updateAccountAction({ ok: true }, accountForm("synthetic-account")),
  updateCategoryAction: () =>
    actions.updateCategoryAction({ ok: true }, categoryForm("synthetic-category")),
  updateTransactionAction: () =>
    actions.updateTransactionAction(
      { ok: true },
      transactionForm("synthetic-transaction"),
    ),
};

interface NonMutationCase {
  name: keyof typeof actions;
  expectedOk: boolean;
  invoke(): Promise<unknown>;
}

const nonMutationInvocations: NonMutationCase[] = [
  {
    name: "applyRulesAction",
    expectedOk: true,
    invoke: () => {
      mocks.applyRulesToUncategorized.mockResolvedValue({
        status: "updated",
        scanned: 2,
        updated: 0,
      });
      return actions.applyRulesAction();
    },
  },
  {
    name: "clearSplitsAction",
    expectedOk: true,
    invoke: () => {
      mocks.replaceSplits.mockResolvedValue({ status: "unchanged" });
      return actions.clearSplitsAction("synthetic-transaction");
    },
  },
  {
    name: "createAccountAction",
    expectedOk: false,
    invoke: () => {
      mocks.createAccount.mockResolvedValue({ status: "duplicate-name" });
      return actions.createAccountAction({ ok: true }, accountForm());
    },
  },
  {
    name: "createCategoryAction",
    expectedOk: false,
    invoke: () => {
      mocks.createCategory.mockResolvedValue({ status: "duplicate-name" });
      return actions.createCategoryAction({ ok: true }, categoryForm());
    },
  },
  {
    name: "createTransactionAction",
    expectedOk: false,
    invoke: () => {
      mocks.createTransaction.mockResolvedValue({ status: "unknown-account" });
      return actions.createTransactionAction({ ok: true }, transactionForm());
    },
  },
  {
    name: "deleteAccountAction",
    expectedOk: false,
    invoke: () => {
      mocks.deleteAccount.mockResolvedValue(null);
      return actions.deleteAccountAction("synthetic-account", "Synthetic Account");
    },
  },
  {
    name: "deleteCategoryAction",
    expectedOk: false,
    invoke: () => {
      mocks.deleteCategory.mockResolvedValue(null);
      return actions.deleteCategoryAction("synthetic-category");
    },
  },
  {
    name: "deleteTransactionAction",
    expectedOk: false,
    invoke: () => {
      mocks.deleteTransaction.mockResolvedValue(null);
      return actions.deleteTransactionAction("synthetic-transaction");
    },
  },
  {
    name: "recategorizeAction",
    expectedOk: false,
    invoke: () => {
      mocks.setTransactionCategory.mockResolvedValue({ status: "not-found" });
      return actions.recategorizeAction("synthetic-transaction", null);
    },
  },
  {
    name: "splitTransactionAction",
    expectedOk: false,
    invoke: () => {
      mocks.replaceSplits.mockResolvedValue({
        status: "split-total-mismatch",
        parentAmountCents: -100,
        splitTotalCents: -99,
      });
      return actions.splitTransactionAction("synthetic-transaction", splitParts);
    },
  },
  {
    name: "undoImportAction",
    expectedOk: false,
    invoke: () => {
      mocks.undoImport.mockResolvedValue(null);
      return actions.undoImportAction("synthetic-import");
    },
  },
  {
    name: "updateAccountAction",
    expectedOk: false,
    invoke: () => {
      mocks.updateAccount.mockResolvedValue({ status: "not-found" });
      return actions.updateAccountAction(
        { ok: true },
        accountForm("synthetic-account"),
      );
    },
  },
  {
    name: "updateCategoryAction",
    expectedOk: false,
    invoke: () => {
      mocks.updateCategory.mockResolvedValue({ status: "not-found" });
      return actions.updateCategoryAction(
        { ok: true },
        categoryForm("synthetic-category"),
      );
    },
  },
  {
    name: "updateTransactionAction",
    expectedOk: false,
    invoke: () => {
      mocks.updateTransaction.mockResolvedValue({ status: "not-found" });
      return actions.updateTransactionAction(
        { ok: true },
        transactionForm("synthetic-transaction"),
      );
    },
  },
];

describe("root-layout mutation revalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertTrustedActionOrigin.mockResolvedValue(null);
    mocks.createAccount.mockResolvedValue({
      status: "created",
      account: { id: "synthetic-account" },
    });
    mocks.updateAccount.mockResolvedValue({ status: "updated", id: "synthetic-account" });
    mocks.getAccountById.mockResolvedValue({
      id: "synthetic-account",
      name: "Synthetic Account",
    });
    mocks.deleteAccount.mockResolvedValue("synthetic-account");
    mocks.createCategory.mockResolvedValue({ status: "created" });
    mocks.updateCategory.mockResolvedValue({ status: "updated" });
    mocks.deleteCategory.mockResolvedValue("synthetic-category");
    mocks.applyRulesToUncategorized.mockResolvedValue({
      status: "updated",
      scanned: 2,
      updated: 1,
    });
    mocks.undoImport.mockResolvedValue({ deletedCount: 1, filename: "synthetic.csv" });
    mocks.createTransaction.mockResolvedValue({ status: "created" });
    mocks.updateTransaction.mockResolvedValue({ status: "updated" });
    mocks.deleteTransaction.mockResolvedValue("synthetic-transaction");
    mocks.setTransactionCategory.mockResolvedValue({
      status: "updated",
      id: "synthetic-transaction",
    });
    mocks.replaceSplits.mockResolvedValue({ status: "updated" });
  });

  it("keeps the success inventory synchronized with every exported action", () => {
    expect(new Set(Object.keys(successInvocations))).toEqual(
      new Set(Object.keys(actions)),
    );
  });

  it("does not add a redundant client refresh around split Server Actions", () => {
    const source = readFileSync(
      path.resolve(import.meta.dirname, "../../components/SplitEditor.tsx"),
      "utf8",
    );

    expect(source).not.toContain("useRouter");
    expect(source).not.toContain("router.refresh(");
  });

  it.each(Object.keys(successInvocations) as (keyof typeof successInvocations)[])(
    "revalidates the root layout exactly once after %s commits",
    async (name) => {
      await expect(successInvocations[name]()).resolves.toMatchObject({ ok: true });
      expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout");
    },
  );

  it.each(nonMutationInvocations)(
    "does not revalidate when $name fails or makes no change",
    async ({ expectedOk, invoke }) => {
      await expect(invoke()).resolves.toMatchObject({ ok: expectedOk });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );
});
