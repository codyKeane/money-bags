import { describe, expect, it, vi } from "vitest";
import { checkDatabaseHealth } from "./health";

describe("checkDatabaseHealth", () => {
  it("executes one minimal query through an injected database", () => {
    const get = vi.fn().mockReturnValue({ value: 1 });

    checkDatabaseHealth({ get });

    expect(get).toHaveBeenCalledTimes(1);
  });

  it("propagates database failures without adding details", () => {
    const failure = new Error("synthetic database failure");
    const get = vi.fn(() => {
      throw failure;
    });

    expect(() => checkDatabaseHealth({ get })).toThrow(failure);
  });
});
