import { revalidatePath } from "next/cache";

// The installed Next contract defines the root layout form as the complete
// page/client-cache invalidation boundary for a committed ledger mutation.
export function revalidateAfterMutation(): void {
  revalidatePath("/", "layout");
}
