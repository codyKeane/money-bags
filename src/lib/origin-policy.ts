export const BUILT_ALLOWED_ORIGINS_ENV_NAME =
  "MONEYBAGS_BUILT_ALLOWED_ORIGINS";
export const TRUST_LOOPBACK_PROXY_ENV_NAME =
  "MONEYBAGS_TRUST_LOOPBACK_PROXY";

const CONFIGURATION_ERROR =
  "must be an exact HTTPS origin without credentials, a wildcard, a trailing-dot hostname, a path, query, or fragment";

export interface BuiltOriginConfiguration {
  readonly configuredOrigins: readonly string[];
  readonly allowedHosts: readonly string[];
  readonly serializedOrigins: string;
}

export interface ActionOriginInput {
  readonly originHeader: string | null;
  readonly hostHeader: string | null;
  readonly forwardedHostHeader: string | null;
  readonly forwardedProtoHeader: string | null;
  readonly configuredOrigins: readonly string[];
  readonly trustLoopbackProxy: boolean;
}

function configurationError(index: number): Error {
  return new Error(
    `EXTRA_ALLOWED_ORIGINS entry ${index + 1} ${CONFIGURATION_ERROR}.`,
  );
}

function isValidHostname(hostname: string): boolean {
  if (hostname.startsWith("[") && hostname.endsWith("]")) return true;
  if (hostname.length > 253) return false;
  return hostname.split(".").every((label) =>
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/i.test(label),
  );
}

function parseOrigin(
  value: string,
  {
    httpsOnly,
    rejectTrailingDot,
  }: { httpsOnly: boolean; rejectTrailingDot: boolean },
): URL | null {
  if (value.length === 0 || value !== value.trim()) return null;
  const exactOrigin = /^(https?):\/\/([^/?#]+)\/?$/i.exec(value);
  if (!exactOrigin) return null;
  const protocol = exactOrigin[1]?.toLowerCase();
  const authority = exactOrigin[2];
  if (
    !authority ||
    /(?:\s|[\u0000-\u001f\u007f])/u.test(value) ||
    authority.includes("@") ||
    authority.includes("\\") ||
    authority.includes("%")
  ) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (httpsOnly ? protocol !== "https" : protocol !== "http" && protocol !== "https") {
    return null;
  }
  if (url.username || url.password || url.pathname !== "/") return null;
  if (!url.hostname || url.hostname.includes("*")) return null;
  if (rejectTrailingDot && url.hostname.endsWith(".")) return null;
  if (!isValidHostname(url.hostname)) return null;
  return url;
}

function normalizeConfiguredOrigin(value: string, index: number): string {
  const parsed = parseOrigin(value, {
    httpsOnly: true,
    rejectTrailingDot: true,
  });
  if (!parsed) throw configurationError(index);
  return parsed.origin;
}

export function parseExtraAllowedOrigins(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim().length === 0) return Object.freeze([]);

  const normalized = raw.split(",").map((entry, index) => {
    const trimmed = entry.trim();
    if (trimmed.length === 0) throw configurationError(index);
    return normalizeConfiguredOrigin(trimmed, index);
  });
  return Object.freeze([...new Set(normalized)]);
}

export function createBuiltOriginConfiguration(
  raw: string | undefined,
): BuiltOriginConfiguration {
  const configuredOrigins = parseExtraAllowedOrigins(raw);
  const allowedHosts = Object.freeze(
    configuredOrigins.map((origin) => new URL(origin).host),
  );
  return Object.freeze({
    configuredOrigins,
    allowedHosts,
    serializedOrigins: JSON.stringify(configuredOrigins),
  });
}

export function parseBuiltAllowedOrigins(serialized: string | undefined): readonly string[] {
  if (serialized === undefined) return Object.freeze([]);

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error("Built trusted-origin configuration is invalid.");
  }
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
    throw new Error("Built trusted-origin configuration is invalid.");
  }

  const normalized = parsed.map((value, index) =>
    normalizeConfiguredOrigin(value, index),
  );
  if (normalized.some((value, index) => value !== parsed[index])) {
    throw new Error("Built trusted-origin configuration is not canonical.");
  }
  return Object.freeze([...new Set(normalized)]);
}

export function normalizeRequestOrigin(value: string | null): string | null {
  if (value === null || value === "null") return null;
  return (
    parseOrigin(value, { httpsOnly: false, rejectTrailingDot: true })?.origin ??
    null
  );
}

function requestUrlOrigin(requestUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  return parsed.origin;
}

export function isTrustedRouteOrigin(
  requestUrl: string,
  originHeader: string | null,
  configuredOrigins: readonly string[],
): boolean {
  const origin = normalizeRequestOrigin(originHeader);
  if (!origin) return false;
  return (
    origin === requestUrlOrigin(requestUrl) || configuredOrigins.includes(origin)
  );
}

function originFromHost(protocol: "http" | "https", host: string | null): string | null {
  if (host === null || host.length === 0 || host !== host.trim()) return null;
  return normalizeRequestOrigin(`${protocol}://${host}`);
}

export function isTrustedActionOrigin(input: ActionOriginInput): boolean {
  const origin = normalizeRequestOrigin(input.originHeader);
  const directOrigin = originFromHost("http", input.hostHeader);
  if (!origin || !directOrigin) return false;

  const hasForwardedHost = input.forwardedHostHeader !== null;
  const hasForwardedProto = input.forwardedProtoHeader !== null;
  if (hasForwardedHost !== hasForwardedProto) return false;

  if (!hasForwardedHost) return origin === directOrigin;

  const forwardedProtocol = input.forwardedProtoHeader;
  if (forwardedProtocol !== "http" && forwardedProtocol !== "https") return false;
  const forwardedOrigin = originFromHost(
    forwardedProtocol,
    input.forwardedHostHeader,
  );
  if (!forwardedOrigin) return false;

  // Next synthesizes X-Forwarded-Host/Proto for direct requests. Treat only an
  // exact copy of the direct HTTP target as direct; any other pair is a proxy.
  if (forwardedOrigin === directOrigin) return origin === directOrigin;

  if (!input.trustLoopbackProxy || forwardedProtocol !== "https") return false;
  return (
    origin === forwardedOrigin && input.configuredOrigins.includes(forwardedOrigin)
  );
}
