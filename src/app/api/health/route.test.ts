import { beforeEach, describe, expect, it, vi } from "vitest";

const checkDatabaseHealth = vi.hoisted(() => vi.fn());
vi.mock("@/server/services/health", () => ({ checkDatabaseHealth }));

import { dynamic, GET } from "./route";

describe("GET /api/health", () => {
  beforeEach(() => {
    checkDatabaseHealth.mockReset();
  });

  it("is dynamic and makes a healthy response non-cacheable", async () => {
    const response = GET();

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(checkDatabaseHealth).toHaveBeenCalledTimes(1);
  });

  it("makes an unhealthy response non-cacheable", async () => {
    checkDatabaseHealth.mockImplementation(() => {
      throw new Error("synthetic database failure");
    });

    const response = GET();

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: false });
  });
});
