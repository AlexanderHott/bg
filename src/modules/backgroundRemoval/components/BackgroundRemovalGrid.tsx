import { Switch } from "@kobalte/core/switch";
import { Download, TrashIcon } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";

import { Button } from "@/components/ui/Button";
import { CopyPngButton } from "@/modules/files/components/CopyPngButton";
import { selectImagePreview } from "@/modules/files/imagePreview";

import type { BackgroundRemovalEntry } from "../browser";
import { isRetryableFailure } from "../policy";

export function BackgroundRemovalGrid(props: {
  removals: Array<BackgroundRemovalEntry>;
  onRetry: (removal: BackgroundRemovalEntry) => Promise<void>;
  onDelete: (removal: BackgroundRemovalEntry) => Promise<void>;
}) {
  const [transparent, setTransparent] = createSignal(true);
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set());
  const [isDeleting, setIsDeleting] = createSignal(false);
  const removalsByRequestId = createMemo(
    () => new Map(props.removals.map((removal) => [removal.requestId, removal])),
  );
  const requestIds = createMemo(() => [...removalsByRequestId().keys()]);
  const selectable = createMemo(() => props.removals.filter((removal) => !removal.creation));
  const selectedItems = createMemo(() =>
    selectable().filter((removal) => selected().has(removal.requestId)),
  );
  const hasSelection = createMemo(() => selectedItems().length > 0);
  const allSelected = () =>
    selectable().length > 0 && selectedItems().length === selectable().length;

  function toggle(requestId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(requestId)) next.delete(requestId);
      else next.add(requestId);
      return next;
    });
  }

  async function deleteSelected() {
    if (isDeleting()) return;
    const items = selectedItems();
    setIsDeleting(true);
    try {
      await Promise.all(items.map(props.onDelete));
      // Failed deletions reappear in history and stay selected for another attempt.
      setSelected(new Set(selectedItems().map((removal) => removal.requestId)));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <section class="flex flex-col gap-5" aria-label="Background removal images">
      <div class="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div class="flex items-baseline gap-3">
          <h2 class="font-medium">your images</h2>
          <span class="text-muted-foreground text-xs">{props.removals.length} loaded</span>
        </div>
        <Switch
          class="group/preview flex items-center gap-3 text-xs"
          checked={transparent()}
          onChange={setTransparent}
        >
          <span classList={{ "text-muted-foreground": transparent() }}>original</span>
          <Switch.Input aria-label="Show transparent images" />
          <Switch.Control class="bg-muted data-checked:bg-primary group-focus-within/preview:ring-ring inline-flex h-6 w-10 cursor-pointer items-center rounded-full border p-0.5 group-focus-within/preview:ring-2">
            <Switch.Thumb class="bg-background size-4 rounded-full shadow-sm transition-transform data-checked:translate-x-4" />
          </Switch.Control>
          <Switch.Label
            class="cursor-pointer"
            classList={{ "text-muted-foreground": !transparent() }}
          >
            transparent
          </Switch.Label>
        </Switch>
      </div>

      <Show
        when={props.removals.length > 0 || isDeleting()}
        fallback={
          <div class="text-muted-foreground flex min-h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-center">
            <p class="text-foreground font-medium">no images yet</p>
            <p class="text-sm">Drop images anywhere on this page or choose images above.</p>
          </div>
        }
      >
        <div class="flex min-h-8 flex-wrap items-center gap-3 text-xs">
          <label class="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              class="accent-primary size-4"
              checked={allSelected()}
              ref={(input) =>
                createEffect(() => {
                  input.indeterminate = selectedItems().length > 0 && !allSelected();
                })
              }
              disabled={isDeleting() || selectable().length === 0}
              onChange={() =>
                setSelected(
                  allSelected()
                    ? new Set<string>()
                    : new Set(selectable().map((removal) => removal.requestId)),
                )
              }
            />
            select all loaded
          </label>
          <Show when={selectedItems().length > 0 || isDeleting()}>
            <span class="text-muted-foreground" role="status">
              {isDeleting() ? "deleting…" : `${selectedItems().length} selected`}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={isDeleting()}
              onClick={() => setSelected(new Set())}
            >
              clear
            </Button>
            <Button
              class="ml-auto"
              size="sm"
              variant="destructive"
              disabled={isDeleting()}
              onClick={() => void deleteSelected()}
            >
              delete selected
            </Button>
          </Show>
        </div>
        <ul class="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          <For each={requestIds()}>
            {(requestId) => (
              <BackgroundRemovalTile
                removal={removalsByRequestId().get(requestId)!}
                transparent={transparent()}
                selected={selected().has(requestId)}
                showCheckbox={hasSelection()}
                disabled={isDeleting()}
                onSelect={() => toggle(requestId)}
                onRetry={props.onRetry}
                onDelete={props.onDelete}
              />
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

function BackgroundRemovalTile(props: {
  removal: BackgroundRemovalEntry;
  transparent: boolean;
  selected: boolean;
  showCheckbox: boolean;
  disabled: boolean;
  onSelect: () => void;
  onRetry: (removal: BackgroundRemovalEntry) => Promise<void>;
  onDelete: (removal: BackgroundRemovalEntry) => Promise<void>;
}) {
  const [failedUrls, setFailedUrls] = createSignal<ReadonlySet<string>>(new Set());
  const image = createMemo<ReturnType<typeof selectImagePreview>>((previous) => {
    const next =
      props.transparent && props.removal.output ? props.removal.output : props.removal.input;
    return selectImagePreview(next, previous, failedUrls());
  });
  return (
    <li
      class="group bg-card transiton min-w-0 overflow-hidden rounded-xl border transition-all duration-150"
      classList={{ "border-primary ring-1 ring-primary": props.selected }}
    >
      <div
        class="bg-muted/30 relative aspect-4/3"
        classList={{ "transparency-grid": props.transparent && !!props.removal.output }}
      >
        <Show
          when={image().url}
          fallback={
            <div class="text-muted-foreground flex h-full items-center justify-center p-4 text-center text-xs">
              preparing image…
            </div>
          }
        >
          <img
            class="h-full w-full object-contain"
            src={image().url}
            alt={`${props.transparent && props.removal.output ? "Transparent" : "Original"} ${props.removal.input.name}`}
            loading="lazy"
            decoding="async"
            onError={(event) => {
              const url = event.currentTarget.src;
              setFailedUrls((current) => new Set([...current, url]));
            }}
          />
        </Show>
        <label
          class="bg-background/90 absolute top-2 left-2 flex cursor-pointer rounded-md p-1.5 shadow-sm transition-[opacity,scale] duration-150 ease-out group-hover:scale-100 group-hover:opacity-100 has-[:focus-visible]:scale-100 has-[:focus-visible]:opacity-100 motion-reduce:transition-none"
          classList={{ "scale-95 opacity-0": !props.showCheckbox }}
        >
          <input
            type="checkbox"
            class="accent-primary size-4"
            checked={props.selected}
            disabled={props.disabled || !!props.removal.creation}
            onChange={props.onSelect}
            aria-label={`Select ${props.removal.input.name}`}
          />
        </label>
        <Show when={!props.removal.output}>
          <div class="bg-background/90 absolute inset-x-0 bottom-0 border-t px-3 py-2 text-xs">
            {pendingMessage(props.removal)}
          </div>
        </Show>
      </div>
      <div class="flex flex-col gap-2 p-3">
        <p class="truncate text-xs font-medium" title={props.removal.input.name}>
          {props.removal.input.name}
        </p>
        <Show when={props.removal.failureCode}>
          {(code) => <p class="text-destructive text-xs">{failureMessage(code())}</p>}
        </Show>
        <div class="flex flex-wrap items-center gap-2">
          <Show when={props.removal.output}>
            {(output) => (
              <>
                <CopyPngButton url={output().url} name={props.removal.input.name} />
                <Button
                  as="a"
                  size="icon"
                  variant="outline"
                  href={output().url}
                  download={output().name}
                  aria-label={`Download transparent ${props.removal.input.name}`}
                  title="Download PNG"
                >
                  <Download class="size-4" aria-hidden="true" />
                </Button>
              </>
            )}
          </Show>
          <Show when={props.removal.status === "failed" && canRetry(props.removal)}>
            <Button size="xs" variant="outline" onClick={() => void props.onRetry(props.removal)}>
              retry
            </Button>
          </Show>
          <Button
            class="ml-auto"
            size="icon"
            variant="destructive"
            disabled={props.disabled || !!props.removal.creation}
            aria-label={`Delete ${props.removal.input.name}`}
            onClick={() => void props.onDelete(props.removal)}
          >
            <TrashIcon />
          </Button>
        </div>
      </div>
    </li>
  );
}

function pendingMessage(removal: BackgroundRemovalEntry) {
  if (removal.creation === "failed")
    return "Could not confirm processing. Retry to check this request.";
  switch (removal.status) {
    case "queued":
      return "Queued for background removal.";
    case "processing":
      return "Removing the background.";
    case "retrying":
      return "A retry is queued.";
    case "failed":
      return "Processing failed.";
    case "ready":
      return "The result is unavailable.";
  }
}

function canRetry(removal: BackgroundRemovalEntry) {
  return (
    removal.creation === "failed" ||
    (!!removal.failureCode && isRetryableFailure(removal.failureCode))
  );
}

function failureMessage(code: NonNullable<BackgroundRemovalEntry["failureCode"]>) {
  switch (code) {
    case "invalid_image":
      return "The uploaded file is not a valid image.";
    case "unsupported_image":
      return "This image format is not supported.";
    case "image_too_large":
      return "This image exceeds the processing limits.";
    case "decode_failed":
      return "The image could not be decoded.";
    case "inference_failed":
    case "storage_failed":
    case "worker_lost":
      return "Processing failed. You can try again.";
  }
}
