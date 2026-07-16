import { describe, expect, it, vi } from "vitest";
import {
  MAX_FILE_BYTES,
  MAX_MULTIPART_BYTES,
  MAX_MULTIPART_OVERHEAD_BYTES,
  parseBoundedMultipartFormData,
  parseDeclaredContentLength,
  parseMultipartContentType,
  readBodyWithinLimit,
} from "./import-upload";

describe("import upload metadata", () => {
  it("publishes the exact file, overhead, and total caps", () => {
    expect(MAX_FILE_BYTES).toBe(5_242_880);
    expect(MAX_MULTIPART_OVERHEAD_BYTES).toBe(65_536);
    expect(MAX_MULTIPART_BYTES).toBe(5_308_416);
  });

  it.each([null, "0", "00012", String(MAX_MULTIPART_BYTES)])(
    "accepts absent or in-range Content-Length %j",
    (value) => {
      expect(parseDeclaredContentLength(value).status).toMatch(/absent|accepted/);
    },
  );

  it.each([
    "",
    "-1",
    "+1",
    " 1",
    "1 ",
    "1.0",
    "1e3",
    "1, 1",
    String(Number.MAX_SAFE_INTEGER + 1),
  ])("rejects malformed or unsafe Content-Length %j", (value) => {
    expect(parseDeclaredContentLength(value)).toEqual({ status: "invalid" });
  });

  it("classifies a declared request one byte over the total cap", () => {
    expect(parseDeclaredContentLength(String(MAX_MULTIPART_BYTES + 1))).toEqual({
      status: "too-large",
    });
  });

  it.each([
    "multipart/form-data; boundary=synthetic-boundary",
    'Multipart/Form-Data; boundary="synthetic boundary"',
    "multipart/form-data; charset=utf-8; boundary=synthetic",
  ])("accepts a usable multipart Content-Type %j", (value) => {
    const result = parseMultipartContentType(value);
    expect(result.status).toBe("accepted");
    if (result.status === "accepted") {
      expect(result.value).toMatch(/^multipart\/form-data; boundary=".+"$/);
    }
  });

  it.each([null, "text/csv", "application/json; boundary=synthetic"])(
    "classifies a wrong media type %j as unsupported",
    (value) => {
      expect(parseMultipartContentType(value)).toEqual({ status: "unsupported" });
    },
  );

  it.each([
    "multipart/form-data",
    "multipart/form-data; boundary=",
    "multipart/form-data; boundary=one; boundary=two",
    'multipart/form-data; boundary="unterminated',
    `multipart/form-data; boundary=${"x".repeat(71)}`,
    'multipart/form-data; boundary="trailing "',
    "multipart/form-data; boundary=bad boundary",
    "multipart/form-data; boundary=bad\tboundary",
  ])("rejects malformed multipart metadata %j", (value) => {
    expect(parseMultipartContentType(value)).toEqual({ status: "malformed" });
  });
});

describe("bounded request body reading", () => {
  it("combines only in-limit chunks and releases the reader lock", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1, 2));
        controller.enqueue(Uint8Array.of(3));
        controller.close();
      },
    });

    await expect(readBodyWithinLimit(stream, 3)).resolves.toEqual({
      status: "accepted",
      bytes: Uint8Array.of(1, 2, 3),
    });
    expect(stream.locked).toBe(false);
  });

  it("cancels an over-limit reader, discards chunks, and releases its lock", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const releaseLock = vi.fn();
    const body = {
      getReader: () => ({
        read: vi
          .fn()
          .mockResolvedValueOnce({ done: false, value: Uint8Array.of(1, 2) })
          .mockResolvedValueOnce({ done: false, value: Uint8Array.of(3, 4) }),
        cancel,
        releaseLock,
      }),
    } as unknown as ReadableStream<Uint8Array>;

    await expect(readBodyWithinLimit(body, 3)).resolves.toEqual({ status: "too-large" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it("best-effort cancels and releases a reader whose read throws", async () => {
    const cancel = vi.fn().mockRejectedValue(new Error("synthetic cancel failure"));
    const releaseLock = vi.fn();
    const body = {
      getReader: () => ({
        read: vi.fn().mockRejectedValue(new Error("synthetic read failure")),
        cancel,
        releaseLock,
      }),
    } as unknown as ReadableStream<Uint8Array>;

    await expect(readBodyWithinLimit(body, 3)).resolves.toEqual({ status: "invalid" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it("does not wait for a never-settling cancellation before releasing the lock", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const releaseLock = vi.fn();
    const body = {
      getReader: () => ({
        read: vi.fn().mockResolvedValue({
          done: false,
          value: Uint8Array.of(1, 2, 3, 4),
        }),
        cancel,
        releaseLock,
      }),
    } as unknown as ReadableStream<Uint8Array>;

    await expect(readBodyWithinLimit(body, 3)).resolves.toEqual({ status: "too-large" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it("uses one reconstructed request with minimal headers for multipart parsing", async () => {
    const formData = new FormData();
    formData.set("accountId", "synthetic-account");
    formData.set("file", new File(["safe"], "synthetic.csv", { type: "text/csv" }));
    const request = new Request("http://127.0.0.1:3100/api/import", {
      method: "POST",
      body: formData,
      headers: {
        Cookie: "must-not-be-copied",
        "Transfer-Encoding": "chunked",
      },
    });
    const originalFormData = vi.fn(() => {
      throw new Error("the original network request must not be parsed");
    });
    Object.defineProperty(request, "formData", { value: originalFormData });

    const nativeFormData = Request.prototype.formData;
    const parsedRequests: Request[] = [];
    const formDataSpy = vi
      .spyOn(Request.prototype, "formData")
      .mockImplementation(async function (this: Request) {
        parsedRequests.push(this);
        return nativeFormData.call(this);
      });
    try {
      const contentType = request.headers.get("content-type");
      if (!contentType) throw new Error("synthetic multipart request lacked Content-Type");
      const result = await parseBoundedMultipartFormData(request, contentType);

      expect(result.status).toBe("accepted");
      expect(originalFormData).not.toHaveBeenCalled();
      expect(formDataSpy).toHaveBeenCalledTimes(1);
      const parsedRequest = parsedRequests[0];
      expect(parsedRequest).toBeDefined();
      expect(parsedRequest).not.toBe(request);
      expect(parsedRequest?.headers.get("cookie")).toBeNull();
      expect(parsedRequest?.headers.get("transfer-encoding")).toBeNull();
      expect(parsedRequest?.headers.get("content-length")).toBeTruthy();
    } finally {
      formDataSpy.mockRestore();
    }
  });

  it("maps malformed bounded multipart bytes to a generic invalid result", async () => {
    const request = new Request("http://127.0.0.1:3100/api/import", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=synthetic" },
      body: "sensitive malformed body",
    });

    await expect(
      parseBoundedMultipartFormData(
        request,
        "multipart/form-data; boundary=synthetic",
      ),
    ).resolves.toEqual({ status: "invalid" });
  });
});
