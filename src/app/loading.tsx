import { Skeleton } from "@/components/ui/skeleton";

// Rendered instantly by the App Router when any force-dynamic route (that lacks
// its own loading.tsx) begins rendering — so moving between pages shows page
// structure immediately instead of freezing on the previous screen.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading">
      <Skeleton className="h-6 w-44" />
      <Skeleton className="h-4 w-72 max-w-full" />
      <div className="mt-2 flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
        {["a", "b", "c", "d", "e"].map((k) => (
          <Skeleton key={k} className="h-5 w-full" />
        ))}
      </div>
    </div>
  );
}
