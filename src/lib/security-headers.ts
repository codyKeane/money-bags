export const GLOBAL_SECURITY_HEADERS = Object.freeze([
  Object.freeze({
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'",
  }),
  Object.freeze({ key: "X-Frame-Options", value: "DENY" }),
  Object.freeze({ key: "X-Content-Type-Options", value: "nosniff" }),
  Object.freeze({ key: "Referrer-Policy", value: "no-referrer" }),
]);
