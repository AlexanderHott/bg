import { createFileRoute } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import {
  backgroundRemovalErrorMessage,
  createBackgroundRemovalHistory,
  type BackgroundRemovalEntry,
} from "@/modules/backgroundRemoval/browser";
import {
  isRetryableFailure,
  MAX_BACKGROUND_REMOVAL_INPUT_SIZE_BYTES,
} from "@/modules/backgroundRemoval/policy";
import { startBackgroundRemovalPolling } from "@/modules/backgroundRemoval/polling";
import {
  createBackgroundRemovalFn,
  deleteBackgroundRemovalFn,
  getBackgroundRemovalFn,
  listBackgroundRemovalsFn,
  retryBackgroundRemovalFn,
} from "@/modules/backgroundRemoval/serverFunctions";
import { ImageUploader } from "@/modules/files/components/ImageUploader";

export const Route = createFileRoute("/_app/$orgSlug/remove-background")({
  component: RouteComponent,
  loader: async ({ params }) => {
    const { listBackgroundRemovalsFn } =
      await import("@/modules/backgroundRemoval/serverFunctions");
    const page = await listBackgroundRemovalsFn({
      data: { organizationSlug: params.orgSlug },
    });
    return { page };
  },
});

function RouteComponent() {
  const context = Route.useRouteContext();
  const data = Route.useLoaderData();
  const createRemoval = useServerFn(createBackgroundRemovalFn);
  const deleteRemoval = useServerFn(deleteBackgroundRemovalFn);
  const getRemoval = useServerFn(getBackgroundRemovalFn);
  const retryRemoval = useServerFn(retryBackgroundRemovalFn);
  const listRemovals = useServerFn(listBackgroundRemovalsFn);
  const [nextCursor, setNextCursor] = createSignal(data().page.nextCursor);
  const [isPageVisible, setIsPageVisible] = createSignal(true);
  const [isLoadingMore, setIsLoadingMore] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal<string>();
  const history = createBackgroundRemovalHistory({
    initialItems: () => data().page.items,
    organizationSlug: () => context().organization.slug,
    createRemoval,
    deleteRemoval,
    onError: setErrorMessage,
  });
  const inspections = new Map<string, { running: boolean; pending: boolean }>();

  const removals = createMemo(history.items);
  const hasUnsettledRemoval = createMemo(() =>
    removals().some(
      (removal) =>
        !removal.creation && ["queued", "processing", "retrying"].includes(removal.status),
    ),
  );

  onMount(() => {
    const updateVisibility = () => setIsPageVisible(document.visibilityState === "visible");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    onCleanup(() => document.removeEventListener("visibilitychange", updateVisibility));
  });

  createEffect(() => {
    if (!isPageVisible() || !hasUnsettledRemoval()) return;

    const stop = startBackgroundRemovalPolling({
      onPoll: async () => {
        const unsettled = removals().filter(
          (removal) =>
            !removal.creation && ["queued", "processing", "retrying"].includes(removal.status),
        );
        await Promise.all(unsettled.map((removal) => inspect(removal.requestId)));
      },
    });
    onCleanup(stop);
  });

  async function inspect(requestId: string) {
    const state = inspections.get(requestId) ?? { running: false, pending: false };
    state.pending = true;
    inspections.set(requestId, state);
    if (state.running) return;
    state.running = true;

    try {
      do {
        state.pending = false;
        const current = removals().find((removal) => removal.requestId === requestId);
        if (!current || current.creation) return;
        const result = await getRemoval({
          data: {
            organizationSlug: context().organization.slug,
            backgroundRemovalId: current.id,
          },
        });
        if (!result.ok) {
          history.hide(requestId);
          return;
        }
        history.merge(result.value);
      } while (state.pending);
    } finally {
      inspections.delete(requestId);
    }
  }

  async function retry(removal: BackgroundRemovalEntry) {
    if (removal.creation === "failed") return history.start(removal.input);
    setErrorMessage(undefined);
    try {
      const result = await retryRemoval({
        data: {
          organizationSlug: context().organization.slug,
          backgroundRemovalId: removal.id,
        },
      });
      if (!result.ok) {
        setErrorMessage(backgroundRemovalErrorMessage(result.error));
        return;
      }
      history.merge(result.value);
    } catch {
      setErrorMessage("Could not retry this request. Try again.");
      await inspect(removal.requestId).catch(() => undefined);
    }
  }

  async function loadMore() {
    const cursor = nextCursor();
    if (!cursor || isLoadingMore()) return;
    setIsLoadingMore(true);
    try {
      const page = await listRemovals({
        data: { organizationSlug: context().organization.slug, cursor },
      });
      for (const item of page.items) history.merge(item);
      setNextCursor(page.nextCursor);
    } catch {
      setErrorMessage("Could not load older requests. Try again.");
    } finally {
      setIsLoadingMore(false);
    }
  }

  return (
    <div class="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>remove background</CardTitle>
          <CardDescription>
            Upload one image. Processing begins as soon as the upload is ready.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ImageUploader
            organizationSlug={context().organization.slug}
            maxSizeBytes={MAX_BACKGROUND_REMOVAL_INPUT_SIZE_BYTES}
            onUploaded={(file) => void history.start(file)}
          />
        </CardContent>
      </Card>

      <Show when={errorMessage()}>
        {(message) => (
          <p class="text-destructive text-sm" role="alert">
            {message()}
          </p>
        )}
      </Show>

      <section class="flex flex-col gap-3" aria-label="Background removal history">
        <Show
          when={removals().length > 0}
          fallback={
            <Card>
              <CardContent class="text-muted-foreground py-10 text-center">
                No background removals yet.
              </CardContent>
            </Card>
          }
        >
          <For each={removals()}>
            {(removal) => (
              <BackgroundRemovalCard removal={removal} onRetry={retry} onDelete={history.remove} />
            )}
          </For>
          <Show when={nextCursor()}>
            <Button
              class="self-center"
              variant="outline"
              disabled={isLoadingMore()}
              onClick={() => void loadMore()}
            >
              {isLoadingMore() ? "..." : "[ load older ]"}
            </Button>
          </Show>
        </Show>
      </section>
    </div>
  );
}

function BackgroundRemovalCard(props: {
  removal: BackgroundRemovalEntry;
  onRetry: (removal: BackgroundRemovalEntry) => Promise<void>;
  onDelete: (removal: BackgroundRemovalEntry) => Promise<void>;
}) {
  const statusText = () =>
    props.removal.creation === "failed" ? "not confirmed" : props.removal.status;
  return (
    <Card>
      <CardHeader>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="min-w-0">
            <CardTitle>{props.removal.input.name}</CardTitle>
            <CardDescription>{props.removal.createdAt.toLocaleString()}</CardDescription>
          </div>
          <span class="bg-muted rounded-full px-2.5 py-1 text-xs">{statusText()}</span>
        </div>
      </CardHeader>
      <CardContent class="flex flex-col gap-3">
        <div class="grid gap-3 sm:grid-cols-2">
          <ImagePanel label="input" url={props.removal.input.url} name={props.removal.input.name} />
          <Show
            when={props.removal.output}
            fallback={
              <div class="bg-muted/30 text-muted-foreground flex min-h-48 items-center justify-center rounded-lg border border-dashed p-4 text-center text-sm">
                {pendingMessage(props.removal)}
              </div>
            }
          >
            {(output) => (
              <ImagePanel label="result" url={output().url} name={output().name} transparent />
            )}
          </Show>
        </div>

        <Show when={props.removal.failureCode}>
          {(failureCode) => <p class="text-destructive text-sm">{failureMessage(failureCode())}</p>}
        </Show>

        <div class="flex flex-wrap gap-2">
          <Show when={props.removal.output}>
            {(output) => (
              <a class="underline underline-offset-4" href={output().url} download={output().name}>
                [ download png ]
              </a>
            )}
          </Show>
          <Show when={props.removal.status === "failed" && canRetry(props.removal)}>
            <Button variant="outline" onClick={() => void props.onRetry(props.removal)}>
              [ retry ]
            </Button>
          </Show>
          <Button
            variant="destructive"
            disabled={!!props.removal.creation}
            onClick={() => void props.onDelete(props.removal)}
          >
            [ delete ]
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ImagePanel(props: { label: string; url?: string; name: string; transparent?: boolean }) {
  return (
    <figure class="overflow-hidden rounded-lg border">
      <div
        class="bg-muted/30 flex min-h-48 items-center justify-center"
        classList={{
          "bg-[linear-gradient(45deg,#ddd_25%,transparent_25%),linear-gradient(-45deg,#ddd_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#ddd_75%),linear-gradient(-45deg,transparent_75%,#ddd_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px]":
            props.transparent,
        }}
      >
        <Show
          when={props.url}
          fallback={<p class="text-muted-foreground p-4 text-sm">{props.name}</p>}
        >
          <img
            class="max-h-96 w-full object-contain"
            src={props.url}
            alt={`${props.label} ${props.name}`}
          />
        </Show>
      </div>
      <figcaption class="text-muted-foreground border-t px-3 py-2 text-xs">
        {props.label}
      </figcaption>
    </figure>
  );
}

function pendingMessage(removal: BackgroundRemovalEntry) {
  if (removal.creation === "failed")
    return "Could not confirm processing. Retry to check this request.";
  switch (removal.status) {
    case "queued":
      return "Waiting for the worker.";
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
