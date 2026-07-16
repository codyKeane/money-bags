import { describe, expect, it } from "vitest";
import { GLOBAL_SECURITY_HEADERS } from "./security-headers";

describe("global response security headers", () => {
  it("denies framing and suppresses type sniffing and referrers", () => {
    expect(GLOBAL_SECURITY_HEADERS).toEqual([
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ]);
    expect(GLOBAL_SECURITY_HEADERS).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "Access-Control-Allow-Origin" })]),
    );
  });
});
