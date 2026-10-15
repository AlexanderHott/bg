import { useServerFn } from "@tanstack/solid-start";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";

import { Button } from "@/components/ui/Button";

import { DEFAULT_SETTINGS, normalizeMediaUrl, type DownloadSettings as Settings } from "../policy";
import {
  cancelMediaFn,
  createMediaBatchFn,
  deleteMediaBatchFn,
  getMediaBatchFn,
  listMediaBatchesFn,
  mediaDownloadUrlFn,
  queueMediaBatchFn,
  retryMediaFn,
} from "../serverFunctions";
import { BatchSettings } from "./DownloadSettings";
import { ItemFormats } from "./ItemFormats";

type BatchPage = Awaited<ReturnType<typeof getMediaBatchFn>>;

export function DownloadQueue(props: {
  organizationSlug: string;
  initial: Awaited<ReturnType<typeof listMediaBatchesFn>>;
}) {
  const createBatch = useServerFn(createMediaBatchFn);
  const listBatches = useServerFn(listMediaBatchesFn);
  const getBatch = useServerFn(getMediaBatchFn);
  const queueBatch = useServerFn(queueMediaBatchFn);
  const cancel = useServerFn(cancelMediaFn);
  const retry = useServerFn(retryMediaFn);
  const remove = useServerFn(deleteMediaBatchFn);
  const download = useServerFn(mediaDownloadUrlFn);
  const [mode, setMode] = createSignal<"simple" | "prepare">("simple");
  const [urls, setUrls] = createSignal("");
  const [settings, setSettings] = createSignal<Settings>({ ...DEFAULT_SETTINGS });
  const [batchSettings, setBatchSettings] = createSignal<Settings>({ ...DEFAULT_SETTINGS });
  const [history, setHistory] = createSignal(props.initial.batches);
  const [nextCursor, setNextCursor] = createSignal(props.initial.nextCursor);
  const [selected, setSelected] = createSignal<string | undefined>(props.initial.batches[0]?.id);
  const [offset, setOffset] = createSignal(0);
  const [state, setState] = createStore<{ page: BatchPage | undefined }>({ page: undefined });
  const page = () => state.page;
  const setPage = (value: BatchPage | undefined) => setState("page", reconcile(value));
  const [openItem, setOpenItem] = createSignal<string>();
  const [busy, setBusy] = createSignal(false);
  const [adding, setAdding] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let request: { key: string; id: string } | undefined;
  let revision = 0;
  let polling = false;
  let disposed = false;
  let settingsBatchId: string | undefined;
  let openedBatchId: string | undefined;
  const scope = () => ({ organizationSlug: props.organizationSlug });
  const active = createMemo(() => {
    const current = page();
    return (
      current?.sources.some((source) => source.state === "queued" || source.state === "running") ||
      current?.totals.some((group) => ["queued", "running"].includes(group.state))
    );
  });

  async function refresh() {
    const batchId = selected();
    if (!batchId) return;
    const expectedRevision = revision;
    const currentOffset = offset();
    const result = await getBatch({ data: { ...scope(), batchId, offset: currentOffset } });
    if (
      disposed ||
      expectedRevision !== revision ||
      selected() !== batchId ||
      offset() !== currentOffset
    )
      return;
    setPage(result);
    if (settingsBatchId !== batchId) {
      setBatchSettings(result.batch.settings);
      settingsBatchId = batchId;
    }
    setHistory((current) =>
      current.map((batch) => (batch.id === result.batch.id ? result.batch : batch)),
    );
  }

  createEffect(() => {
    const expectedRevision = ++revision;
    setPage(undefined);
    setOpenItem(undefined);
    void refresh().catch(() => {
      if (!disposed && revision === expectedRevision) setError("Could not load this batch.");
    });
  });

  createEffect(() => {
    const current = page();
    if (
      current?.batch.state === "draft" &&
      current.total === 1 &&
      openedBatchId !== current.batch.id
    ) {
      openedBatchId = current.batch.id;
      setOpenItem(current.items[0]?.id);
    }
  });

  onMount(() => {
    const timer = setInterval(() => {
      if (polling || busy() || !active() || document.visibilityState !== "visible") return;
      polling = true;
      void refresh()
        .catch(() => setError("Connection interrupted. The queue continues on the server."))
        .finally(() => {
          polling = false;
        });
    }, 2_000);
    onCleanup(() => {
      disposed = true;
      clearInterval(timer);
    });
  });

  async function run(action?: () => Promise<void>) {
    if (busy()) return;
    setBusy(true);
    setError(undefined);
    revision++;
    try {
      await action?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request failed. Try again.");
    } finally {
      try {
        await refresh();
      } catch {
        setError("Could not refresh the batch. Try again.");
      }
      setBusy(false);
    }
  }

  async function submit(queue: boolean) {
    await run(async () => {
      const inputUrls = urls()
        .split(/\r?\n/)
        .map((url) => url.trim())
        .filter(Boolean)
        .map(normalizeMediaUrl);
      if (!inputUrls.length) throw new Error("Paste at least one media or playlist URL.");
      const chosenSettings = queue
        ? { mode: settings().mode, conversion: "original" as const }
        : settings();
      const key = JSON.stringify({ urls: inputUrls, settings: chosenSettings, queue });
      if (request?.key !== key) request = { key, id: crypto.randomUUID() };
      setAdding(true);
      try {
        const id = await createBatch({
          data: {
            ...scope(),
            requestId: request.id,
            urls: inputUrls,
            settings: chosenSettings,
            queue,
          },
        });
        const latest = await listBatches({ data: scope() });
        setHistory(latest.batches);
        setNextCursor(latest.nextCursor);
        setOffset(0);
        setSelected(id);
        setUrls("");
        request = undefined;
      } finally {
        setAdding(false);
      }
    });
  }

  return (
    <div class="flex flex-col gap-6">
      <div>
        <h1 class="text-2xl font-semibold">Download media</h1>
        <p class="text-muted-foreground mt-1 text-sm">
          Paste a link to download video, audio, or a playlist.
        </p>
      </div>
      <form
        class="flex flex-col gap-4 border-b pb-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(mode() === "simple");
        }}
      >
        <div class="flex gap-1" role="group" aria-label="Download mode">
          <For each={["simple", "prepare"] as const}>
            {(value) => (
              <Button
                type="button"
                variant={mode() === value ? "secondary" : "ghost"}
                aria-pressed={mode() === value}
                disabled={busy()}
                onClick={() => setMode(value)}
              >
                {value === "simple" ? "Simple" : "Prepare"}
              </Button>
            )}
          </For>
        </div>
        <label class="flex flex-col gap-2 text-sm">
          Media and playlist URLs
          <textarea
            class="bg-background min-h-20 rounded-md border px-3 py-2"
            placeholder="https://…\nOne URL per line"
            value={urls()}
            disabled={busy()}
            onInput={(event) => setUrls(event.currentTarget.value)}
            required
          />
        </label>
        <BatchSettings
          value={settings()}
          onChange={setSettings}
          disabled={busy()}
          simple={mode() === "simple"}
        />
        <div class="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy() || !urls().trim()}>
            {adding() ? "Adding links…" : mode() === "simple" ? "Download" : "Prepare download"}
          </Button>
          <p class="text-muted-foreground text-sm">
            {mode() === "simple"
              ? "Best available quality. Downloads continue after you leave."
              : "Review media details and choose formats before downloading."}
          </p>
        </div>
      </form>
      <Show when={error()}>
        {(message) => (
          <p class="text-destructive text-sm" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <Show when={adding()}>
        <div class="text-muted-foreground text-sm" role="status">
          Adding your links…
        </div>
      </Show>
      <Show
        when={history().length}
        fallback={
          <p class="text-muted-foreground text-sm">Your download batches will appear here.</p>
        }
      >
        <label class="flex flex-col gap-1 text-sm">
          Recent downloads
          <select
            class="bg-background rounded-md border px-3 py-2"
            disabled={busy()}
            value={selected() ?? ""}
            onChange={(event) => {
              setOffset(0);
              setSelected(event.currentTarget.value);
            }}
          >
            <For each={history()}>
              {(batch) => (
                <option value={batch.id}>
                  {batch.urls[0]}
                  {batch.urls.length > 1 ? ` + ${batch.urls.length - 1} URLs` : ""} ·{" "}
                  {new Date(batch.createdAt).toLocaleString()}
                </option>
              )}
            </For>
          </select>
        </label>
        <Show when={nextCursor()}>
          <Button
            class="self-start"
            variant="ghost"
            disabled={busy()}
            onClick={() =>
              void run(async () => {
                const result = await listBatches({ data: { ...scope(), before: nextCursor() } });
                setHistory((current) => [...current, ...result.batches]);
                setNextCursor(result.nextCursor);
              })
            }
          >
            Load older batches
          </Button>
        </Show>
      </Show>
      <Show when={page()}>
        {(current) => (
          <section class="flex flex-col gap-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="text-sm" role="status">
                {current().total} items found
                {current().sources.some(
                  (source) => source.state === "queued" || source.state === "running",
                )
                  ? " · discovering…"
                  : ""}
                {current()
                  .totals.map((group) => ` · ${group.count} ${group.state.replace("_", " ")}`)
                  .join("")}
              </p>
              <details class="relative">
                <summary class="text-muted-foreground cursor-pointer text-sm">
                  Manage downloads
                </summary>
                <div class="mt-2 flex flex-wrap gap-2">
                  <Button variant="ghost" disabled={busy()} onClick={() => void run()}>
                    Refresh
                  </Button>
                  <Show when={current().batch.state !== "cancelled"}>
                    <Button
                      variant="outline"
                      disabled={busy()}
                      onClick={() =>
                        void run(() => retry({ data: { ...scope(), batchId: current().batch.id } }))
                      }
                    >
                      Retry failed
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy()}
                      onClick={() =>
                        void run(() =>
                          cancel({ data: { ...scope(), batchId: current().batch.id } }),
                        )
                      }
                    >
                      Cancel remaining
                    </Button>
                  </Show>
                  <Button
                    variant="destructive"
                    disabled={busy()}
                    onClick={() =>
                      void run(async () => {
                        const id = current().batch.id;
                        await remove({ data: { ...scope(), batchId: id } });
                        const remaining = history().filter((batch) => batch.id !== id);
                        setHistory(remaining);
                        setPage(undefined);
                        setSelected(remaining[0]?.id);
                        setOffset(0);
                      })
                    }
                  >
                    Delete
                  </Button>
                </div>
              </details>
            </div>
            <Show when={current().batch.state === "draft"}>
              <div class="flex flex-col gap-3 border-y py-4">
                <BatchSettings
                  value={batchSettings()}
                  onChange={setBatchSettings}
                  disabled={busy()}
                />
                <Button
                  class="self-start"
                  disabled={busy()}
                  onClick={() =>
                    void run(() =>
                      queueBatch({
                        data: {
                          ...scope(),
                          batchId: current().batch.id,
                          settings: batchSettings(),
                        },
                      }),
                    )
                  }
                >
                  Download all
                </Button>
                <p class="text-muted-foreground text-xs">
                  Includes entries discovered later. Saved item selections override the batch
                  preference.
                </p>
              </div>
            </Show>
            <For each={current().sources.filter((source) => source.error)}>
              {(source) => (
                <div class="rounded-md border p-3 text-sm">
                  <p class="break-all">{source.url}</p>
                  <p class="text-destructive">{source.error}</p>
                  <Show when={current().batch.state !== "cancelled" && source.state === "failed"}>
                    <Button
                      variant="ghost"
                      disabled={busy()}
                      onClick={() =>
                        void run(() =>
                          retry({
                            data: { ...scope(), batchId: current().batch.id, sourceId: source.id },
                          }),
                        )
                      }
                    >
                      Retry discovery
                    </Button>
                  </Show>
                </div>
              )}
            </For>
            <ul class="divide-y border-y">
              <For each={current().items}>
                {(item) => (
                  <li class="py-4">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div class="min-w-0 flex-1">
                        <p class="font-medium break-words">
                          {item.position}. {item.title}
                        </p>
                        <p class="text-muted-foreground mt-1 text-sm">
                          {item.state.replace("_", " ")}
                          {item.selection ? " · custom formats" : ""}
                          {item.progress ? ` · ${item.progress.phase}` : ""}
                        </p>
                        <Show when={item.progress?.downloadedBytes !== undefined}>
                          <p class="text-muted-foreground text-xs">
                            {((item.progress?.downloadedBytes ?? 0) / 1_000_000).toFixed(1)} MB
                            {item.progress?.totalBytes
                              ? ` / ~${(item.progress.totalBytes / 1_000_000).toFixed(1)} MB`
                              : ""}
                          </p>
                        </Show>
                        <Show when={item.outputDescription}>
                          <p class="text-muted-foreground mt-1 text-xs">
                            {item.outputDescription} ·{" "}
                            {((item.outputSizeBytes ?? 0) / 1_000_000).toFixed(1)} MB
                          </p>
                        </Show>
                        <Show when={item.error}>
                          <p class="text-destructive mt-1 text-sm">{item.error}</p>
                        </Show>
                      </div>
                      <div class="flex flex-wrap gap-2">
                        <Show when={item.state === "ready"}>
                          <Button
                            disabled={busy()}
                            onClick={() =>
                              void run(async () => {
                                window.location.assign(
                                  await download({
                                    data: {
                                      ...scope(),
                                      batchId: current().batch.id,
                                      itemId: item.id,
                                    },
                                  }),
                                );
                              })
                            }
                          >
                            Download
                          </Button>
                        </Show>
                        <Show when={item.url && current().batch.state !== "cancelled"}>
                          <Button
                            variant="ghost"
                            onClick={() =>
                              setOpenItem(openItem() === item.id ? undefined : item.id)
                            }
                            aria-expanded={openItem() === item.id}
                          >
                            Details & formats
                          </Button>
                        </Show>
                        <Show
                          when={
                            ["failed", "needs_selection"].includes(item.state) &&
                            item.url &&
                            current().batch.state === "queued"
                          }
                        >
                          <Button
                            variant="outline"
                            disabled={busy()}
                            onClick={() =>
                              void run(() =>
                                retry({
                                  data: {
                                    ...scope(),
                                    batchId: current().batch.id,
                                    itemId: item.id,
                                  },
                                }),
                              )
                            }
                          >
                            Retry
                          </Button>
                        </Show>
                        <Show when={["draft", "queued", "running"].includes(item.state)}>
                          <Button
                            variant="ghost"
                            disabled={busy()}
                            onClick={() =>
                              void run(() =>
                                cancel({
                                  data: {
                                    ...scope(),
                                    batchId: current().batch.id,
                                    itemId: item.id,
                                  },
                                }),
                              )
                            }
                          >
                            Cancel
                          </Button>
                        </Show>
                      </div>
                    </div>
                    <Show when={openItem() === item.id}>
                      <ItemFormats
                        organizationSlug={props.organizationSlug}
                        batchId={current().batch.id}
                        itemId={item.id}
                        settings={
                          current().batch.state === "draft"
                            ? batchSettings()
                            : current().batch.settings
                        }
                        editable={["draft", "failed", "needs_selection"].includes(item.state)}
                        run={run}
                        busy={busy()}
                      />
                    </Show>
                  </li>
                )}
              </For>
            </ul>
            <Show when={current().total > 50}>
              <div class="flex items-center gap-3">
                <Button
                  variant="outline"
                  disabled={busy() || offset() === 0}
                  onClick={() => setOffset((value) => Math.max(0, value - 50))}
                >
                  Previous
                </Button>
                <span class="text-sm">
                  {offset() + 1}–{Math.min(offset() + 50, current().total)} of {current().total}
                </span>
                <Button
                  variant="outline"
                  disabled={busy() || offset() + 50 >= current().total}
                  onClick={() => setOffset((value) => value + 50)}
                >
                  Next
                </Button>
              </div>
            </Show>
          </section>
        )}
      </Show>
    </div>
  );
}
