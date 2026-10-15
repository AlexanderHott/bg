import { createFileRoute } from "@tanstack/solid-router";
import { Show } from "solid-js";

import { DownloadQueue } from "@/modules/mediaDownloads/components/DownloadQueue";
import { listMediaBatchesFn } from "@/modules/mediaDownloads/serverFunctions";

export const Route = createFileRoute("/_app/$orgSlug/download-media")({
  loader: ({ params }) => listMediaBatchesFn({ data: { organizationSlug: params.orgSlug } }),
  component: DownloadMedia,
});

function DownloadMedia() {
  const data = Route.useLoaderData();
  const context = Route.useRouteContext();
  return (
    <Show when={context().organization.slug} keyed>
      {(slug) => <DownloadQueue organizationSlug={slug} initial={data()} />}
    </Show>
  );
}
