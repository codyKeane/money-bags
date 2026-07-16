import { describe, expect, it } from "vitest";
import { NO_STORE_CACHE_CONTROL, noStoreJson } from "./http-response";

describe("noStoreJson", () => {
  it("preserves response metadata while making the JSON non-cacheable", async () => {
    const response = noStoreJson(
      { ok: false },
      {
        status: 409,
        headers: {
          "Cache-Control": "public, max-age=3600",
          "X-Synthetic": "retained",
        },
      },
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe(NO_STORE_CACHE_CONTROL);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("x-synthetic")).toBe("retained");
    await expect(response.json()).resolves.toEqual({ ok: false });
  });
});
