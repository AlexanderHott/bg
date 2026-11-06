import { createFileRoute } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { batch, createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";

import { Button } from "@/components/ui/Button";
import {
  backgroundRemovalErrorMessage,
  createBackgroundRemovalHistory,
  type BackgroundRemovalEntry,
} from "@/modules/backgroundRemoval/browser";
import { BackgroundRemovalGrid } from "@/modules/backgroundRemoval/components/BackgroundRemovalGrid";
import { BackgroundRemovalUploader } from "@/modules/backgroundRemoval/components/BackgroundRemovalUploader";
import { MAX_POLLED_REMOVALS } from "@/modules/backgroundRemoval/policy";
import { startBackgroundRemovalPolling } from "@/modules/backgroundRemoval/polling";
import {
  createBackgroundRemovalFn,
  deleteBackgroundRemovalFn,
  getBackgroundRemovalsFn,
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
  const getRemovals = useServerFn(getBackgroundRemovalsFn);
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

  const removals = createMemo(history.items);
  const unsettledRemovals = createMemo(() =>
    removals().filter(
      (removal) =>
        !removal.creation && ["queued", "processing", "retrying"].includes(removal.status),
    ),
  );
  const hasUnsettledRemoval = createMemo(() => unsettledRemovals().length > 0);

  onMount(() => {
    const updateVisibility = () => setIsPageVisible(document.visibilityState === "visible");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    onCleanup(() => document.removeEventListener("visibilitychange", updateVisibility));
  });

  createEffect(() => {
    if (!isPageVisible() || !hasUnsettledRemoval()) return;

    const stop = startBackgroundRemovalPolling({
      // Newest sort first and the queue is FIFO, so the tail holds the jobs that can change next.
      onPoll: () => refresh(unsettledRemovals().slice(-MAX_POLLED_REMOVALS)),
    });
    onCleanup(stop);
  });

  async function refresh(targets: ReadonlyArray<BackgroundRemovalEntry>) {
    const current = await getRemovals({
      data: {
        organizationSlug: context().organization.slug,
        backgroundRemovalIds: targets.map((target) => target.id),
      },
    });
    const currentIds = new Set(current.map((removal) => removal.id));
    batch(() => {
      for (const removal of current) history.merge(removal);
      for (const target of targets) {
        if (!currentIds.has(target.id)) history.hide(target.requestId);
      }
    });
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
      await refresh([removal]).catch(() => undefined);
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
          {isLoadingMore() ? "loading…" : "load older"}
        </Button>
      </Show>
    </div>
  );
}
