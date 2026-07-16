import { describe, expect, it } from "vitest";
import {
  fieldErrorAttributes,
  shouldFocusSubmittedFailure,
} from "./form-accessibility";

describe("form accessibility helpers", () => {
  it("links only the known failing field and preserves existing help", () => {
    expect(fieldErrorAttributes("form-error", "currency", "currency", "currency-help"))
      .toEqual({
        "aria-invalid": true,
        "aria-describedby": "currency-help form-error",
      });
    expect(fieldErrorAttributes("form-error", "currency", "name")).toEqual({});
  });

  it("focuses only on the pending-to-failure transition", () => {
    expect(shouldFocusSubmittedFailure(true, false, true)).toBe(true);
    expect(shouldFocusSubmittedFailure(false, false, true)).toBe(false);
    expect(shouldFocusSubmittedFailure(true, true, true)).toBe(false);
    expect(shouldFocusSubmittedFailure(true, false, false)).toBe(false);
  });
});
