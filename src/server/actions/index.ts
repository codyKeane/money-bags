// Barrel so components keep importing from "@/server/actions" (Q4). The domain
// files hold the "use server" actions; the shared types come from ./shared.
export * from "./accounts";
export * from "./categories";
export * from "./transactions";
export * from "./imports";
export type {
  ActionResult,
  CreateAccountState,
  CategoryFormState,
  TransactionFormState,
} from "./shared";
