// Shared by the desktop Sidebar and the mobile top-bar nav.
export const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/transactions", label: "Transactions" },
  { href: "/accounts", label: "Accounts" },
  { href: "/categories", label: "Categories" },
  { href: "/import", label: "Import" },
] as const;

// Whether a nav link is the active section for the current path. Dashboard ("/")
// matches only exactly; every other link also matches its sub-routes so e.g.
// /transactions/123/edit keeps "Transactions" highlighted.
export function isActiveNav(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function navAriaCurrent(
  pathname: string,
  href: string,
): "page" | undefined {
  return isActiveNav(pathname, href) ? "page" : undefined;
}
