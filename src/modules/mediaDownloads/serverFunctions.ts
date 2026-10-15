import { createServerFn } from "@tanstack/solid-start";
import { setResponseHeader } from "@tanstack/solid-start/server";
import * as v from "valibot";

import { authMiddleware } from "@/modules/auth/middleware";
import { getOrganization } from "@/modules/organizations/organizations";
import { OrganizationSlugValidator } from "@/modules/organizations/validators";

import * as downloads from "./mediaDownloads";
import { DownloadSettings, FormatSelection } from "./policy";

const uuid = v.pipe(v.string(), v.uuid());
const organization = { organizationSlug: OrganizationSlugValidator };
const batch = { ...organization, batchId: uuid };
const item = { ...batch, itemId: uuid };

async function requireOrganization(userId: string, organizationSlug: string) {
  setResponseHeader("Cache-Control", "private, no-store");
  const found = await getOrganization({ userId, organizationSlug });
  if (!found) throw new Error("Organization not found.");
  return found.id;
}

export const createMediaBatchFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    v.object({
      ...organization,
      requestId: uuid,
      urls: v.pipe(
        v.array(v.pipe(v.string(), v.maxLength(4_096))),
        v.minLength(1),
        v.maxLength(50),
      ),
      settings: DownloadSettings,
      queue: v.boolean(),
    }),
  )
  .handler(async ({ context, data }) =>
    downloads.createMediaBatch({
      ...data,
      organizationId: await requireOrganization(context.userId, data.organizationSlug),
    }),
  );
export const listMediaBatchesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(v.object({ ...organization, before: v.optional(uuid) }))
  .handler(async ({ context, data }) =>
    downloads.listMediaBatches(
      await requireOrganization(context.userId, data.organizationSlug),
      data.before,
    ),
  );
export const getMediaBatchFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(
    v.object({
      ...batch,
      offset: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1_000))),
    }),
  )
  .handler(async ({ context, data }) =>
    downloads.getMediaBatch(
      await requireOrganization(context.userId, data.organizationSlug),
      data.batchId,
      data.offset,
    ),
  );
export const getMediaItemFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(v.object(item))
  .handler(async ({ context, data }) =>
    downloads.getMediaItem(
      await requireOrganization(context.userId, data.organizationSlug),
      data.batchId,
      data.itemId,
    ),
  );
export const queueMediaBatchFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(v.object({ ...batch, settings: DownloadSettings }))
  .handler(async ({ context, data }) =>
    downloads.queueMediaBatch(
      await requireOrganization(context.userId, data.organizationSlug),
      data.batchId,
      data.settings,
    ),
  );
export const inspectMediaItemFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(v.object({ ...item, refresh: v.boolean() }))
  .handler(async ({ context, data }) =>
    downloads.inspectMediaItem(
      await requireOrganization(context.userId, data.organizationSlug),
      data.batchId,
      data.itemId,
      data.refresh,
    ),
  );
export const selectMediaItemFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    v.object({ ...item, selection: v.nullable(FormatSelection), settings: DownloadSettings }),
  )
  .handler(async ({ context, data }) =>
    downloads.selectMediaItem(
      await requireOrganization(context.userId, data.organizationSlug),
      data.batchId,
      data.itemId,
      data.selection,
      data.settings,
    ),
  );
export const cancelMediaFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(v.object({ ...batch, itemId: v.optional(uuid) }))
  .handler(async ({ context, data }) =>
    downloads.cancelMedia(
      await requireOrganization(context.userId, data.organizationSlug),
      data.batchId,
      data.itemId,
    ),
  );
export const retryMediaFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(v.object({ ...batch, itemId: v.optional(uuid), sourceId: v.optional(uuid) }))
  .handler(async ({ context, data }) =>
    downloads.retryMedia(
      await requireOrganization(context.userId, data.organizationSlug),
      data.batchId,
      data.itemId,
      data.sourceId,
    ),
  );
export const deleteMediaBatchFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(v.object(batch))
  .handler(async ({ context, data }) =>
    downloads.deleteMediaBatch(
      await requireOrganization(context.userId, data.organizationSlug),
      data.batchId,
    ),
  );
export const mediaDownloadUrlFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(v.object(item))
  .handler(async ({ context, data }) =>
    downloads.mediaDownloadUrl(
      await requireOrganization(context.userId, data.organizationSlug),
      data.batchId,
      data.itemId,
    ),
  );
