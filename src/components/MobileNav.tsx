"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV_LINKS, isActiveNav } from "./nav-links";

// Small-screen top bar; the desktop Sidebar is hidden below md and this is
// hidden at md and up.
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="md:hidden sticky top-0 z-10 border-b border-hairline bg-surface">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <p className="text-sm font-semibold tracking-tight">Finance Engine</p>
          <p className="text-xs text-ink-muted">Local &amp; private</p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Close navigation" : "Open navigation"}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-hairline px-3 py-1.5 text-sm text-ink-2 hover:bg-gridline/40"
        >
          {open ? "✕" : "☰"}
        </button>
      </div>
      {open ? (
        <nav className="flex flex-col gap-1 border-t border-hairline px-4 py-2">
          {NAV_LINKS.map(({ href, label }) => {
            const active = isActiveNav(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`flex min-h-11 items-center rounded-md px-3 py-2 text-sm ${
                  active
                    ? "bg-gridline/60 font-medium text-ink"
                    : "text-ink-2 hover:bg-gridline/40"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </header>
  );
}
