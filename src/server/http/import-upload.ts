export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
export const MAX_MULTIPART_BYTES = MAX_FILE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;

type DeclaredLengthResult =
  | { status: "absent" }
  | { status: "accepted"; bytes: number }
  | { status: "invalid" }
  | { status: "too-large" };

type MultipartContentTypeResult =
  | { status: "accepted"; value: string }
  | { status: "unsupported" }
  | { status: "malformed" };

export type BoundedBodyResult =
  | { status: "accepted"; bytes: Uint8Array<ArrayBuffer> }
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "too-large" };

export type BoundedFormDataResult =
  | { status: "accepted"; formData: FormData }
  | { status: "invalid" }
  | { status: "too-large" };

const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const MULTIPART_BOUNDARY = /^[0-9A-Za-z'()+_,./:=? -]{1,70}$/;
const MULTIPART_BOUNDARY_LAST = /[0-9A-Za-z'()+_,./:=?-]$/;
const INVALID_HEADER_CHARACTER = /[^\x20-\x7e]/;

export function parseDeclaredContentLength(value: string | null): DeclaredLengthResult {
  if (value === null) return { status: "absent" };
  if (!/^[0-9]+$/.test(value)) return { status: "invalid" };

  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes)) return { status: "invalid" };
  return bytes > MAX_MULTIPART_BYTES
    ? { status: "too-large" }
    : { status: "accepted", bytes };
}

function splitHeaderParameters(value: string): string[] | null {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && character === ";") {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }

  if (quoted || escaped) return null;
  parts.push(value.slice(start));
  return parts;
}

function parseParameterValue(value: string): string | null {
  if (!value.startsWith('"')) return HTTP_TOKEN.test(value) ? value : null;
  if (!value.endsWith('"') || value.length < 2) return null;

  let parsed = "";
  for (let index = 1; index < value.length - 1; index++) {
    const character = value[index];
    if (character === '"') return null;
    if (character === "\\") {
      index++;
      if (index >= value.length - 1) return null;
      parsed += value[index];
    } else {
      parsed += character;
    }
  }
  return parsed;
}

export function parseMultipartContentType(value: string | null): MultipartContentTypeResult {
  if (value === null) return { status: "unsupported" };
  const mediaType = value.slice(0, value.indexOf(";") === -1 ? undefined : value.indexOf(";"));
  if (mediaType.trim().toLowerCase() !== "multipart/form-data") {
    return { status: "unsupported" };
  }
  if (INVALID_HEADER_CHARACTER.test(value)) return { status: "malformed" };

  const parts = splitHeaderParameters(value);
  if (!parts || parts.length < 2) return { status: "malformed" };

  let boundary: string | null = null;
  for (const rawParameter of parts.slice(1)) {
    const parameter = rawParameter.trim();
    const equals = parameter.indexOf("=");
    if (equals <= 0 || equals === parameter.length - 1) return { status: "malformed" };

    const name = parameter.slice(0, equals).trim();
    const rawValue = parameter.slice(equals + 1).trim();
    if (!HTTP_TOKEN.test(name)) return { status: "malformed" };
    const parsedValue = parseParameterValue(rawValue);
    if (parsedValue === null) return { status: "malformed" };

    if (name.toLowerCase() === "boundary") {
      if (boundary !== null) return { status: "malformed" };
      boundary = parsedValue;
    }
  }

  if (
    boundary === null ||
    !MULTIPART_BOUNDARY.test(boundary) ||
    !MULTIPART_BOUNDARY_LAST.test(boundary)
  ) {
    return { status: "malformed" };
  }
  return {
    status: "accepted",
    value: `multipart/form-data; boundary="${boundary}"`,
  };
}

function cancelReaderBestEffort(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // The stream may already be errored. Releasing the lock remains mandatory.
  }
}

export async function readBodyWithinLimit(
  body: ReadableStream<Uint8Array> | null,
  maxBytes = MAX_MULTIPART_BYTES,
): Promise<BoundedBodyResult> {
  if (body === null) return { status: "missing" };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      } catch {
        cancelReaderBestEffort(reader);
        return { status: "invalid" };
      }
      if (next.done) break;
      if (next.value.byteLength > maxBytes - totalBytes) {
        cancelReaderBestEffort(reader);
        return { status: "too-large" };
      }

      if (next.value.byteLength > 0) {
        // Copy the view so a small chunk cannot retain an unrelated large backing buffer.
        chunks.push(new Uint8Array(next.value));
        totalBytes += next.value.byteLength;
      }
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { status: "accepted", bytes };
  } finally {
    chunks.length = 0;
    reader.releaseLock();
  }
}

export async function parseBoundedMultipartFormData(
  request: Request,
  contentType: string,
): Promise<BoundedFormDataResult> {
  const boundedBody = await readBodyWithinLimit(request.body);
  if (boundedBody.status === "too-large") return boundedBody;
  if (boundedBody.status !== "accepted") return { status: "invalid" };

  try {
    const headers = new Headers({
      "Content-Length": String(boundedBody.bytes.byteLength),
      "Content-Type": contentType,
    });
    const boundedRequest = new Request(request.url, {
      method: "POST",
      headers,
      body: boundedBody.bytes,
    });
    return { status: "accepted", formData: await boundedRequest.formData() };
  } catch {
    return { status: "invalid" };
  }
}
