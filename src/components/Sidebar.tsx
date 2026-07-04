"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_LINKS } from "./nav-links";

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex w-52 shrink-0 border-r border-hairline bg-surface min-h-screen px-4 py-6 flex-col gap-6">
      <div>
        <p className="text-sm font-semibold tracking-tight">Finance Engine</p>
        <p className="text-xs text-ink-muted mt-0.5">Local &amp; private</p>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV_LINKS.map(({ href, label }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`rounded-md px-3 py-1.5 text-sm ${
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
    </aside>
  );
}
