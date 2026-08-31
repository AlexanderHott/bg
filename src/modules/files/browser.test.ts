import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { uploadFile, type UploadProgress } from "./browser";

const serverFunctions = vi.hoisted(() => ({
  beginFileUploadFn: vi.fn(),
  completeFileUploadFn: vi.fn(),
}));

vi.mock("./serverFunctions", () => serverFunctions);

const readyFile = {
  id: "01994fd4-c3ef-7f5a-a0cb-768f7f6d3be6",
  organizationId: "01994fd4-d61a-7d1d-b36d-6832661f94ea",
  name: "image.png",
  mediaType: "image/png",
  sizeBytes: 6,
  createdAt: new Date("2026-08-30T00:00:00.000Z"),
};

beforeEach(() => {
  serverFunctions.beginFileUploadFn.mockReset();
  serverFunctions.completeFileUploadFn.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadFile", () => {
  test("cancels an in-flight begin request", async () => {
    const controller = new AbortController();
    serverFunctions.beginFileUploadFn.mockImplementationOnce(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );

    const resultPromise = uploadFile({
      organizationSlug: "organization",
      requestId: "01994fd5-7849-7de8-8c44-045dd8e74ac9",
      file: new File(["abcdef"], "image.png", { type: "image/png" }),
      signal: controller.signal,
    });
    controller.abort();

    await expect(resultPromise).resolves.toEqual({ ok: false, error: { kind: "CANCELLED" } });
    expect(serverFunctions.completeFileUploadFn).not.toHaveBeenCalled();
  });

  test("uploads four parts concurrently and completes with exact ETags", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const controller = new AbortController();
    const progress: Array<UploadProgress> = [];
    const expiresAt = new Date("2026-08-30T01:00:00.000Z");

    serverFunctions.beginFileUploadFn.mockResolvedValueOnce({
      ok: true,
      value: {
        kind: "upload",
        fileId: readyFile.id,
        partSizeBytes: 1,
        uploadedParts: [{ partNumber: 1, etag: '"etag-1"', sizeBytes: 1 }],
        parts: Array.from({ length: 5 }, (_, index) => ({
          partNumber: index + 2,
          offsetBytes: index + 1,
          sizeBytes: 1,
          method: "PUT",
          url: `https://uploads.test/${index + 2}`,
          expiresAt,
        })),
      },
    });
    serverFunctions.completeFileUploadFn.mockResolvedValueOnce({ ok: true, value: readyFile });

    const result = await uploadFile({
      organizationSlug: "organization",
      requestId: "01994fd5-7849-7de8-8c44-045dd8e74ac9",
      file: new File(["abcdef"], "image.png", { type: "image/png" }),
      signal: controller.signal,
      onProgress(value) {
        progress.push(value);
      },
    });

    expect(result).toEqual({ ok: true, value: readyFile });
    expect(FakeXMLHttpRequest.maximumActiveRequests).toBe(4);
    expect(serverFunctions.completeFileUploadFn).toHaveBeenCalledWith({
      signal: controller.signal,
      data: {
        organizationSlug: "organization",
        fileId: readyFile.id,
        parts: Array.from({ length: 6 }, (_, index) => ({
          partNumber: index + 1,
          etag: `"etag-${index + 1}"`,
        })),
      },
    });
    expect(progress.at(-1)).toEqual({
      phase: "finalizing",
      uploadedBytes: 6,
      totalBytes: 6,
    });
  });
});

class FakeXMLHttpRequest {
  static activeRequests = 0;
  static maximumActiveRequests = 0;

  readonly upload = {
    addEventListener: (_type: string, listener: (event: { loaded: number }) => void) => {
      this.progressListener = listener;
    },
  };
  status = 200;

  private url = "";
  private finished = false;
  private progressListener?: (event: { loaded: number }) => void;
  private readonly listeners = new Map<string, () => void>();

  open(_method: string, url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener);
  }

  getResponseHeader(name: string) {
    if (name !== "ETag") return null;
    return `"etag-${this.url.split("/").at(-1)}"`;
  }

  send(body: Blob) {
    FakeXMLHttpRequest.activeRequests += 1;
    FakeXMLHttpRequest.maximumActiveRequests = Math.max(
      FakeXMLHttpRequest.maximumActiveRequests,
      FakeXMLHttpRequest.activeRequests,
    );
    this.progressListener?.({ loaded: body.size });

    setTimeout(() => {
      if (this.finished) return;
      this.finished = true;
      FakeXMLHttpRequest.activeRequests -= 1;
      this.listeners.get("load")?.();
    });
  }

  abort() {
    if (this.finished) return;
    this.finished = true;
    FakeXMLHttpRequest.activeRequests -= 1;
    this.listeners.get("abort")?.();
  }
}
