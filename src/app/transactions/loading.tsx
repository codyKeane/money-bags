import { Skeleton } from "@/components/ui/skeleton";

// Table-shaped skeleton for the transactions list — the heaviest, most-visited
// page — so its filter bar and rows have a recognizable placeholder while the
// server query runs.
export default function TransactionsLoading() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading transactions">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-10 w-full max-w-md" />
      <div className="rounded-lg border border-hairline bg-surface">
        {["a", "b", "c", "d", "e", "f", "g", "h"].map((k) => (
          <div
            key={k}
            className="flex items-center gap-4 border-b border-hairline px-3 py-2.5 last:border-b-0"
          >
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
