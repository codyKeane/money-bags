import { describe, expect, it } from "vitest";
import { isActiveNav, navAriaCurrent } from "./nav-links";

describe("isActiveNav", () => {
  it("matches Dashboard ('/') only exactly", () => {
    expect(isActiveNav("/", "/")).toBe(true);
    expect(isActiveNav("/transactions", "/")).toBe(false);
    expect(isActiveNav("/import", "/")).toBe(false);
  });

  it("matches a section on its own path and its sub-routes", () => {
    expect(isActiveNav("/transactions", "/transactions")).toBe(true);
    expect(isActiveNav("/transactions/abc/edit", "/transactions")).toBe(true);
  });

  it("does not match a different section that shares a prefix string", () => {
    // "/transactions" must not light up for "/transactions-archive"
    expect(isActiveNav("/transactions-archive", "/transactions")).toBe(false);
    expect(isActiveNav("/accounts", "/transactions")).toBe(false);
  });
});

describe("navAriaCurrent", () => {
  it("marks only the active section as the current page", () => {
    expect(navAriaCurrent("/transactions/abc/edit", "/transactions")).toBe(
      "page",
    );
    expect(navAriaCurrent("/transactions/abc/edit", "/accounts")).toBeUndefined();
  });
});
