import { Dialog } from "@kobalte/core/dialog";
import { CloudUpload } from "lucide-solid";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";

import { Button } from "@/components/ui/Button";
import type { ReadyFile } from "@/modules/files/files";
import { SUPPORTED_IMAGE_MEDIA_TYPES } from "@/modules/files/images";
import { formatBytes } from "@/modules/files/imageUpload";
import { createImageUploadBatch } from "@/modules/files/imageUploadBatch";

import { MAX_BACKGROUND_REMOVAL_INPUT_SIZE_BYTES } from "../policy";

export function BackgroundRemovalUploader(props: {
  organizationSlug: string;
  onUploaded: (file: ReadyFile) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [dragging, setDragging] = createSignal(false);
  const batch = createImageUploadBatch({
    organizationSlug: () => props.organizationSlug,
    maxSizeBytes: MAX_BACKGROUND_REMOVAL_INPUT_SIZE_BYTES,
    onUploaded: props.onUploaded,
  });
  const pendingCount = createMemo(
    () => batch.entries().filter((entry) => entry.status !== "uploaded").length,
  );
  let input!: HTMLInputElement;
  let chooseButton!: HTMLButtonElement;

  function chooseFiles() {
    input.value = "";
    input.click();
  }

  function addFiles(files: ReadonlyArray<File>) {
    if (!files.length || batch.isUploading()) return;
    batch.add(files);
    setOpen(true);
  }

  function close() {
    if (batch.isUploading()) return;
    setOpen(false);
    batch.clear();
  }

  async function upload() {
    await batch.start();
    if (batch.entries().length > 0 && pendingCount() === 0) close();
  }

  onMount(() => {
    const controller = new AbortController();
    document.addEventListener(
      "paste",
      (event) => {
        if (event.defaultPrevented || batch.isUploading()) return;
        const images = Array.from(event.clipboardData?.files ?? []).filter((file) =>
          file.type.startsWith("image/"),
        );
        if (!images.length) return;
        event.preventDefault();
        addFiles(images);
      },
      { signal: controller.signal },
    );
    let dragDepth = 0;
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const reset = () => {
      dragDepth = 0;
      setDragging(false);
    };
    document.addEventListener(
      "dragenter",
      (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepth += 1;
        setDragging(true);
      },
      { signal: controller.signal },
    );
    document.addEventListener(
      "dragover",
      (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        if (event.dataTransfer)
          event.dataTransfer.dropEffect = batch.isUploading() ? "none" : "copy";
      },
      { signal: controller.signal },
    );
    document.addEventListener(
      "dragleave",
      () => {
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) reset();
      },
      { signal: controller.signal },
    );
    document.addEventListener(
      "drop",
      (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        reset();
        addFiles(Array.from(event.dataTransfer?.files ?? []));
      },
      { signal: controller.signal },
    );
    document.addEventListener("dragend", reset, { signal: controller.signal });
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") reset();
      },
      { signal: controller.signal },
    );
    window.addEventListener("blur", reset, { signal: controller.signal });
    onCleanup(() => controller.abort());
  });
  onCleanup(batch.cancel);

  return (
    <>
      <div class="bg-muted/20 flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center">
        <CloudUpload class="text-muted-foreground size-12" aria-hidden="true" />
        <p class="mt-4 text-sm font-medium">drop or paste images anywhere</p>
        <p class="text-muted-foreground mt-1 text-xs">jpeg, png, webp, avif · up to 50 MiB each</p>
        <Button
          ref={(element) => {
            chooseButton = element;
          }}
          class="mt-4 h-10 min-w-36"
          disabled={batch.isUploading()}
          onClick={chooseFiles}
        >
          choose images
        </Button>
        <input
          ref={(element) => {
            input = element;
          }}
          type="file"
          class="hidden"
          multiple
          accept={SUPPORTED_IMAGE_MEDIA_TYPES.join(",")}
          aria-label="Choose images to upload"
          onChange={(event) => addFiles(Array.from(event.currentTarget.files ?? []))}
        />
      </div>

      <Show when={dragging()}>
        <div
          class="bg-background/90 pointer-events-none fixed inset-0 z-[60] flex items-center justify-center p-6 backdrop-blur-sm"
          role="status"
        >
          <div class="border-primary flex h-full w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed text-center">
            <span class="text-4xl" aria-hidden="true">
              ↓
            </span>
            <p class="text-xl font-medium">
              {batch.isUploading() ? "finish the current upload first" : "drop your images here"}
            </p>
            <p class="text-muted-foreground text-sm">
              {batch.isUploading()
                ? "You can add more images when it completes."
                : "Preview your images before uploading."}
            </p>
          </div>
        </div>
      </Show>

      <Dialog
        open={open()}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
          <div class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-8">
            <Dialog.Content
              class="bg-background pointer-events-auto flex h-full w-full min-w-0 flex-col overflow-hidden rounded-2xl border shadow-xl"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                chooseButton.focus();
              }}
            >
              <div class="flex shrink-0 items-start justify-between gap-4 border-b p-4 sm:p-5">
                <div>
                  <Dialog.Title class="font-medium">
                    confirm upload ({batch.entries().length}{" "}
                    {batch.entries().length === 1 ? "image" : "images"})
                  </Dialog.Title>
                  <Dialog.Description class="text-muted-foreground mt-1 text-xs">
                    Background removal starts as each image finishes uploading.
                  </Dialog.Description>
                </div>
                <Dialog.CloseButton
                  class="hover:bg-muted focus-visible:ring-ring flex size-8 shrink-0 items-center justify-center rounded-lg border text-lg focus-visible:ring-2 disabled:opacity-40"
                  disabled={batch.isUploading()}
                  aria-label="Close upload dialog"
                >
                  ×
                </Dialog.CloseButton>
              </div>
              <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
                <Show when={batch.validationErrors().length > 0}>
                  <ul class="text-destructive mb-4 space-y-1 text-xs" role="alert">
                    <For each={batch.validationErrors()}>{(error) => <li>{error}</li>}</For>
                  </ul>
                </Show>
                <Show
                  when={batch.entries().length > 0}
                  fallback={
                    <p class="text-muted-foreground py-12 text-center text-sm">
                      Choose JPEG, PNG, WebP, or AVIF images to get started.
                    </p>
                  }
                >
                  <ul class="flex flex-wrap items-start gap-4">
                    <For each={batch.entries().map((entry) => entry.requestId)}>
                      {(requestId) => {
                        const entry = () =>
                          batch.entries().find((item) => item.requestId === requestId)!;
                        return (
                          <li class="bg-card w-80 max-w-full min-w-0 overflow-hidden rounded-xl border">
                            <div class="bg-muted/60 relative aspect-[4/3] overflow-hidden border-b">
                              <UploadPreview file={entry().file} />
                              <Show when={!batch.isUploading() && entry().status !== "uploaded"}>
                                <Button
                                  class="bg-background absolute top-2 right-2 shadow-sm"
                                  size="icon"
                                  variant="outline"
                                  aria-label={`Remove ${entry().file.name} from upload`}
                                  onClick={() => batch.remove(requestId)}
                                >
                                  ×
                                </Button>
                              </Show>
                            </div>
                            <div class="flex flex-col gap-2 p-3 text-xs">
                              <p class="truncate" title={entry().file.name}>
                                {entry().file.name}
                              </p>
                              <p class="text-muted-foreground" role="status">
                                {entry().status === "uploaded"
                                  ? "uploaded"
                                  : entry().status === "finalizing"
                                    ? "finishing upload…"
                                    : entry().status === "uploading"
                                      ? `uploading ${entry().percent}%`
                                      : formatBytes(entry().file.size)}
                              </p>
                              <Show
                                when={
                                  entry().status === "uploading" || entry().status === "finalizing"
                                }
                              >
                                <progress
                                  class="accent-primary h-1 w-full"
                                  max={100}
                                  value={entry().percent}
                                  aria-label={`Upload progress for ${entry().file.name}`}
                                />
                              </Show>
                              <Show when={entry().error}>
                                {(error) => (
                                  <p class="text-destructive" role="alert">
                                    {error()}
                                  </p>
                                )}
                              </Show>
                            </div>
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                </Show>
              </div>
              <div class="bg-muted/20 flex shrink-0 flex-col gap-3 border-t p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <Button variant="ghost" disabled={batch.isUploading()} onClick={chooseFiles}>
                  + add more
                </Button>
                <div class="flex gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
                  <Show
                    when={batch.isUploading()}
                    fallback={
                      <>
                        <Button variant="outline" onClick={close}>
                          cancel
                        </Button>
                        <Button disabled={pendingCount() === 0} onClick={() => void upload()}>
                          upload {pendingCount()} {pendingCount() === 1 ? "image" : "images"}
                        </Button>
                      </>
                    }
                  >
                    <Button variant="outline" onClick={batch.cancel}>
                      stop uploads
                    </Button>
                  </Show>
                </div>
              </div>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog>
    </>
  );
}

function UploadPreview(props: { file: File }) {
  const [url, setUrl] = createSignal<string>();
  onMount(() => {
    if (props.file.size > 25_000_000) return;
    const preview = URL.createObjectURL(props.file);
    setUrl(preview);
    onCleanup(() => URL.revokeObjectURL(preview));
  });
  return (
    <Show
      when={url()}
      fallback={
        <p class="text-muted-foreground flex h-full items-center justify-center p-3 text-center text-xs">
          preview unavailable for images over 25 MB
        </p>
      }
    >
      <img
        class="absolute inset-0 h-full w-full object-contain p-2"
        src={url()}
        alt={`Preview of ${props.file.name}`}
        decoding="async"
      />
    </Show>
  );
}
