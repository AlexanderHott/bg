import { useServerFn } from "@tanstack/solid-start";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";

import { Button } from "@/components/ui/Button";

import { formatLabel, type DownloadSettings } from "../policy";
import { getMediaItemFn, inspectMediaItemFn, selectMediaItemFn } from "../serverFunctions";

export function ItemFormats(props: {
  organizationSlug: string;
  batchId: string;
  itemId: string;
  settings: DownloadSettings;
  editable: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  busy: boolean;
}) {
  const getItem = useServerFn(getMediaItemFn);
  const inspect = useServerFn(inspectMediaItemFn);
  const save = useServerFn(selectMediaItemFn);
  const [data, setData] = createSignal<Awaited<ReturnType<typeof getMediaItemFn>>>();
  const [videoId, setVideoId] = createSignal("");
  const [audioId, setAudioId] = createSignal("");
  const [error, setError] = createSignal<string>();
  const [loading, setLoading] = createSignal(true);
  let disposed = false;
  let polling = false;
  const input = () => ({
    organizationSlug: props.organizationSlug,
    batchId: props.batchId,
    itemId: props.itemId,
  });
  async function load(initial = false) {
    if (polling || disposed) return;
    polling = true;
    try {
      const result = await getItem({ data: input() });
      if (disposed) return;
      setData(result);
      if (initial) {
        setVideoId(result.item.selection?.videoId ?? "");
        setAudioId(result.item.selection?.audioId ?? "");
      }
      setError(undefined);
    } catch {
      if (!disposed) setError("Could not load formats. Try refreshing.");
    } finally {
      polling = false;
      if (!disposed) setLoading(false);
    }
  }
  onMount(() => {
    void (async () => {
      try {
        await inspect({ data: { ...input(), refresh: false } });
      } catch {
        if (!disposed) setError("Could not request format inspection.");
      }
      await load(true);
    })();
    const timer = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        ["queued", "running"].includes(data()?.inspection?.state ?? "")
      )
        void load();
    }, 2_000);
    onCleanup(() => {
      disposed = true;
      clearInterval(timer);
    });
  });
  return (
    <div class="mt-4 flex flex-col gap-4 border-t pt-4">
      <Show when={error()}>
        {(message) => (
          <p role="alert" class="text-destructive text-sm">
            {message()}
          </p>
        )}
      </Show>
      <Show when={loading() || ["queued", "running"].includes(data()?.inspection?.state ?? "")}>
        <p role="status" class="text-muted-foreground text-sm">
          Inspecting available formats…
        </p>
      </Show>
      <Show when={data()?.inspection?.error}>
        {(message) => <p class="text-destructive text-sm">{message()}</p>}
      </Show>
      <Show when={data()?.item.metadata}>
        {(metadata) => (
          <>
            <div>
              <p class="font-medium">{metadata().title}</p>
              <p class="text-muted-foreground mt-1 text-sm">
                {[
                  metadata().uploader,
                  metadata().duration !== undefined
                    ? `${Math.floor(metadata().duration! / 60)}:${String(Math.floor(metadata().duration! % 60)).padStart(2, "0")}`
                    : undefined,
                  metadata().uploadDate?.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"),
                  metadata().viewCount !== undefined
                    ? `${metadata().viewCount!.toLocaleString()} views`
                    : undefined,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <Show when={metadata().description}>
                <details class="mt-2 text-sm">
                  <summary class="text-muted-foreground cursor-pointer">Description</summary>
                  <p class="mt-2 max-h-48 overflow-auto break-words whitespace-pre-wrap">
                    {metadata().description}
                  </p>
                </details>
              </Show>
            </div>
            <Show when={props.settings.mode === "video"}>
              <label class="flex flex-col gap-1 text-sm">
                Video stream
                <select
                  class="bg-background rounded-md border px-3 py-2"
                  disabled={!props.editable || props.busy}
                  value={videoId()}
                  onChange={(event) => {
                    setVideoId(event.currentTarget.value);
                    setAudioId("");
                  }}
                >
                  <option value="">Automatic · use download settings</option>
                  <For
                    each={metadata()
                      .formats.filter((format) => format.videoCodec)
                      .toReversed()}
                  >
                    {(format) => (
                      <option value={format.id}>
                        {formatLabel(format)}
                        {format.audioCodec ? " · includes audio" : " · video only"}
                      </option>
                    )}
                  </For>
                </select>
              </label>
            </Show>
            <Show
              when={
                props.settings.mode === "audio" ||
                !metadata().formats.find((format) => format.id === videoId())?.audioCodec
              }
            >
              <label class="flex flex-col gap-1 text-sm">
                Audio stream
                <select
                  class="bg-background rounded-md border px-3 py-2"
                  disabled={!props.editable || props.busy}
                  value={audioId()}
                  onChange={(event) => setAudioId(event.currentTarget.value)}
                >
                  <option value="">Best available audio</option>
                  <For
                    each={metadata()
                      .formats.filter((format) => format.audioCodec && !format.videoCodec)
                      .toReversed()}
                  >
                    {(format) => <option value={format.id}>{formatLabel(format)}</option>}
                  </For>
                </select>
              </label>
            </Show>
            <p class="text-muted-foreground text-xs">
              Video-only streams are paired with audio when available. Sizes marked ~ are estimates.
              Exact selections override the batch resolution preference.
            </p>
            <Show when={props.editable}>
              <Button
                class="self-start"
                variant="outline"
                disabled={props.busy}
                onClick={() =>
                  void props.run(async () => {
                    await save({
                      data: {
                        ...input(),
                        settings: props.settings,
                        selection:
                          videoId() || audioId()
                            ? {
                                ...(props.settings.mode === "video" && videoId()
                                  ? { videoId: videoId() }
                                  : {}),
                                ...(audioId() ? { audioId: audioId() } : {}),
                              }
                            : null,
                      },
                    });
                    await load();
                  })
                }
              >
                Save selection
              </Button>
            </Show>
          </>
        )}
      </Show>
      <Button
        class="self-start"
        variant="ghost"
        disabled={props.busy}
        onClick={() =>
          void props.run(async () => {
            await inspect({ data: { ...input(), refresh: true } });
            await load();
          })
        }
      >
        Refresh formats
      </Button>
    </div>
  );
}
