"use client";

import { useSyncExternalStore } from "react";

// Recharts needs concrete hex values (SVG presentation attributes can't
// resolve CSS custom properties), so charts read the mode and pick the
// validated light/dark steps from src/lib/palette.ts.
function subscribe(callback: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

export function useDarkMode(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false, // SSR renders light; corrected on hydration
  );
}
