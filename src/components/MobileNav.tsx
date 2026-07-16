"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NAV_LINKS, navAriaCurrent } from "./nav-links";

const MOBILE_MENU_ID = "mobile-navigation-menu";

// Small-screen top bar; the desktop Sidebar is hidden below md and this is
// hidden at md and up.
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      toggleRef.current?.focus();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <header className="md:hidden sticky top-0 z-10 border-b border-hairline bg-surface">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <p className="text-sm font-semibold tracking-tight">Finance Engine</p>
          <p className="text-xs text-ink-muted">Local &amp; private</p>
        </div>
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={open}
          aria-controls={MOBILE_MENU_ID}
          aria-label={open ? "Close navigation" : "Open navigation"}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-hairline px-3 py-1.5 text-sm text-ink-2 hover:bg-gridline/40"
        >
          {open ? "✕" : "☰"}
        </button>
      </div>
      <nav
        id={MOBILE_MENU_ID}
        hidden={!open}
        className={
          open
            ? "flex flex-col gap-1 border-t border-hairline px-4 py-2"
            : "hidden"
        }
      >
        {NAV_LINKS.map(({ href, label }) => {
          const ariaCurrent = navAriaCurrent(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={ariaCurrent}
              onClick={() => setOpen(false)}
              className={`flex min-h-11 items-center rounded-md px-3 py-2 text-sm ${
                ariaCurrent
                  ? "bg-gridline/60 font-medium text-ink"
                  : "text-ink-2 hover:bg-gridline/40"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
