export const NO_STORE_CACHE_CONTROL = "no-store";

export function noStoreJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", NO_STORE_CACHE_CONTROL);
  return Response.json(body, { ...init, headers });
}
