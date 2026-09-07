import { createFileRoute } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";

import { Button } from "@/components/ui/Button";
import {
  backgroundRemovalErrorMessage,
  createBackgroundRemovalHistory,
  type BackgroundRemovalEntry,
} from "@/modules/backgroundRemoval/browser";
import { BackgroundRemovalGrid } from "@/modules/backgroundRemoval/components/BackgroundRemovalGrid";
import { BackgroundRemovalUploader } from "@/modules/backgroundRemoval/components/BackgroundRemovalUploader";
import { startBackgroundRemovalPolling } from "@/modules/backgroundRemoval/polling";
import {
  createBackgroundRemovalFn,
  deleteBackgroundRemovalFn,
  getBackgroundRemovalFn,
  listBackgroundRemovalsFn,
  retryBackgroundRemovalFn,
} from "@/modules/backgroundRemoval/serverFunctions";

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
    <div class="flex flex-col gap-8">
      <header class="flex flex-col gap-2">
        <h1 class="text-xl font-medium">remove background</h1>
        <p class="text-muted-foreground text-sm">
          Remove image backgrounds and download transparent PNGs.
        </p>
      </header>
      <BackgroundRemovalUploader
        organizationSlug={context().organization.slug}
        onUploaded={(file) => void history.start(file)}
      />
      <Show when={errorMessage()}>
        {(message) => (
          <p class="text-destructive text-sm" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <BackgroundRemovalGrid removals={removals()} onRetry={retry} onDelete={history.remove} />
      <Show when={nextCursor()}>
        <Button
          class="self-center"
          variant="outline"
          disabled={isLoadingMore()}
          onClick={() => void loadMore()}
        >
          {isLoadingMore() ? "loading…" : "[ load older ]"}
        </Button>
      </Show>
    </div>
  );
}
