// Plain helpers shared by the domain action files. NOT a "use server" module
// (those may export only async functions), so it holds the sync helpers and
// the form-state types.
import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";

// Revalidate every RSC page after a mutation. All pages are force-dynamic, so
// blanket revalidation is cheap and prevents cross-page staleness — e.g. an
// account rename must refresh the import page's account dropdown (Q8).
const PAGES = ["/", "/transactions", "/accounts", "/categories", "/import"];

export function revalidateAll() {
  for (const page of PAGES) revalidatePath(page);
}

export function firstError(error: ZodError): string {
  return error.issues[0]?.message ?? "Invalid input";
}

// Read a required non-empty string field from FormData, or null if absent.
export function requiredId(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" && value ? value : null;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface CreateAccountState extends ActionResult {
  accountId?: string;
}

export type CategoryFormState = ActionResult;

export type TransactionFormState = ActionResult;
