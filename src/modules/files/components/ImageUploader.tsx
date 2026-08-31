import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { uploadFile, type UploadFileError, type UploadProgress } from "@/modules/files/browser";
import type { ReadyFile } from "@/modules/files/files";

const MAX_IMAGE_SIZE_BYTES = 2_000_000_000;
const MAX_PREVIEW_SIZE_BYTES = 25_000_000;
const SUPPORTED_IMAGE_TYPES = new Set(["image/avif", "image/jpeg", "image/png", "image/webp"]);

type UploadStatus = "selected" | "uploading" | "finalizing" | "cancelling" | "uploaded";
type DragState = "accepted" | "rejected";

export function ImageUploader(props: { organizationSlug: string }) {
  const [selectedFile, setSelectedFile] = createSignal<File>();
  const [previewUrl, setPreviewUrl] = createSignal<string>();
  const [requestId, setRequestId] = createSignal<string>();
  const [progress, setProgress] = createSignal<UploadProgress>();
  const [status, setStatus] = createSignal<UploadStatus>("selected");
  const [errorMessage, setErrorMessage] = createSignal<string>();
  const [statusMessage, setStatusMessage] = createSignal<string>();
  const [uploadedFile, setUploadedFile] = createSignal<ReadyFile>();
  const [dragState, setDragState] = createSignal<DragState>();
  let uploadController: AbortController | undefined;
  let previewUrlToRevoke: string | undefined;
  let input!: HTMLInputElement;
  let dragDepth = 0;

  const isPending = createMemo(() => {
    const value = status();
    return value === "uploading" || value === "finalizing" || value === "cancelling";
  });
  const progressPercent = createMemo(() => {
    const value = progress();
    if (!value || value.totalBytes === 0) return 0;
    return Math.min(100, Math.round((value.uploadedBytes / value.totalBytes) * 100));
  });

  onMount(() => {
    const controller = new AbortController();
    const preventFileDrop = (event: DragEvent) => {
      if (hasDraggedFiles(event)) event.preventDefault();
    };

    document.addEventListener("dragover", preventFileDrop, { signal: controller.signal });
    document.addEventListener("drop", preventFileDrop, { signal: controller.signal });
    onCleanup(() => controller.abort());
  });

  onCleanup(() => {
    uploadController?.abort();
    if (previewUrlToRevoke) URL.revokeObjectURL(previewUrlToRevoke);
  });

  function clearSelection(message: string) {
    if (previewUrlToRevoke) URL.revokeObjectURL(previewUrlToRevoke);
    previewUrlToRevoke = undefined;
    setSelectedFile(undefined);
    setPreviewUrl(undefined);
    setRequestId(undefined);
    setProgress(undefined);
    setStatus("selected");
    setErrorMessage(message);
    setStatusMessage(undefined);
    setUploadedFile(undefined);
  }

  function selectFile(file: File) {
    const validationError = validateImage(file);
    if (validationError) {
      clearSelection(validationError);
      return;
    }

    if (previewUrlToRevoke) URL.revokeObjectURL(previewUrlToRevoke);
    previewUrlToRevoke =
      file.size <= MAX_PREVIEW_SIZE_BYTES ? URL.createObjectURL(file) : undefined;
    setSelectedFile(file);
    setPreviewUrl(previewUrlToRevoke);
    setRequestId(crypto.randomUUID());
    setProgress(undefined);
    setStatus("selected");
    setErrorMessage(undefined);
    setStatusMessage(undefined);
    setUploadedFile(undefined);
  }

  function selectFiles(files: FileList | null) {
    if (!files?.length) return;
    if (files.length !== 1) {
      clearSelection("Choose one image at a time.");
      return;
    }

    selectFile(files[0]);
  }

  function openFileDialog() {
    if (isPending()) return;
    input.value = "";
    input.click();
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openFileDialog();
  }

  function handleDragEnter(event: DragEvent) {
    if (isPending() || !hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    setDragState(isDraggedImageAccepted(event) ? "accepted" : "rejected");
  }

  function handleDragOver(event: DragEvent) {
    if (isPending() || !hasDraggedFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent) {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setDragState(undefined);
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragDepth = 0;
    setDragState(undefined);
    if (isPending()) return;
    selectFiles(event.dataTransfer?.files ?? null);
  }

  async function startUpload() {
    const file = selectedFile();
    const currentRequestId = requestId();
    if (!file || !currentRequestId || isPending()) return;

    const controller = new AbortController();
    uploadController = controller;
    setErrorMessage(undefined);
    setStatusMessage(undefined);
    setUploadedFile(undefined);
    setProgress({ phase: "uploading", uploadedBytes: 0, totalBytes: file.size });
    setStatus("uploading");

    const result = await uploadFile({
      organizationSlug: props.organizationSlug,
      requestId: currentRequestId,
      file,
      signal: controller.signal,
      onProgress(value) {
        setProgress(value);
        setStatus(value.phase);
      },
    });

    if (uploadController !== controller) return;
    uploadController = undefined;

    if (result.ok) {
      setProgress({ phase: "finalizing", uploadedBytes: file.size, totalBytes: file.size });
      setUploadedFile(result.value);
      setStatus("uploaded");
      return;
    }

    setProgress(undefined);
    setStatus("selected");
    if (result.error.kind === "CANCELLED") {
      setStatusMessage("Upload cancelled. You can resume it when you are ready.");
    } else {
      setErrorMessage(uploadErrorMessage(result.error));
    }
  }

  function cancelUpload() {
    if (!uploadController) return;
    setStatus("cancelling");
    uploadController.abort();
  }

  return (
    <div class="flex flex-col gap-4">
      <div
        class={cn(
          "group relative flex min-h-80 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed p-6 text-center transition-colors outline-none sm:p-10",
          dragState() === "accepted"
            ? "border-foreground bg-muted"
            : dragState() === "rejected"
              ? "border-destructive bg-destructive/5"
              : "border-border hover:border-muted-foreground hover:bg-muted/40",
          isPending() ? "pointer-events-none cursor-wait" : undefined,
        )}
        role="button"
        tabIndex={isPending() ? -1 : 0}
        aria-disabled={isPending()}
        aria-label={selectedFile() ? "Choose a different image" : "Choose an image"}
        onClick={openFileDialog}
        onKeyDown={handleKeyDown}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={(element) => {
            input = element;
          }}
          class="sr-only"
          type="file"
          accept="image/avif,image/jpeg,image/png,image/webp"
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => selectFiles(event.currentTarget.files)}
        />

        <Show
          when={selectedFile()}
          fallback={
            <div class="flex max-w-md flex-col items-center">
              <UploadIcon />
              <p class="mt-5 font-medium">
                {dragState() === "accepted"
                  ? "drop the image here"
                  : dragState() === "rejected"
                    ? "choose one supported image"
                    : "drop an image here"}
              </p>
              <p class="text-muted-foreground mt-2 text-sm">
                or click to choose one. jpeg, png, webp, or avif.
              </p>
              <p class="text-muted-foreground mt-4 text-xs">one image, up to 2 GB</p>
            </div>
          }
        >
          {(file) => (
            <div class="flex w-full max-w-2xl flex-col items-center gap-5">
              <div class="bg-muted/60 flex h-48 w-full items-center justify-center overflow-hidden rounded-lg border sm:h-56">
                <Show
                  when={previewUrl()}
                  fallback={
                    <p class="text-muted-foreground max-w-xs text-sm">
                      Preview skipped because this image is larger than 25 MB.
                    </p>
                  }
                >
                  {(url) => (
                    <img
                      class="h-full w-full object-contain"
                      src={url()}
                      alt={`Preview of ${file().name}`}
                    />
                  )}
                </Show>
              </div>
              <div class="max-w-full">
                <p class="truncate font-medium">{file().name}</p>
                <p class="text-muted-foreground mt-1 text-xs">
                  {formatBytes(file().size)} / click or drop to replace
                </p>
              </div>
            </div>
          )}
        </Show>
      </div>

      <Show when={progress()}>
        {(value) => (
          <div class="flex flex-col gap-2">
            <div class="flex justify-between gap-4 text-xs">
              <span>{statusLabel(status())}</span>
              <span>{progressPercent()}%</span>
            </div>
            <div
              class="bg-muted h-2 overflow-hidden rounded-full"
              role="progressbar"
              aria-label="Image upload progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent()}
            >
              <div
                class="bg-primary h-full rounded-full transition-[width] duration-200"
                style={{ width: `${progressPercent()}%` }}
              />
            </div>
            <p class="text-muted-foreground text-xs">
              {formatBytes(value().uploadedBytes)} of {formatBytes(value().totalBytes)}
            </p>
          </div>
        )}
      </Show>
      <p class="sr-only" role="status" aria-live="polite">
        {isPending() ? statusLabel(status()) : statusMessage()}
      </p>

      <Show when={errorMessage()}>
        {(message) => (
          <p class="text-destructive text-sm" role="alert">
            {message()}
          </p>
        )}
      </Show>

      <Show when={statusMessage()}>
        {(message) => <p class="text-muted-foreground text-sm">{message()}</p>}
      </Show>

      <Show when={uploadedFile()}>
        {(file) => (
          <div class="bg-muted/50 rounded-lg border p-4" role="status">
            <p class="font-medium">upload complete</p>
            <dl class="text-muted-foreground mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
              <dt>file id</dt>
              <dd class="text-foreground break-all">{file().id}</dd>
              <dt>stored size</dt>
              <dd class="text-foreground">{formatBytes(file().sizeBytes)}</dd>
            </dl>
          </div>
        )}
      </Show>

      <div class="flex flex-wrap gap-2">
        <Show when={selectedFile()}>
          <Button
            type="button"
            variant={isPending() || status() === "uploaded" ? "outline" : "default"}
            onClick={() => {
              if (status() === "uploaded") openFileDialog();
              else if (isPending()) cancelUpload();
              else void startUpload();
            }}
          >
            {status() === "uploaded"
              ? "[ upload another ]"
              : status() === "cancelling"
                ? "cancelling..."
                : isPending()
                  ? "[ cancel upload ]"
                  : errorMessage() || statusMessage()
                    ? "[ retry upload ]"
                    : "[ upload image ]"}
          </Button>
        </Show>
      </div>
    </div>
  );
}

function validateImage(file: File) {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) return "Choose a jpeg, png, webp, or avif image.";
  if (file.size === 0) return "Choose a non-empty image.";
  if (file.size > MAX_IMAGE_SIZE_BYTES) return "Choose an image smaller than 2 GB.";
  return undefined;
}

function hasDraggedFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).some(
    (type) => type === "Files" || type === "application/x-moz-file",
  );
}

function isDraggedImageAccepted(event: DragEvent) {
  const files = Array.from(event.dataTransfer?.items ?? []).filter((item) => item.kind === "file");
  if (files.length !== 1) return false;
  return files[0].type === "application/x-moz-file" || SUPPORTED_IMAGE_TYPES.has(files[0].type);
}

function statusLabel(status: UploadStatus) {
  switch (status) {
    case "uploading":
      return "uploading image";
    case "finalizing":
      return "finalizing upload";
    case "cancelling":
      return "cancelling upload";
    case "uploaded":
      return "upload complete";
    case "selected":
      return "ready to upload";
  }
}

function uploadErrorMessage(error: UploadFileError) {
  switch (error.kind) {
    case "CANCELLED":
      return "Upload cancelled.";
    case "SERVER_REQUEST_FAILED":
      return "The upload service could not be reached. Try again.";
    case "PART_UPLOAD_FAILED":
      if (error.reason === "MISSING_ETAG") {
        return "The storage server did not return an upload receipt. Check its CORS settings.";
      }
      return `Part ${error.partNumber} could not be uploaded. Try again.`;
    case "RETRY_LIMIT_REACHED":
      return "The upload could not be resumed. Try again.";
    case "FILE_ERROR":
      switch (error.error.kind) {
        case "INVALID_FILE":
          return `The image has an invalid ${error.error.field}.`;
        case "REQUEST_CONFLICT":
          return "This upload request belongs to a different image. Choose the image again.";
        case "SIZE_MISMATCH":
          return "The stored image size did not match the selected file. Try again.";
        case "FILE_NOT_FOUND":
        case "FILE_NOT_READY":
        case "UPLOAD_NOT_FOUND":
        case "INVALID_UPLOAD_STATE":
        case "INVALID_UPLOAD_PARTS":
          return "The upload could not be finalized. Try again.";
      }
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1_000) return `${bytes} B`;

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1_000;
  let unitIndex = 0;
  while (value >= 1_000 && unitIndex < units.length - 1) {
    value /= 1_000;
    unitIndex += 1;
  }

  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`;
}

function UploadIcon() {
  return (
    <svg
      class="text-muted-foreground size-12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      aria-hidden="true"
    >
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
      <path d="M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3" />
    </svg>
  );
}
