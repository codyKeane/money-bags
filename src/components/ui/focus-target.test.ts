import { describe, expect, it, vi } from "vitest";
import { focusElementById } from "./focus-target";

describe("surviving focus destinations", () => {
  it("focuses only a present caller-supplied destination", () => {
    const focus = vi.fn();
    expect(
      focusElementById("survivor", {
        getElementById: (id) => (id === "survivor" ? { focus } : null),
      }),
    ).toBe(true);
    expect(focus).toHaveBeenCalledOnce();
    expect(
      focusElementById("missing", { getElementById: () => null }),
    ).toBe(false);
  });
});
