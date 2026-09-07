import { expect, test, vi } from "vite-plus/test";

import { err, ok } from "@/lib/result";

import type { uploadFile } from "./browser";
import { createImageUploadBatch } from "./imageUploadBatch";

vi.mock("./serverFunctions", () => ({ beginFileUploadFn: vi.fn(), completeFileUploadFn: vi.fn() }));

function setup(upload: typeof uploadFile = vi.fn(async (options) => uploaded(options))) {
  const onUploaded = vi.fn();
  const batch = createImageUploadBatch({
    organizationSlug: () => "test",
    maxSizeBytes: 100,
    onUploaded,
    upload,
  });
  return { batch, upload, onUploaded };
}

function uploaded(options: Parameters<typeof uploadFile>[0]) {
  return ok({
    id: options.requestId,
    requestId: options.requestId,
    organizationId: "organization-id",
    name: options.file.name,
    mediaType: options.file.type,
    sizeBytes: options.file.size,
    createdAt: new Date(),
  });
}

function image(name = "portrait.png") {
  return new File(["image"], name, { type: "image/png" });
}

test("accepts valid images from a mixed drop and reports each rejected file", () => {
  const { batch } = setup();
  batch.add([
    image(),
    new File(["text"], "notes.txt", { type: "text/plain" }),
    new File([], "empty.png", { type: "image/png" }),
    new File([new Uint8Array(101)], "large.png", { type: "image/png" }),
  ]);
  expect(batch.entries().map((entry) => entry.file.name)).toEqual(["portrait.png"]);
  expect(batch.validationErrors()).toEqual([
    expect.stringContaining("notes.txt:"),
    expect.stringContaining("empty.png:"),
    expect.stringContaining("large.png:"),
  ]);
});

test("retries failures with the same request ID and does not upload successful files again", async () => {
  const upload = vi
    .fn<typeof uploadFile>()
    .mockImplementationOnce(async (options) => uploaded(options))
    .mockResolvedValueOnce(err({ kind: "SERVER_REQUEST_FAILED", cause: new Error("offline") }))
    .mockImplementation(async (options) => uploaded(options));
  const { batch, onUploaded } = setup(upload);
  batch.add([image("first.png"), image("second.png")]);
  const failedId = batch.entries()[1].requestId;
  await batch.start();
  expect(batch.entries().map((entry) => entry.status)).toEqual(["uploaded", "failed"]);
  await batch.start();
  expect(upload).toHaveBeenCalledTimes(3);
  expect(upload.mock.calls[2][0].requestId).toBe(failedId);
  expect(onUploaded).toHaveBeenCalledTimes(2);
  expect(batch.entries().every((entry) => entry.status === "uploaded")).toBe(true);
});

test("limits concurrent uploads and ignores duplicate starts or edits while uploading", async () => {
  const responses = Array.from({ length: 4 }, () =>
    Promise.withResolvers<Awaited<ReturnType<typeof uploadFile>>>(),
  );
  const upload = vi.fn<typeof uploadFile>();
  for (const response of responses) upload.mockReturnValueOnce(response.promise);
  const { batch } = setup(upload);
  batch.add(Array.from({ length: 4 }, (_, index) => image(`${index}.png`)));
  const uploading = batch.start();
  await batch.start();
  batch.add([image("extra.png")]);
  batch.remove(batch.entries()[0].requestId);
  batch.clear();
  expect(batch.entries()).toHaveLength(4);
  expect(upload).toHaveBeenCalledTimes(3);
  responses[0].resolve(uploaded(upload.mock.calls[0][0]));
  await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(4));
  for (let index = 1; index < 4; index++)
    responses[index].resolve(uploaded(upload.mock.calls[index][0]));
  await uploading;
  expect(batch.isUploading()).toBe(false);
  expect(batch.entries().every((entry) => entry.status === "uploaded")).toBe(true);
});

test("stopping a batch aborts active uploads and leaves queued images available to resume", async () => {
  const upload = vi.fn<typeof uploadFile>(
    (options) =>
      new Promise((resolve) => {
        options.signal.addEventListener("abort", () => resolve(err({ kind: "CANCELLED" })), {
          once: true,
        });
      }),
  );
  const { batch } = setup(upload);
  batch.add(Array.from({ length: 4 }, (_, index) => image(`${index}.png`)));
  const uploading = batch.start();
  batch.cancel();
  await uploading;
  expect(upload).toHaveBeenCalledTimes(3);
  expect(batch.entries().map((entry) => entry.status)).toEqual([
    "failed",
    "failed",
    "failed",
    "selected",
  ]);
  expect(batch.isUploading()).toBe(false);
  upload.mockImplementation(async (options) => uploaded(options));
  await batch.start();
  expect(batch.entries().every((entry) => entry.status === "uploaded")).toBe(true);
});
