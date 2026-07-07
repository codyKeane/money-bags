import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Not found" };

// Global 404, used by notFound() (e.g. editing a transaction that was deleted)
// and any unmatched URL. Kept in the app's own chrome rather than the bare
// Next default.
export default function NotFound() {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-hairline bg-surface px-6 py-8">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="text-sm text-ink-2">
        That page or record doesn’t exist — it may have been deleted.
      </p>
      <Link
        href="/"
        className="rounded-md border border-hairline px-3 py-1.5 text-sm hover:bg-gridline/40"
      >
        ← Back to dashboard
      </Link>
    </div>
  );
}
