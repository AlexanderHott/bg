import { createSignal } from "solid-js";

import { uploadFile } from "./browser";
import type { ReadyFile } from "./files";
import { uploadErrorMessage, validateImage } from "./imageUpload";

type UploadEntry = {
  requestId: string;
  file: File;
  status: "selected" | "uploading" | "finalizing" | "uploaded" | "failed";
  percent: number;
  error?: string;
};

// Retain request IDs across retries so a lost response cannot duplicate an upload.
export function createImageUploadBatch(options: {
  organizationSlug: () => string;
  maxSizeBytes: number;
  onUploaded: (file: ReadyFile) => void;
  upload?: typeof uploadFile;
}) {
  const [entries, setEntries] = createSignal<Array<UploadEntry>>([]);
  const [isUploading, setIsUploading] = createSignal(false);
  const [validationErrors, setValidationErrors] = createSignal<Array<string>>([]);
  let controller: AbortController | undefined;

  function add(files: ReadonlyArray<File>) {
    if (isUploading()) return;
    const errors: Array<string> = [];
    const additions: Array<UploadEntry> = [];
    for (const file of files) {
      const error = validateImage(file, options.maxSizeBytes);
      if (error) errors.push(`${file.name}: ${error}`);
      else additions.push({ requestId: crypto.randomUUID(), file, status: "selected", percent: 0 });
    }
    setValidationErrors(errors);
    setEntries((current) => [...current, ...additions]);
  }

  function update(requestId: string, patch: Partial<UploadEntry>) {
    setEntries((current) =>
      current.map((entry) => (entry.requestId === requestId ? { ...entry, ...patch } : entry)),
    );
  }

  async function start() {
    if (isUploading()) return;
    const pending = entries().filter((entry) => entry.status !== "uploaded");
    if (!pending.length) return;
    const activeController = new AbortController();
    controller = activeController;
    const organizationSlug = options.organizationSlug();
    setIsUploading(true);
    let nextIndex = 0;

    async function worker() {
      while (!activeController.signal.aborted) {
        const entry = pending[nextIndex++];
        if (!entry) return;
        update(entry.requestId, { status: "uploading", percent: 0, error: undefined });
        try {
          const result = await (options.upload ?? uploadFile)({
            organizationSlug,
            requestId: entry.requestId,
            file: entry.file,
            signal: activeController.signal,
            onProgress: (progress) =>
              update(entry.requestId, {
                status: progress.phase,
                percent: Math.min(
                  100,
                  Math.round((progress.uploadedBytes / progress.totalBytes) * 100),
                ),
              }),
          });
          if (result.ok) {
            update(entry.requestId, { status: "uploaded", percent: 100 });
            options.onUploaded(result.value);
          } else {
            update(entry.requestId, { status: "failed", error: uploadErrorMessage(result.error) });
          }
        } catch {
          update(entry.requestId, {
            status: "failed",
            error: "Could not upload this image. Try again.",
          });
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
    } finally {
      controller = undefined;
      setIsUploading(false);
    }
  }

  function remove(requestId: string) {
    if (!isUploading())
      setEntries((current) => current.filter((entry) => entry.requestId !== requestId));
  }

  function clear() {
    if (isUploading()) return;
    setEntries([]);
    setValidationErrors([]);
  }

  return {
    entries,
    isUploading,
    validationErrors,
    add,
    start,
    remove,
    clear,
    cancel: () => controller?.abort(),
  };
}
