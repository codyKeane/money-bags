import { headers } from "next/headers";
import {
  TRUST_LOOPBACK_PROXY_ENV_NAME,
  isTrustedActionOrigin,
  isTrustedRouteOrigin,
  parseBuiltAllowedOrigins,
} from "@/lib/origin-policy";

export const UNTRUSTED_ORIGIN_FAILURE = Object.freeze({
  ok: false as const,
  error: "Request origin is not trusted.",
});

const BUILT_ALLOWED_ORIGINS = parseBuiltAllowedOrigins(
  // This direct property access is intentional: Next replaces it with the
  // validated next.config.ts value at build time.
  process.env.MONEYBAGS_BUILT_ALLOWED_ORIGINS,
);

export function hasTrustedRouteOrigin(request: Request): boolean {
  return isTrustedRouteOrigin(
    request.url,
    request.headers.get("origin"),
    BUILT_ALLOWED_ORIGINS,
  );
}

export async function assertTrustedActionOrigin(): Promise<
  typeof UNTRUSTED_ORIGIN_FAILURE | null
> {
  const requestHeaders = await headers();
  const trusted = isTrustedActionOrigin({
    originHeader: requestHeaders.get("origin"),
    hostHeader: requestHeaders.get("host"),
    forwardedHostHeader: requestHeaders.get("x-forwarded-host"),
    forwardedProtoHeader: requestHeaders.get("x-forwarded-proto"),
    configuredOrigins: BUILT_ALLOWED_ORIGINS,
    trustLoopbackProxy:
      process.env[TRUST_LOOPBACK_PROXY_ENV_NAME] === "1",
  });
  return trusted ? null : UNTRUSTED_ORIGIN_FAILURE;
}
