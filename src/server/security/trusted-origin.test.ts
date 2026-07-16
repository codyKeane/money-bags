import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILT_ALLOWED_ORIGINS_ENV_NAME,
  TRUST_LOOPBACK_PROXY_ENV_NAME,
} from "@/lib/origin-policy";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));

async function loadRuntime(configuredOrigins: readonly string[] = []) {
  vi.resetModules();
  vi.stubEnv(BUILT_ALLOWED_ORIGINS_ENV_NAME, JSON.stringify(configuredOrigins));
  return import("./trusted-origin");
}

function actionHeaders(values: Record<string, string>): Headers {
  return new Headers(values);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("server-only trusted-origin runtime", () => {
  it("accepts direct same-origin action headers", async () => {
    vi.stubEnv(TRUST_LOOPBACK_PROXY_ENV_NAME, "0");
    mocks.headers.mockResolvedValue(
      actionHeaders({
        origin: "http://127.0.0.1:3100",
        host: "127.0.0.1:3100",
        "x-forwarded-host": "127.0.0.1:3100",
        "x-forwarded-proto": "http",
      }),
    );
    const runtime = await loadRuntime();

    await expect(runtime.assertTrustedActionOrigin()).resolves.toBeNull();
  });

  it("returns one stable generic typed failure for a missing origin", async () => {
    mocks.headers.mockResolvedValue(
      actionHeaders({
        host: "127.0.0.1:3100",
        "x-forwarded-host": "127.0.0.1:3100",
        "x-forwarded-proto": "http",
      }),
    );
    const runtime = await loadRuntime();

    await expect(runtime.assertTrustedActionOrigin()).resolves.toEqual({
      ok: false,
      error: "Request origin is not trusted.",
    });
  });

  it("accepts an exact built HTTPS proxy origin only in loopback mode", async () => {
    vi.stubEnv(TRUST_LOOPBACK_PROXY_ENV_NAME, "1");
    mocks.headers.mockResolvedValue(
      actionHeaders({
        origin: "https://host.tailnet.ts.net",
        host: "127.0.0.1:3100",
        "x-forwarded-host": "host.tailnet.ts.net",
        "x-forwarded-proto": "https",
      }),
    );
    const runtime = await loadRuntime(["https://host.tailnet.ts.net"]);

    await expect(runtime.assertTrustedActionOrigin()).resolves.toBeNull();
    vi.stubEnv(TRUST_LOOPBACK_PROXY_ENV_NAME, "0");
    await expect(runtime.assertTrustedActionOrigin()).resolves.toEqual(
      runtime.UNTRUSTED_ORIGIN_FAILURE,
    );
  });

  it("keeps the built allowlist frozen when the runtime environment changes", async () => {
    vi.stubEnv(TRUST_LOOPBACK_PROXY_ENV_NAME, "1");
    const runtime = await loadRuntime(["https://built.proxy.example"]);
    vi.stubEnv(
      BUILT_ALLOWED_ORIGINS_ENV_NAME,
      JSON.stringify(["https://changed.proxy.example"]),
    );

    mocks.headers.mockResolvedValue(
      actionHeaders({
        origin: "https://built.proxy.example",
        host: "127.0.0.1:3100",
        "x-forwarded-host": "built.proxy.example",
        "x-forwarded-proto": "https",
      }),
    );
    await expect(runtime.assertTrustedActionOrigin()).resolves.toBeNull();

    mocks.headers.mockResolvedValue(
      actionHeaders({
        origin: "https://changed.proxy.example",
        host: "127.0.0.1:3100",
        "x-forwarded-host": "changed.proxy.example",
        "x-forwarded-proto": "https",
      }),
    );
    await expect(runtime.assertTrustedActionOrigin()).resolves.toEqual(
      runtime.UNTRUSTED_ORIGIN_FAILURE,
    );
  });

  it("uses the same frozen policy for route requests", async () => {
    const runtime = await loadRuntime(["https://host.tailnet.ts.net"]);
    vi.stubEnv(
      BUILT_ALLOWED_ORIGINS_ENV_NAME,
      JSON.stringify(["https://changed.tailnet.ts.net"]),
    );
    const configured = new Request("http://127.0.0.1:3100/api/import", {
      headers: { origin: "https://host.tailnet.ts.net" },
    });
    const unlisted = new Request("http://127.0.0.1:3100/api/import", {
      headers: { origin: "https://changed.tailnet.ts.net" },
    });

    expect(runtime.hasTrustedRouteOrigin(configured)).toBe(true);
    expect(runtime.hasTrustedRouteOrigin(unlisted)).toBe(false);
  });
});
