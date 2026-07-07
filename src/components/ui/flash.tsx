"use client";

import { useCallback, useRef, useState } from "react";

// Transient success feedback (UX8): a short confirmation that a create
// succeeded, auto-clearing after a few seconds. Rendered in an aria-live
// region so screen readers announce it. Green + a ✓ glyph + text — the color
// never carries the meaning alone (CVD-safe palette rule).
export function useFlash(timeoutMs = 3000) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback(
    (msg: string) => {
      setMessage(msg);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setMessage(null), timeoutMs);
    },
    [timeoutMs],
  );

  return [message, flash] as const;
}

export function FlashMessage({ message }: { message: string | null }) {
  return (
    <span role="status" aria-live="polite" className="text-xs text-delta-good">
      {message ? `✓ ${message}` : ""}
    </span>
  );
}
