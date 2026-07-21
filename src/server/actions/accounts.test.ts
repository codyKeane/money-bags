import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  getAccountById: vi.fn(),
  revalidatePath: vi.fn(),
  assertTrustedActionOrigin: vi.fn(),
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

import {
  createAccountAction,
  deleteAccountAction,
  updateAccountAction,
} from "./accounts";

function accountForm(currency?: string): FormData {
  const formData = new FormData();
  formData.set("name", "Travel");
  formData.set("type", "CHECKING");
  formData.set("institution", "Local Bank");
  formData.set("openingBalance", "12.34");
  if (currency !== undefined) formData.set("currency", currency);
  return formData;
}

describe("account actions currency round-trip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertTrustedActionOrigin.mockResolvedValue(null);
  });

  it("normalizes and forwards required currency on create", async () => {
    mocks.createAccount.mockResolvedValue({
      status: "created",
      account: { id: "created-account" },
    });

    await expect(createAccountAction({ ok: true }, accountForm(" eur "))).resolves.toEqual({
      ok: true,
      accountId: "created-account",
    });
    expect(mocks.createAccount).toHaveBeenCalledWith({
      name: "Travel",
      type: "CHECKING",
      institution: "Local Bank",
      currency: "EUR",
      openingBalanceCents: 1234,
      openingBalanceDate: null,
    });
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });

  it("requires currency before calling the create service", async () => {
    await expect(createAccountAction({ ok: true }, accountForm())).resolves.toEqual({
      ok: false,
      error: "Invalid input: expected string, received null",
      field: "currency",
    });
    expect(mocks.createAccount).not.toHaveBeenCalled();
  });

  it("forwards a normalized repair currency on update", async () => {
    mocks.updateAccount.mockResolvedValue({ status: "updated", id: "repair-account" });
    const formData = accountForm("jpy");
    formData.set("accountId", "repair-account");

    await expect(updateAccountAction({ ok: true }, formData)).resolves.toEqual({
      ok: true,
      accountId: "repair-account",
    });
    expect(mocks.updateAccount).toHaveBeenCalledWith(
      "repair-account",
      expect.objectContaining({ currency: "JPY" }),
    );
  });

  it("identifies the typed confirmation field when an account name does not match", async () => {
    mocks.getAccountById.mockResolvedValue({
      id: "account-to-delete",
      name: "Household",
    });

    await expect(
      deleteAccountAction("account-to-delete", "House"),
    ).resolves.toEqual({
      ok: false,
      error: "Typed name does not match the account name",
      field: "confirmName",
    });
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
  });
});
