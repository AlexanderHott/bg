import { createSignal } from "solid-js";

import type { ReadyFile } from "@/modules/files/files";

import type { BackgroundRemovalError, BackgroundRemovalSummary } from "./backgroundRemovals";
import { BACKGROUND_REMOVAL_MODEL_ID } from "./policy";
import type { createBackgroundRemovalFn, deleteBackgroundRemovalFn } from "./serverFunctions";

export type BackgroundRemovalEntry = Omit<BackgroundRemovalSummary, "input"> & {
  input: ReadyFile & { url?: string };
  creation?: "pending" | "failed";
};

// Keep optimistic entries in place while authenticated server responses arrive.
export function createBackgroundRemovalHistory(options: {
  initialItems: () => Array<BackgroundRemovalSummary>;
  organizationSlug: () => string;
  createRemoval: (
    ...args: Parameters<typeof createBackgroundRemovalFn>
  ) => ReturnType<typeof createBackgroundRemovalFn>;
  deleteRemoval: (
    ...args: Parameters<typeof deleteBackgroundRemovalFn>
  ) => ReturnType<typeof deleteBackgroundRemovalFn>;
  onError: (message: string | undefined) => void;
}) {
  const [local, setLocal] = createSignal<Array<BackgroundRemovalEntry>>([]);
  const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set());
  const sortTimes = new Map<string, number>();

  function items() {
    const byRequestId = new Map<string, BackgroundRemovalEntry>(
      options.initialItems().map((item) => [item.requestId, item]),
    );
    for (const item of local()) byRequestId.set(item.requestId, item);
    return [...byRequestId.values()]
      .filter((item) => !hidden().has(item.requestId))
      .sort(
        (left, right) =>
          (sortTimes.get(right.requestId) ?? right.createdAt.getTime()) -
          (sortTimes.get(left.requestId) ?? left.createdAt.getTime()),
      );
  }

  function merge(item: BackgroundRemovalEntry) {
    setLocal((current) => [item, ...current.filter((entry) => entry.requestId !== item.requestId)]);
  }

  function hide(requestId: string) {
    setHidden((current) => new Set(current).add(requestId));
  }

  async function start(file: ReadyFile) {
    const existing = items().find((item) => item.requestId === file.requestId);
    if (existing?.creation === "pending") return;
    options.onError(undefined);
    const createdAt = existing?.createdAt ?? new Date();
    if (!sortTimes.has(file.requestId)) {
      const sortTime = items().reduce(
        (latest, item) =>
          Math.max(latest, (sortTimes.get(item.requestId) ?? item.createdAt.getTime()) + 1),
        createdAt.getTime(),
      );
      sortTimes.set(file.requestId, sortTime);
    }
    const pending: BackgroundRemovalEntry = {
      id: file.requestId,
      requestId: file.requestId,
      modelId: BACKGROUND_REMOVAL_MODEL_ID,
      status: "queued",
      input: file,
      createdAt,
      creation: "pending",
    };
    merge(pending);
    try {
      const result = await options.createRemoval({
        data: {
          organizationSlug: options.organizationSlug(),
          requestId: file.requestId,
          inputFileId: file.id,
        },
      });
      if (result.ok) {
        merge(result.value);
        return;
      }
      options.onError(backgroundRemovalErrorMessage(result.error));
      setLocal((current) => current.filter((item) => item.requestId !== file.requestId));
      return;
    } catch {
      options.onError("Could not confirm processing. Retry to check the same request.");
    }
    merge({ ...pending, status: "failed", creation: "failed" });
  }

  async function remove(item: BackgroundRemovalEntry) {
    if (item.creation) return;
    options.onError(undefined);
    hide(item.requestId);
    try {
      const result = await options.deleteRemoval({
        data: {
          organizationSlug: options.organizationSlug(),
          backgroundRemovalId: item.id,
        },
      });
      if (result.ok || result.error.kind === "BACKGROUND_REMOVAL_NOT_FOUND") return;
      options.onError(backgroundRemovalErrorMessage(result.error));
    } catch {
      options.onError("Could not delete this request. Try again.");
    }
    setHidden((current) => {
      const next = new Set(current);
      next.delete(item.requestId);
      return next;
    });
  }

  return { items, merge, hide, start, remove };
}

export function backgroundRemovalErrorMessage(error: BackgroundRemovalError) {
  switch (error.kind) {
    case "INPUT_NOT_FOUND":
    case "INPUT_NOT_READY":
      return "The uploaded image is not ready. Try uploading it again.";
    case "UNSUPPORTED_IMAGE":
      return "Choose a JPEG, PNG, WebP, or AVIF image.";
    case "IMAGE_TOO_LARGE":
      return "Choose an image no larger than 50 MiB.";
    case "REQUEST_CONFLICT":
      return "This request ID already belongs to a different image.";
    case "BACKGROUND_REMOVAL_NOT_FOUND":
      return "That background-removal request no longer exists.";
    case "RETRY_NOT_ALLOWED":
      return "This failure cannot be fixed by retrying the same image.";
    case "LEASE_LOST":
      return "The processing lease expired.";
  }
}
