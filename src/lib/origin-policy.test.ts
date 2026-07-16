import { describe, expect, it } from "vitest";
import {
  createBuiltOriginConfiguration,
  isTrustedActionOrigin,
  isTrustedRouteOrigin,
  normalizeRequestOrigin,
  parseBuiltAllowedOrigins,
  parseExtraAllowedOrigins,
} from "./origin-policy";

const ASCII_CONTROLS = [
  { label: "HTAB", value: "\t" },
  { label: "LF", value: "\n" },
  { label: "CR", value: "\r" },
  { label: "NUL", value: "\0" },
  { label: "DEL", value: "\x7f" },
] as const;

describe("configured trusted origins", () => {
  it("normalizes host case and default ports, removes duplicates, and retains custom ports", () => {
    const configuration = createBuiltOriginConfiguration(
      " https://MONEY.Example:443/, https://money.example, https://proxy.example:8443 ",
    );

    expect(configuration.configuredOrigins).toEqual([
      "https://money.example",
      "https://proxy.example:8443",
    ]);
    expect(configuration.allowedHosts).toEqual([
      "money.example",
      "proxy.example:8443",
    ]);
    expect(parseBuiltAllowedOrigins(configuration.serializedOrigins)).toEqual(
      configuration.configuredOrigins,
    );
  });

  it.each([undefined, "", "   "])("accepts an absent list %j as empty", (raw) => {
    expect(parseExtraAllowedOrigins(raw)).toEqual([]);
  });

  it.each([
    "http://money.example",
    "https://user@money.example",
    "https://money.example/private",
    "https://money.example/./",
    "https://money.example/%2e",
    "https://money.example/%2E",
    "https://money.example/a/../",
    "https://money.example/%2e%2e",
    "https://money.example//",
    "https://money.example\\",
    "https://money.example?",
    "https://money.example?mode=1",
    "https://money.example#",
    "https://money.example#fragment",
    "https://*.ts.net",
    "https://one.example,two.example",
    "https://host_name.example",
    "https://money.\texample",
    "https://%6doney.example",
    "https://money.example.",
    "money.example",
    "https://money.example,",
    "https://money.example,,https://proxy.example",
  ])("rejects non-exact configuration %j without echoing it", (raw) => {
    expect(() => parseExtraAllowedOrigins(raw)).toThrow(
      /EXTRA_ALLOWED_ORIGINS entry \d+ must be an exact HTTPS origin/,
    );
    try {
      parseExtraAllowedOrigins(raw);
    } catch (error) {
      expect(String(error)).not.toContain(raw);
    }
  });

  it("rejects malformed or non-canonical built configuration", () => {
    expect(() => parseBuiltAllowedOrigins("not-json")).toThrow(/configuration is invalid/);
    expect(() => parseBuiltAllowedOrigins(JSON.stringify({}))).toThrow(
      /configuration is invalid/,
    );
    expect(() =>
      parseBuiltAllowedOrigins(JSON.stringify(["https://MONEY.example:443"])),
    ).toThrow(/not canonical/);
  });

  it.each(ASCII_CONTROLS)(
    "rejects an internal $label control before URL normalization",
    ({ value }) => {
      expect(() =>
        parseExtraAllowedOrigins(`https://money.exa${value}mple`),
      ).toThrow(/EXTRA_ALLOWED_ORIGINS entry 1/);
    },
  );
});

describe("request origin normalization", () => {
  it("normalizes complete HTTP and HTTPS origins", () => {
    expect(normalizeRequestOrigin("http://LOCALHOST:80/")).toBe("http://localhost");
    expect(normalizeRequestOrigin("https://MONEY.example:8443")).toBe(
      "https://money.example:8443",
    );
  });

  it.each([
    null,
    "null",
    "",
    " https://money.example",
    "https://money.example/path",
    "https://money.example?",
    "https://money.example#",
    "https://user@money.example",
    "https://@money.example",
    "https://*.ts.net",
    "https://money.example.",
    "https://one.example, https://two.example",
    "file:///tmp/example",
    "not an origin",
  ])("rejects malformed request origin %j", (value) => {
    expect(normalizeRequestOrigin(value)).toBeNull();
  });

  it.each(ASCII_CONTROLS)(
    "rejects an internal $label request control",
    ({ value }) => {
      expect(normalizeRequestOrigin(`https://money.exa${value}mple`)).toBeNull();
    },
  );
});

describe("import route origin policy", () => {
  const configured = [
    "https://host.tailnet.ts.net",
    "https://proxy.example:8443",
  ];

  it("accepts only exact same origins or exact configured HTTPS origins", () => {
    expect(
      isTrustedRouteOrigin(
        "http://127.0.0.1:3100/api/import",
        "http://127.0.0.1:3100",
        configured,
      ),
    ).toBe(true);
    expect(
      isTrustedRouteOrigin(
        "http://127.0.0.1:3100/api/import",
        "https://host.tailnet.ts.net",
        configured,
      ),
    ).toBe(true);
    expect(
      isTrustedRouteOrigin(
        "http://127.0.0.1:3100/api/import",
        "https://proxy.example:8443",
        configured,
      ),
    ).toBe(true);
  });

  it.each([
    null,
    "null",
    "https://other.tailnet.ts.net",
    "https://host.tailnet.ts.net.attacker.example",
    "http://host.tailnet.ts.net",
    "http://127.0.0.1",
    "https://127.0.0.1:3100",
    "not an origin",
  ])("rejects missing, unlisted, confused, or scheme-mismatched origin %j", (origin) => {
    expect(
      isTrustedRouteOrigin(
        "http://127.0.0.1:3100/api/import",
        origin,
        configured,
      ),
    ).toBe(false);
  });
});

describe("Server Action origin policy", () => {
  const configured = ["https://host.tailnet.ts.net", "https://proxy.example:8443"];
  const direct = {
    originHeader: "http://127.0.0.1:3100",
    hostHeader: "127.0.0.1:3100",
    forwardedHostHeader: "127.0.0.1:3100",
    forwardedProtoHeader: "http",
    configuredOrigins: configured,
    trustLoopbackProxy: true,
  } as const;

  it("accepts direct HTTP with absent or Next-synthesized forwarded headers", () => {
    expect(isTrustedActionOrigin(direct)).toBe(true);
    expect(
      isTrustedActionOrigin({
        ...direct,
        forwardedHostHeader: null,
        forwardedProtoHeader: null,
      }),
    ).toBe(true);
  });

  it("accepts documented localhost and direct LAN origins without proxy trust", () => {
    expect(
      isTrustedActionOrigin({
        ...direct,
        originHeader: "http://localhost:3100",
        hostHeader: "localhost:3100",
        forwardedHostHeader: "localhost:3100",
        trustLoopbackProxy: false,
      }),
    ).toBe(true);
    expect(
      isTrustedActionOrigin({
        ...direct,
        originHeader: "http://192.168.50.20:3100",
        hostHeader: "192.168.50.20:3100",
        forwardedHostHeader: "192.168.50.20:3100",
        trustLoopbackProxy: false,
      }),
    ).toBe(true);
  });

  it("accepts an exact configured HTTPS proxy only in loopback proxy mode", () => {
    const proxied = {
      ...direct,
      originHeader: "https://HOST.tailnet.ts.net:443",
      forwardedHostHeader: "host.tailnet.ts.net",
      forwardedProtoHeader: "https",
    };
    expect(isTrustedActionOrigin(proxied)).toBe(true);
    expect(
      isTrustedActionOrigin({ ...proxied, trustLoopbackProxy: false }),
    ).toBe(false);
  });

  it("retains an exact configured proxy port and rejects a direct port mismatch", () => {
    expect(
      isTrustedActionOrigin({
        ...direct,
        originHeader: "https://proxy.example:8443",
        forwardedHostHeader: "proxy.example:8443",
        forwardedProtoHeader: "https",
      }),
    ).toBe(true);
    expect(
      isTrustedActionOrigin({
        ...direct,
        originHeader: "http://127.0.0.1:3101",
      }),
    ).toBe(false);
  });

  it.each([
    { originHeader: null },
    { originHeader: "null" },
    { originHeader: "not an origin" },
    { originHeader: "https://other.tailnet.ts.net" },
    { originHeader: "http://host.tailnet.ts.net" },
    { hostHeader: null },
    { forwardedHostHeader: null },
    { forwardedProtoHeader: null },
    { forwardedProtoHeader: "https,http" },
    { forwardedHostHeader: "host.tailnet.ts.net, attacker.example" },
    { forwardedHostHeader: "host.tailnet.ts.net.attacker.example" },
  ])("rejects incomplete, unlisted, or confused proxy input %#", (override) => {
    expect(
      isTrustedActionOrigin({
        ...direct,
        originHeader: "https://host.tailnet.ts.net",
        forwardedHostHeader: "host.tailnet.ts.net",
        forwardedProtoHeader: "https",
        ...override,
      }),
    ).toBe(false);
  });

  it("rejects spoofed forwarded headers outside loopback proxy mode", () => {
    expect(
      isTrustedActionOrigin({
        ...direct,
        originHeader: "https://proxy.example:8443",
        forwardedHostHeader: "proxy.example:8443",
        forwardedProtoHeader: "https",
        trustLoopbackProxy: false,
      }),
    ).toBe(false);
  });

  it.each(ASCII_CONTROLS)(
    "rejects $label controls in Origin, Host, and forwarded headers",
    ({ value }) => {
      expect(
        isTrustedActionOrigin({
          ...direct,
          originHeader: `http://127.0.0.${value}1:3100`,
        }),
      ).toBe(false);
      expect(
        isTrustedActionOrigin({
          ...direct,
          hostHeader: `127.0.0.${value}1:3100`,
        }),
      ).toBe(false);
      expect(
        isTrustedActionOrigin({
          ...direct,
          originHeader: "https://host.tailnet.ts.net",
          forwardedHostHeader: `host.${value}tailnet.ts.net`,
          forwardedProtoHeader: "https",
        }),
      ).toBe(false);
    },
  );
});
