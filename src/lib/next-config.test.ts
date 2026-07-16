import { afterEach, describe, expect, it, vi } from "vitest";
import { GLOBAL_SECURITY_HEADERS } from "./security-headers";

async function loadConfig(extraAllowedOrigins: string | undefined) {
  vi.resetModules();
  vi.stubEnv("EXTRA_ALLOWED_ORIGINS", extraAllowedOrigins ?? "");
  return (await import("../../next.config")).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Next origin and response configuration", () => {
  it("maps exact normalized URLs to host-only framework defense and a server build constant", async () => {
    const config = await loadConfig(
      "https://HOST.tailnet.ts.net:443, https://proxy.example:8443",
    );

    expect(config.experimental?.serverActions).toMatchObject({
      allowedOrigins: ["host.tailnet.ts.net", "proxy.example:8443"],
    });
    expect(config.compiler?.defineServer).toEqual({
      "process.env.MONEYBAGS_BUILT_ALLOWED_ORIGINS":
        '["https://host.tailnet.ts.net","https://proxy.example:8443"]',
    });
    expect(JSON.stringify(config)).not.toContain("*.ts.net");
  });

  it("fails config evaluation for invalid origins without echoing their value", async () => {
    const invalid = "http://not-allowed.invalid/private";
    await expect(loadConfig(invalid)).rejects.toThrow(
      /EXTRA_ALLOWED_ORIGINS entry 1 must be an exact HTTPS origin/,
    );
    try {
      await loadConfig(invalid);
    } catch (error) {
      expect(String(error)).not.toContain(invalid);
    }
  });

  it("sets the locked global anti-framing headers with no permissive CORS", async () => {
    const config = await loadConfig(undefined);
    const rules = await config.headers?.();

    expect(config.poweredByHeader).toBe(false);
    expect(rules).toEqual([
      {
        source: "/:path*",
        headers: GLOBAL_SECURITY_HEADERS,
      },
    ]);
    expect(JSON.stringify(rules)).not.toMatch(/Access-Control-Allow-Origin/i);
  });

  it("keeps operational-only scripts out of every server trace", async () => {
    const config = await loadConfig(undefined);

    for (const routeKey of ["/*", "next-server"] as const) {
      expect(config.outputFileTracingExcludes?.[routeKey]).toEqual(
        expect.arrayContaining([
          "scripts/render-systemd-units.mjs",
          "scripts/service-preflight.ts",
          "scripts/verify-backup.ts",
        ]),
      );
    }
  });
});
