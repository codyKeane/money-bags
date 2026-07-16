import { z } from "zod";
import { noStoreJson } from "@/lib/http-response";
import { revalidateAfterMutation } from "@/server/revalidation";
import {
  MAX_FILE_BYTES,
  parseBoundedMultipartFormData,
  parseDeclaredContentLength,
  parseMultipartContentType,
} from "@/server/http/import-upload";
import { hasTrustedRouteOrigin } from "@/server/security/trusted-origin";
import { importStatement } from "@/server/services/import";

const FieldsSchema = z.object({
  accountId: z.string().min(1),
  dateFormat: z.enum(["auto", "MDY", "DMY"]).default("auto"),
});

function json(body: unknown, status = 200): Response {
  return noStoreJson(body, { status });
}

function invalidRequestResponse(): Response {
  return json({ error: "invalid-request" }, 400);
}

function requestTooLargeResponse(): Response {
  return json({ error: "request-too-large" }, 413);
}

function parseColumnMapJson(
  raw: FormDataEntryValue | null,
): { ok: true; value: unknown } | { ok: false } {
  if (raw === null) return { ok: true, value: undefined };
  if (typeof raw !== "string" || raw.trim().length === 0) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false };
  }
}

function invalidColumnMapJsonResponse(): Response {
  return json(
    {
      error: "invalid-column-map",
      issues: [
        {
          code: "invalid-shape",
          field: "columnMap",
          message: "Column map must be valid JSON containing a plain object.",
        },
      ],
    },
    400,
  );
}

// Route handler instead of a Server Action so the upload has an explicit 5 MiB
// boundary. Every response is JSON and non-cacheable.
export async function POST(request: Request) {
  if (!hasTrustedRouteOrigin(request)) {
    return json({ error: "forbidden" }, 403);
  }
  try {
    const declaredLength = parseDeclaredContentLength(
      request.headers.get("content-length"),
    );
    if (declaredLength.status === "invalid") return invalidRequestResponse();
    if (declaredLength.status === "too-large") return requestTooLargeResponse();

    const contentType = parseMultipartContentType(request.headers.get("content-type"));
    if (contentType.status === "unsupported") {
      return json({ error: "unsupported-media-type" }, 415);
    }
    if (contentType.status === "malformed") return invalidRequestResponse();

    const bounded = await parseBoundedMultipartFormData(request, contentType.value);
    if (bounded.status === "too-large") return requestTooLargeResponse();
    if (bounded.status === "invalid") return invalidRequestResponse();

    const formData = bounded.formData;
    const fileEntries = formData.getAll("file");
    const file = fileEntries[0];
    const hasUnexpectedFile = [...formData.entries()].some(
      ([name, value]) => name !== "file" && value instanceof File,
    );
    if (fileEntries.length !== 1 || !(file instanceof File) || hasUnexpectedFile) {
      return json({ error: "invalid-input", message: "A CSV file is required." }, 400);
    }
    if (file.size > MAX_FILE_BYTES) {
      return json({ error: "file-too-large", message: "File exceeds the 5 MB cap" }, 413);
    }
    const isCsv =
      file.name.toLowerCase().endsWith(".csv") ||
      file.type === "text/csv" ||
      file.type === "text/plain";
    if (!isCsv) {
      return json({ error: "unsupported-file", message: "Only CSV files are accepted." }, 415);
    }

    const parsed = FieldsSchema.safeParse({
      accountId: formData.get("accountId") ?? undefined,
      dateFormat: formData.get("dateFormat") ?? undefined,
    });
    if (!parsed.success) {
      return json(
        { error: "invalid-input", message: "Account and date format are required." },
        400,
      );
    }

    const columnMap = parseColumnMapJson(formData.get("columnMap"));
    if (!columnMap.ok) return invalidColumnMapJsonResponse();

    const result = await importStatement({
      account: { kind: "existing", accountId: parsed.data.accountId },
      csvText: await file.text(),
      dateFormat: parsed.data.dateFormat,
      columnMap: columnMap.value,
      filename: file.name,
    });
    if (result.status === "invalid-column-map") {
      return json({ error: result.status, issues: result.issues }, 400);
    }
    if (result.status === "invalid-input") {
      return json(
        { error: result.status, field: result.field, message: result.message },
        400,
      );
    }
    if (result.status === "unknown-account") {
      return json({ error: result.status, message: result.message }, 404);
    }
    if (result.status === "account-conflict") {
      return json({ error: result.status, message: result.message }, 409);
    }
    if (result.status === "invalid-file") {
      return json({ error: result.status, errors: result.errors }, 422);
    }
    if (result.status === "date-format-required") {
      return json(
        {
          error: result.status,
          ambiguousRowNumbers: result.ambiguousRowNumbers,
          message: "Choose MM/DD/YYYY or DD/MM/YYYY and import again.",
        },
        422,
      );
    }

    if (result.imported > 0) revalidateAfterMutation();
    return json(result);
  } catch {
    console.error("import-route-unexpected");
    return json({ error: "internal-error", message: "Import failed unexpectedly." }, 500);
  }
}
