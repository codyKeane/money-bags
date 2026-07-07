// Pulsing placeholder block shown by loading.tsx while a force-dynamic page
// streams in, so navigation never lands on a frozen frame. Neutral gridline
// fill reads correctly in both light and dark themes; aria-hidden because the
// loading container carries the announced status.
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded bg-gridline/60 ${className}`} />;
}
