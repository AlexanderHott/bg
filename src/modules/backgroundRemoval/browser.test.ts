import { expect, test, vi } from "vite-plus/test";

import { err, ok } from "@/lib/result";

import type { BackgroundRemovalSummary } from "./backgroundRemovals";
import { createBackgroundRemovalHistory } from "./browser";

const removal: BackgroundRemovalSummary = {
  id: "01994fd4-c3ef-7f5a-a0cb-768f7f6d3be6",
  requestId: "01994fd5-7849-7de8-8c44-045dd8e74ac9",
  modelId: "birefnet-general-lite-onnx-v1",
  status: "queued",
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  input: {
    id: "01994fd4-d61a-7d1d-b36d-6832661f94ea",
    requestId: "01994fd5-7849-7de8-8c44-045dd8e74ac9",
    organizationId: "01994fd4-f61a-7d1d-b36d-6832661f94ea",
    name: "input.png",
    mediaType: "image/png",
    sizeBytes: 100,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    url: "https://example.test/input.png",
  },
};

function setup(initialItems: Array<BackgroundRemovalSummary> = []) {
  const createRemoval = vi.fn(async () => ok(removal));
  const deleteRemoval = vi.fn(async () => ok(undefined));
  const onError = vi.fn();
  const history = createBackgroundRemovalHistory({
    initialItems: () => initialItems,
    organizationSlug: () => "test",
    createRemoval,
    deleteRemoval,
    onError,
  });
  return { history, createRemoval, deleteRemoval, onError };
}

test("shows a queued entry immediately and preserves its place after confirmation", async () => {
  const older = { ...removal, id: "older-id", requestId: "older-request", createdAt: new Date() };
  const { history, createRemoval } = setup([older]);
  const response = Promise.withResolvers<ReturnType<typeof ok<BackgroundRemovalSummary>>>();
  createRemoval.mockReturnValueOnce(response.promise);
  const creating = history.start(removal.input);
  expect(history.items().map((item) => item.requestId)).toEqual([
    removal.requestId,
    "older-request",
  ]);
  expect(history.items()[0]).toMatchObject({ status: "queued", creation: "pending" });
  response.resolve(ok(removal));
  await creating;
  expect(history.items().map((item) => item.requestId)).toEqual([
    removal.requestId,
    "older-request",
  ]);
  expect(history.items()[0]).toEqual(removal);
});

test("retries an unconfirmed creation with the same request ID", async () => {
  const { history, createRemoval } = setup();
  createRemoval.mockRejectedValueOnce(new Error("response lost"));
  await history.start(removal.input);
  expect(history.items()[0]).toMatchObject({ creation: "failed" });
  await history.start(removal.input);
  expect(history.items()).toEqual([removal]);
  expect(createRemoval.mock.calls[0]).toEqual(createRemoval.mock.calls[1]);
});

test("restores the entry and reports a rejected deletion", async () => {
  const { history, deleteRemoval, onError } = setup([removal]);
  const response = Promise.withResolvers<ReturnType<typeof ok<undefined>>>();
  deleteRemoval.mockReturnValueOnce(response.promise);
  const deleting = history.remove(removal);
  expect(history.items()).toEqual([]);
  response.reject(new Error("offline"));
  await deleting;
  expect(history.items()).toEqual([removal]);
  expect(onError).toHaveBeenLastCalledWith("Could not delete this request. Try again.");
});

test("treats an already deleted request as a successful deletion", async () => {
  const history = createBackgroundRemovalHistory({
    initialItems: () => [removal],
    organizationSlug: () => "test",
    createRemoval: async () => ok(removal),
    deleteRemoval: async () => err({ kind: "BACKGROUND_REMOVAL_NOT_FOUND" }),
    onError: vi.fn(),
  });
  await history.remove(removal);
  expect(history.items()).toEqual([]);
});
