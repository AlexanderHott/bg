import { For, Show } from "solid-js";

import type { ReadyImage } from "../files";

export function ImageGrid(props: { images: ReadonlyArray<ReadyImage> }) {
  return (
    <Show
      when={props.images.length > 0}
      fallback={
        <div class="flex min-h-40 items-center justify-center rounded-xl border border-dashed p-6 text-center">
          <div>
            <p class="font-medium">no uploaded images yet</p>
            <p class="text-muted-foreground mt-1 text-sm">Uploaded images will appear here.</p>
          </div>
        </div>
      }
    >
      <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <For each={props.images}>
          {(file) => (
            <li class="bg-card min-w-0 overflow-hidden rounded-xl border">
              <div class="bg-muted/50 aspect-square overflow-hidden">
                <img
                  class="h-full w-full object-cover"
                  src={file.url}
                  alt={file.name}
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div class="p-3">
                <p class="truncate text-sm font-medium" title={file.name}>
                  {file.name}
                </p>
                <p class="text-muted-foreground mt-1 text-xs">{formatBytes(file.sizeBytes)}</p>
              </div>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
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
