import { beforeEach, describe, expect, it, vi } from "vitest";
import * as importService from "@/server/services/import";
import type { ImportResult } from "@/server/services/import";
import {
  MAX_FILE_BYTES,
  MAX_MULTIPART_BYTES,
  MAX_MULTIPART_OVERHEAD_BYTES,
} from "@/server/http/import-upload";

const revalidateAfterMutation = vi.hoisted(() => vi.fn());
vi.mock("@/server/revalidation", () => ({ revalidateAfterMutation }));

import { POST } from "./route";

function importRequest(
  csvText: string,
  options: { dateFormat?: string; columnMap?: string; origin?: string } = {},
): Request {
  const formData = new FormData();
  formData.set("accountId", "synthetic-account");
  formData.set("dateFormat", options.dateFormat ?? "auto");
  formData.set("file", new File([csvText], "synthetic.csv", { type: "text/csv" }));
  if (options.columnMap !== undefined) formData.set("columnMap", options.columnMap);
  return new Request("http://127.0.0.1:3100/api/import", {
    method: "POST",
    body: formData,
    headers: { origin: options.origin ?? "http://127.0.0.1:3100" },
  });
}

function completedResult(): ImportResult {
  return {
    status: "completed",
    imported: 1,
    skipped: [],
    errors: [],
    warnings: [],
    batchId: "synthetic-batch",
    account: {
      id: "synthetic-account",
      name: "Synthetic",
      type: "CHECKING",
      currency: "USD",
      created: false,
    },
  };
}

function requestForFormData(formData: FormData): Request {
  return new Request("http://127.0.0.1:3100/api/import", {
    method: "POST",
    body: formData,
    headers: { origin: "http://127.0.0.1:3100" },
  });
}

function baseFormData(file: File): FormData {
  const formData = new FormData();
  formData.set("accountId", "synthetic-account");
  formData.set("dateFormat", "MDY");
  formData.set("file", file);
  return formData;
}

describe("POST /api/import preflight mappings", () => {
  beforeEach(() => {
    revalidateAfterMutation.mockClear();
  });

  it("maps ambiguous dates to an actionable 422 without revalidation", async () => {
    const response = await POST(
      importRequest("Date,Description,Amount\n03/04/2026,SYNTHETIC,-1.00\n"),
    );

    expect(response.status).toBe(422);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "date-format-required",
      ambiguousRowNumbers: [2],
      message: "Choose MM/DD/YYYY or DD/MM/YYYY and import again.",
    });
    expect(revalidateAfterMutation).not.toHaveBeenCalled();
  });

  it("maps a mixed valid/invalid file to 422 with safe row details and no rows", async () => {
    const response = await POST(
      importRequest(
        "Date,Description,Amount\n2026-06-01,VALID,-1.00\n2026-06-02,SENSITIVE VALUE,garbage\n",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      error: "invalid-file",
      errors: [{ rowNumber: 3, message: "Unparseable amount" }],
    });
    expect(JSON.stringify(body)).not.toMatch(/SENSITIVE|garbage/);
    expect(revalidateAfterMutation).not.toHaveBeenCalled();
  });

  it.each(["{", "", JSON.stringify([]), JSON.stringify({})])(
    "maps malformed or invalid column-map JSON %j to 400 without fallback",
    async (columnMap) => {
      const response = await POST(
        importRequest("Date,Description,Amount\n2026-06-01,SYNTHETIC,-1.00\n", {
          columnMap,
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(body.error).toBe("invalid-column-map");
      expect(body.issues).toHaveLength(1);
      expect(revalidateAfterMutation).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["unknown-account", 404],
    ["account-conflict", 409],
  ] as const)("maps %s to %i with no revalidation", async (status, expectedStatus) => {
    const result = {
      status,
      imported: 0,
      skipped: [],
      errors: [],
      warnings: [],
      batchId: null,
      account: null,
      message: status === "unknown-account" ? "Unknown account" : "Account conflict",
    } satisfies ImportResult;
    const mock = vi.spyOn(importService, "importStatement").mockResolvedValue(result);
    try {
      const response = await POST(
        importRequest("Date,Description,Amount\n2026-06-01,SYNTHETIC,-1.00\n", {
          dateFormat: "MDY",
        }),
      );
      expect(response.status).toBe(expectedStatus);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect((await response.json()).error).toBe(status);
      expect(revalidateAfterMutation).not.toHaveBeenCalled();
    } finally {
      mock.mockRestore();
    }
  });

  it("returns completed imports as non-cacheable success and revalidates the root layout", async () => {
    const result = completedResult();
    const mock = vi.spyOn(importService, "importStatement").mockResolvedValue(result);
    try {
      const response = await POST(
        importRequest("Date,Description,Amount\n2026-06-01,SYNTHETIC,-1.00\n", {
          dateFormat: "MDY",
        }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ status: "completed", imported: 1 });
      expect(revalidateAfterMutation).toHaveBeenCalledTimes(1);
    } finally {
      mock.mockRestore();
    }
  });

  it("does not revalidate a completed import that made no ledger change", async () => {
    const result = {
      ...completedResult(),
      imported: 0,
      batchId: null,
    } satisfies ImportResult;
    const mock = vi.spyOn(importService, "importStatement").mockResolvedValue(result);
    try {
      const response = await POST(
        importRequest("Date,Description,Amount\n2026-06-01,SYNTHETIC,-1.00\n", {
          dateFormat: "MDY",
        }),
      );

      expect(response.status).toBe(200);
      expect(revalidateAfterMutation).not.toHaveBeenCalled();
    } finally {
      mock.mockRestore();
    }
  });

  it.each([
    ["missing", undefined],
    ["null", "null"],
    ["malformed", "not an origin"],
    ["unlisted", "https://other.tailnet.ts.net"],
    ["scheme mismatch", "https://127.0.0.1:3100"],
    ["port mismatch", "http://127.0.0.1"],
  ] as const)("rejects a %s Origin before import service work", async (_label, origin) => {
    const request = importRequest(
      "Date,Description,Amount\n2026-06-01,SYNTHETIC,-1.00\n",
    );
    if (origin === undefined) request.headers.delete("origin");
    else request.headers.set("origin", origin);
    const mock = vi.spyOn(importService, "importStatement");
    try {
      const response = await POST(request);

      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "forbidden" });
      expect(mock).not.toHaveBeenCalled();
      expect(revalidateAfterMutation).not.toHaveBeenCalled();
    } finally {
      mock.mockRestore();
    }
  });

  it("rejects before content metadata or a throwing body can be read", async () => {
    const get = vi.fn((name: string) => {
      if (name === "origin") return "https://unlisted.example";
      throw new Error(`header ${name} must not be read`);
    });
    const formData = vi.fn(() => {
      throw new Error("body must not be read");
    });
    const request = {
      url: "http://127.0.0.1:3100/api/import",
      headers: { get },
      formData,
    } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(get).toHaveBeenCalledExactlyOnceWith("origin");
    expect(formData).not.toHaveBeenCalled();
  });

  it.each([
    ["HTAB", "\t"],
    ["LF", "\n"],
    ["CR", "\r"],
    ["NUL", "\0"],
    ["DEL", "\x7f"],
  ] as const)("rejects an Origin containing %s before body access", async (_label, value) => {
    const formData = vi.fn(() => {
      throw new Error("body must not be read");
    });
    const request = {
      url: "http://127.0.0.1:3100/api/import",
      headers: {
        get(name: string) {
          return name === "origin" ? `http://127.0.0.${value}1:3100` : null;
        },
      },
      formData,
    } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(formData).not.toHaveBeenCalled();
  });

  it.each(["", "-1", "+1", " 1", "1 ", "1.0", "1e3", "1, 2", "9007199254740992"])(
    "rejects malformed Content-Length %j before content type or body access",
    async (contentLength) => {
      const get = vi.fn((name: string) => {
        if (name === "origin") return "http://127.0.0.1:3100";
        if (name === "content-length") return contentLength;
        throw new Error(`${name} must not be read`);
      });
      const request = {
        url: "http://127.0.0.1:3100/api/import",
        headers: { get },
        get body() {
          throw new Error("body must not be read");
        },
      } as unknown as Request;

      const response = await POST(request);

      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "invalid-request" });
      expect(get).not.toHaveBeenCalledWith("content-type");
    },
  );

  it("rejects a declared total one byte over the cap before body access", async () => {
    const get = vi.fn((name: string) => {
      if (name === "origin") return "http://127.0.0.1:3100";
      if (name === "content-length") return String(MAX_MULTIPART_BYTES + 1);
      throw new Error(`${name} must not be read`);
    });
    const request = {
      url: "http://127.0.0.1:3100/api/import",
      headers: { get },
      get body() {
        throw new Error("body must not be read");
      },
    } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "request-too-large" });
    expect(get).not.toHaveBeenCalledWith("content-type");
  });

  it.each([
    ["a wrong media type", "text/csv", 415, "unsupported-media-type"],
    ["a missing boundary", "multipart/form-data", 400, "invalid-request"],
    [
      "duplicate boundaries",
      "multipart/form-data; boundary=one; boundary=two",
      400,
      "invalid-request",
    ],
  ] as const)(
    "rejects %s before body access",
    async (_label, contentType, expectedStatus, error) => {
      const request = {
        url: "http://127.0.0.1:3100/api/import",
        headers: {
          get(name: string) {
            if (name === "origin") return "http://127.0.0.1:3100";
            if (name === "content-length") return null;
            if (name === "content-type") return contentType;
            return null;
          },
        },
        get body() {
          throw new Error("body must not be read");
        },
      } as unknown as Request;

      const response = await POST(request);

      expect(response.status).toBe(expectedStatus);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error });
    },
  );

  it("rejects a missing multipart body as a generic non-cacheable request error", async () => {
    const request = new Request("http://127.0.0.1:3100/api/import", {
      method: "POST",
      headers: {
        origin: "http://127.0.0.1:3100",
        "content-type": "multipart/form-data; boundary=synthetic",
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "invalid-request" });
  });

  it.each([
    ["absent", undefined, false],
    ["chunked", undefined, true],
    ["deliberately understated", "1", false],
  ] as const)(
    "stops a body one byte over the measured total cap with %s Content-Length",
    async (_label, contentLength, chunked) => {
      const cancel = vi.fn();
      let pullCount = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(
            pullCount++ === 0 ? new Uint8Array(MAX_MULTIPART_BYTES) : Uint8Array.of(1),
          );
        },
        cancel,
      });
      const headers: Record<string, string> = {
        origin: "http://127.0.0.1:3100",
        "content-type": "multipart/form-data; boundary=synthetic",
      };
      if (contentLength !== undefined) headers["content-length"] = contentLength;
      if (chunked) headers["transfer-encoding"] = "chunked";
      const request = new Request("http://127.0.0.1:3100/api/import", {
        method: "POST",
        headers,
        body: stream,
        duplex: "half",
      } as RequestInit & { duplex: "half" });

      const response = await POST(request);

      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ error: "request-too-large" });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(request.body?.locked).toBe(false);
    },
  );

  it("accepts an exact 5 MiB file when multipart overhead stays in budget", async () => {
    const file = new File([new Uint8Array(MAX_FILE_BYTES)], "exact.csv", {
      type: "text/csv",
    });
    const request = requestForFormData(baseFormData(file));
    expect((await request.clone().arrayBuffer()).byteLength).toBeLessThanOrEqual(
      MAX_MULTIPART_BYTES,
    );
    const mock = vi.spyOn(importService, "importStatement").mockResolvedValue(completedResult());
    try {
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(mock).toHaveBeenCalledWith(
        expect.objectContaining({ filename: "exact.csv" }),
      );
    } finally {
      mock.mockRestore();
    }
  });

  it("rejects a file one byte over its independent cap", async () => {
    const file = new File([new Uint8Array(MAX_FILE_BYTES + 1)], "over.csv", {
      type: "text/csv",
    });
    const formData = baseFormData(file);
    formData.delete("accountId");
    const request = requestForFormData(formData);
    expect((await request.clone().arrayBuffer()).byteLength).toBeLessThanOrEqual(
      MAX_MULTIPART_BYTES,
    );
    const mock = vi.spyOn(importService, "importStatement");
    try {
      const response = await POST(request);

      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ error: "file-too-large" });
      expect(mock).not.toHaveBeenCalled();
    } finally {
      mock.mockRestore();
    }
  });

  it("counts additional form fields against the multipart overhead budget", async () => {
    const file = new File(
      [new Uint8Array(MAX_FILE_BYTES - 1_024)],
      "under-file-cap.csv",
      { type: "text/csv" },
    );
    const formData = baseFormData(file);
    formData.set("synthetic-overhead", "x".repeat(MAX_MULTIPART_OVERHEAD_BYTES + 2_048));
    const mock = vi.spyOn(importService, "importStatement");
    try {
      const response = await POST(requestForFormData(formData));

      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ error: "request-too-large" });
      expect(mock).not.toHaveBeenCalled();
    } finally {
      mock.mockRestore();
    }
  });

  it.each(["duplicate expected", "unexpected name"])(
    "rejects a %s file field",
    async (variant) => {
      const formData = baseFormData(
        new File(["safe"], "first.csv", { type: "text/csv" }),
      );
      formData.append(
        variant === "duplicate expected" ? "file" : "attachment",
        new File(["safe"], "second.csv", { type: "text/csv" }),
      );
      const mock = vi.spyOn(importService, "importStatement");
      try {
        const response = await POST(requestForFormData(formData));

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: "invalid-input" });
        expect(mock).not.toHaveBeenCalled();
      } finally {
        mock.mockRestore();
      }
    },
  );

  it("returns generic JSON for malformed in-limit multipart data", async () => {
    const sensitive = "sensitive malformed multipart value";
    const request = new Request("http://127.0.0.1:3100/api/import", {
      method: "POST",
      headers: {
        origin: "http://127.0.0.1:3100",
        "content-type": "multipart/form-data; boundary=synthetic",
      },
      body: sensitive,
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await POST(request);
      const text = await response.text();

      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(JSON.parse(text)).toEqual({ error: "invalid-request" });
      expect(text).not.toContain(sensitive);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
