// Plain helpers shared by the domain action files. NOT a "use server" module
// (those may export only async functions), so it holds sync form helpers and
// form-state types.
import type { ZodError } from "zod";

export function firstError(error: ZodError): string {
  return error.issues[0]?.message ?? "Invalid input";
}

export function firstFormError(
  error: ZodError,
  aliases: Readonly<Record<string, string>> = {},
): Pick<ActionResult, "error" | "field"> {
  const issue = error.issues[0];
  const sourceField = issue?.path[0];
  return {
    error: issue?.message ?? "Invalid input",
    ...(typeof sourceField === "string"
      ? { field: aliases[sourceField] ?? sourceField }
      : {}),
  };
}

export function serviceFormError(
  result: { readonly field: string; readonly message: string },
  aliases: Readonly<Record<string, string>> = {},
): Pick<ActionResult, "error" | "field"> {
  return {
    error: result.message,
    field: aliases[result.field] ?? result.field,
  };
}

// Read a required non-empty string field from FormData, or null if absent.
export function requiredId(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" && value ? value : null;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  field?: string;
}

export interface CreateAccountState extends ActionResult {
  accountId?: string;
}

export type CategoryFormState = ActionResult;

export type TransactionFormState = ActionResult;
