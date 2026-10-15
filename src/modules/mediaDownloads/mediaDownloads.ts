import { randomUUIDv7 } from "node:crypto";

import { and, asc, count, desc, eq, getColumns, gt, inArray, isNull, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import * as minio from "@/modules/files/minio";
import { files } from "@/modules/files/schema";

import {
  MAX_BATCH_ITEMS,
  METADATA_CACHE_MS,
  MediaError,
  normalizeMediaUrl,
  selectFormats,
  TASK_LEASE_MS,
  validateSettings,
  type DownloadSettings,
  type FormatSelection,
  type MediaMetadata,
  type MediaProgress,
} from "./policy";
import {
  mediaBatches as batches,
  mediaItems as items,
  mediaSources as sources,
  mediaTasks as tasks,
} from "./schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Task = typeof tasks.$inferSelect;

export async function createMediaBatch(options: {
  organizationId: string;
  requestId: string;
  urls: string[];
  settings: DownloadSettings;
  queue: boolean;
}) {
  validateSettings(options.settings);
  const urls = [...new Set(options.urls.map(normalizeMediaUrl))];
  if (!urls.length || urls.length > 50) throw new Error("Submit between 1 and 50 URLs.");
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(batches)
      .values({
        id: randomUUIDv7(),
        organizationId: options.organizationId,
        requestId: options.requestId,
        urls,
        settings: options.settings,
        state: options.queue ? "queued" : "draft",
      })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      const [existing] = await tx
        .select()
        .from(batches)
        .where(
          and(
            eq(batches.organizationId, options.organizationId),
            eq(batches.requestId, options.requestId),
          ),
        );
      if (!existing || existing.deletedAt || JSON.stringify(existing.urls) !== JSON.stringify(urls))
        throw new Error("This submission ID was already used for different URLs.");
      if (
        !sameSettings(existing.settings, options.settings) ||
        (options.queue && existing.state === "draft")
      )
        throw new Error("This submission ID was already used with different settings.");
      return existing.id;
    }
    for (const [position, url] of urls.entries()) {
      const sourceId = randomUUIDv7();
      await tx.insert(sources).values({ id: sourceId, batchId: created.id, url, position });
      await tx
        .insert(tasks)
        .values({ id: randomUUIDv7(), batchId: created.id, sourceId, kind: "discover" });
    }
    return created.id;
  });
}

async function lockBatch(tx: Transaction, organizationId: string, batchId: string) {
  const [batch] = await tx
    .select()
    .from(batches)
    .where(
      and(
        eq(batches.id, batchId),
        eq(batches.organizationId, organizationId),
        isNull(batches.deletedAt),
      ),
    )
    .for("update");
  if (!batch) throw new Error("Download batch not found.");
  return batch;
}

export async function listMediaBatches(organizationId: string, before?: string) {
  const page = await db
    .select()
    .from(batches)
    .where(
      and(
        eq(batches.organizationId, organizationId),
        isNull(batches.deletedAt),
        before ? sql`${batches.id} < ${before}` : undefined,
      ),
    )
    .orderBy(desc(batches.id))
    .limit(21);
  return { batches: page.slice(0, 20), nextCursor: page.length > 20 ? page[19]?.id : undefined };
}

export async function getMediaBatch(organizationId: string, batchId: string, offset = 0) {
  const [batch] = await db
    .select()
    .from(batches)
    .where(
      and(
        eq(batches.id, batchId),
        eq(batches.organizationId, organizationId),
        isNull(batches.deletedAt),
      ),
    );
  if (!batch) throw new Error("Download batch not found.");
  const { metadata: _metadata, ...itemColumns } = getColumns(items);
  const [sourceRows, itemRows, totals] = await Promise.all([
    db
      .select({ source: sources, task: tasks })
      .from(sources)
      .leftJoin(tasks, and(eq(tasks.sourceId, sources.id), eq(tasks.kind, "discover")))
      .where(eq(sources.batchId, batchId))
      .orderBy(sources.position),
    db
      .select({ item: itemColumns, download: { state: tasks.state, progress: tasks.progress } })
      .from(items)
      .innerJoin(sources, eq(items.sourceId, sources.id))
      .leftJoin(tasks, and(eq(tasks.itemId, items.id), eq(tasks.kind, "download")))
      .where(eq(items.batchId, batchId))
      .orderBy(sources.position, items.position, items.id)
      .limit(50)
      .offset(offset),
    db
      .select({ state: items.state, count: count() })
      .from(items)
      .where(eq(items.batchId, batchId))
      .groupBy(items.state),
  ]);
  // Detailed format lists are fetched only when an item's panel is opened.
  return {
    batch,
    sources: sourceRows.map(({ source, task }) => ({
      ...source,
      state: task?.state,
      error: task?.error,
    })),
    items: itemRows.map(({ item, download }) => ({
      ...item,
      progress: download?.progress,
    })),
    totals,
    total: totals.reduce((sum, group) => sum + group.count, 0),
  };
}

export async function getMediaItem(organizationId: string, batchId: string, itemId: string) {
  const [row] = await db
    .select({ item: items, inspection: tasks })
    .from(items)
    .innerJoin(batches, eq(items.batchId, batches.id))
    .leftJoin(tasks, and(eq(tasks.itemId, items.id), eq(tasks.kind, "inspect")))
    .where(
      and(
        eq(items.id, itemId),
        eq(items.batchId, batchId),
        eq(batches.organizationId, organizationId),
        isNull(batches.deletedAt),
      ),
    );
  if (!row) throw new Error("Download not found.");
  return {
    item: row.item,
    inspection: row.inspection
      ? { state: row.inspection.state, error: row.inspection.error }
      : null,
  };
}

export async function queueMediaBatch(
  organizationId: string,
  batchId: string,
  settings: DownloadSettings,
) {
  validateSettings(settings);
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, organizationId, batchId);
    if (batch.state === "queued") {
      if (!sameSettings(batch.settings, settings))
        throw new Error("This batch was already queued with different settings.");
      return;
    }
    if (batch.state !== "draft") throw new Error("This batch has been cancelled.");
    const pending = await tx
      .select()
      .from(items)
      .where(and(eq(items.batchId, batchId), eq(items.state, "draft")));
    for (const item of pending) {
      if (item.selection && item.metadata) selectFormats(item.metadata, settings, item.selection);
    }
    await tx.update(batches).set({ state: "queued", settings }).where(eq(batches.id, batchId));
    for (const item of pending) await enqueueDownload(tx, item.id, batchId);
  });
}

function sameSettings(left: DownloadSettings, right: DownloadSettings) {
  return (
    left.mode === right.mode &&
    left.conversion === right.conversion &&
    left.maxHeight === right.maxHeight
  );
}

async function enqueueDownload(tx: Transaction, itemId: string, batchId: string) {
  await tx
    .insert(tasks)
    .values({ id: randomUUIDv7(), itemId, batchId, kind: "download" })
    .onConflictDoNothing();
  await tx.update(items).set({ state: "queued", error: null }).where(eq(items.id, itemId));
}

export async function inspectMediaItem(
  organizationId: string,
  batchId: string,
  itemId: string,
  refresh: boolean,
) {
  await db.transaction(async (tx) => {
    const batch = await lockBatch(tx, organizationId, batchId);
    if (batch.state === "cancelled") throw new Error("This batch has been cancelled.");
    const [item] = await tx
      .select()
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.batchId, batchId)));
    if (!item?.url) throw new Error("This item is unavailable.");
    if (!refresh && item.inspectedAt && Date.now() - item.inspectedAt.getTime() < METADATA_CACHE_MS)
      return;
    await tx
      .insert(tasks)
      .values({ id: randomUUIDv7(), batchId, itemId, kind: "inspect" })
      .onConflictDoUpdate({
        target: [tasks.kind, tasks.itemId],
        set: { state: "queued", error: null, attempts: 0, availableAt: new Date() },
        setWhere: inArray(tasks.state, ["done", "failed", "cancelled"]),
      });
  });
}

export async function selectMediaItem(
  organizationId: string,
  batchId: string,
  itemId: string,
  selection: FormatSelection | null,
  settings: DownloadSettings,
) {
  await db.transaction(async (tx) => {
    const batch = await lockBatch(tx, organizationId, batchId);
    const [item] = await tx
      .select()
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.batchId, batchId)));
    if (
      !item ||
      !["draft", "failed", "needs_selection"].includes(item.state) ||
      batch.state === "cancelled"
    )
      throw new Error("Selections can only change before queueing or after a failure.");
    if (selection) {
      if (!item.metadata) throw new Error("Inspect formats before selecting one.");
      selectFormats(item.metadata, batch.state === "draft" ? settings : batch.settings, selection);
    }
    await tx.update(items).set({ selection }).where(eq(items.id, itemId));
  });
}

export async function cancelMedia(organizationId: string, batchId: string, itemId?: string) {
  await db.transaction(async (tx) => {
    await lockBatch(tx, organizationId, batchId);
    if (!itemId)
      await tx.update(batches).set({ state: "cancelled" }).where(eq(batches.id, batchId));
    await tx
      .update(tasks)
      .set({ state: "cancelled", leaseToken: null, leaseExpiresAt: null })
      .where(
        and(
          eq(tasks.batchId, batchId),
          itemId ? eq(tasks.itemId, itemId) : undefined,
          inArray(tasks.state, ["queued", "running"]),
        ),
      );
    await tx
      .update(items)
      .set({ state: "cancelled", error: null })
      .where(
        and(
          eq(items.batchId, batchId),
          itemId ? eq(items.id, itemId) : undefined,
          inArray(items.state, ["draft", "queued", "running"]),
        ),
      );
  });
}

export async function retryMedia(
  organizationId: string,
  batchId: string,
  itemId?: string,
  sourceId?: string,
) {
  await db.transaction(async (tx) => {
    const batch = await lockBatch(tx, organizationId, batchId);
    if (batch.state === "cancelled")
      throw new Error("Create a new batch to download cancelled items.");
    const retried = await tx
      .update(tasks)
      .set({
        state: "queued",
        attempts: 0,
        error: null,
        progress: null,
        availableAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(tasks.batchId, batchId),
          eq(tasks.state, "failed"),
          itemId ? eq(tasks.itemId, itemId) : sourceId ? eq(tasks.sourceId, sourceId) : undefined,
          sourceId ? eq(tasks.kind, "discover") : inArray(tasks.kind, ["discover", "download"]),
        ),
      )
      .returning();
    for (const task of retried)
      if (task.kind === "download" && task.itemId)
        await tx
          .update(items)
          .set({ state: "queued", error: null })
          .where(eq(items.id, task.itemId));
  });
}

export async function deleteMediaBatch(organizationId: string, batchId: string) {
  await cancelMedia(organizationId, batchId);
  await db
    .update(batches)
    .set({ deletedAt: new Date() })
    .where(and(eq(batches.id, batchId), eq(batches.organizationId, organizationId)));
}

export async function mediaDownloadUrl(organizationId: string, batchId: string, itemId: string) {
  const [row] = await db
    .select({ file: files })
    .from(items)
    .innerJoin(batches, eq(items.batchId, batches.id))
    .innerJoin(
      files,
      and(eq(items.outputFileId, files.id), eq(files.organizationId, batches.organizationId)),
    )
    .where(
      and(
        eq(items.id, itemId),
        eq(items.batchId, batchId),
        eq(batches.organizationId, organizationId),
        eq(items.state, "ready"),
        isNull(batches.deletedAt),
      ),
    );
  if (!row) throw new Error("The download is not ready.");
  const result = await minio.signOpenObject({
    key: row.file.storageKey,
    downloadName: row.file.name,
  });
  if (!result.ok) throw new Error("Could not create a download link.");
  return result.value;
}

export async function claimMediaTask(kind: Task["kind"], organizationId?: string) {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ task: tasks, batch: batches })
      .from(tasks)
      .innerJoin(batches, eq(tasks.batchId, batches.id))
      .where(
        and(
          eq(tasks.kind, kind),
          eq(tasks.state, "queued"),
          lte(tasks.availableAt, new Date()),
          isNull(batches.deletedAt),
          sql`${batches.state} <> 'cancelled'`,
          organizationId ? eq(batches.organizationId, organizationId) : undefined,
        ),
      )
      .orderBy(asc(tasks.availableAt), asc(tasks.id))
      .for("update", { of: batches, skipLocked: true })
      .limit(1);
    if (!candidate) return;
    const [task] = await tx
      .update(tasks)
      .set({
        state: "running",
        attempts: sql`${tasks.attempts} + 1`,
        leaseToken: randomUUIDv7(),
        leaseExpiresAt: new Date(Date.now() + TASK_LEASE_MS),
        error: null,
        progress: null,
      })
      .where(and(eq(tasks.id, candidate.task.id), eq(tasks.state, "queued")))
      .returning();
    if (!task) return;
    const [item] = task.itemId
      ? await tx.select().from(items).where(eq(items.id, task.itemId))
      : [];
    const [source] = task.sourceId
      ? await tx.select().from(sources).where(eq(sources.id, task.sourceId))
      : [];
    if (task.kind === "download" && item)
      await tx.update(items).set({ state: "running" }).where(eq(items.id, item.id));
    return { task, batch: candidate.batch, item, source };
  });
}

function liveTask(task: Task) {
  return and(
    eq(tasks.id, task.id),
    eq(tasks.state, "running"),
    eq(tasks.leaseToken, task.leaseToken ?? "00000000-0000-0000-0000-000000000000"),
    gt(tasks.leaseExpiresAt, new Date()),
  );
}

export async function heartbeatMediaTask(task: Task, progress?: MediaProgress) {
  const updated = await db
    .update(tasks)
    .set({
      leaseExpiresAt: new Date(Date.now() + TASK_LEASE_MS),
      ...(progress ? { progress } : {}),
    })
    .where(liveTask(task))
    .returning({ id: tasks.id });
  return updated.length > 0;
}

async function withTask<T>(
  task: Task,
  run: (tx: Transaction, batch: typeof batches.$inferSelect) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(batches)
      .where(
        and(
          eq(batches.id, task.batchId),
          isNull(batches.deletedAt),
          sql`${batches.state} <> 'cancelled'`,
        ),
      )
      .for("update");
    if (!batch) return;
    const [current] = await tx.select().from(tasks).where(liveTask(task)).for("update");
    if (!current) return;
    return run(tx, batch);
  });
}

export async function addDiscoveredMedia(
  task: Task,
  entry: { key: string; position: number; url: string | null; title: string },
) {
  return withTask(task, async (tx, batch) => {
    if (!task.sourceId) throw new Error("Discovery task has no source.");
    const [existing] = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.sourceId, task.sourceId), eq(items.entryKey, entry.key)));
    if (existing) return true;
    const [total] = await tx
      .select({ count: count() })
      .from(items)
      .where(eq(items.batchId, batch.id));
    if ((total?.count ?? 0) >= MAX_BATCH_ITEMS)
      throw new MediaError(
        "limit",
        `This batch reached the ${MAX_BATCH_ITEMS}-item limit. Items already discovered remain available.`,
      );
    const id = randomUUIDv7();
    await tx.insert(items).values({
      id,
      organizationId: batch.organizationId,
      batchId: batch.id,
      sourceId: task.sourceId,
      entryKey: entry.key,
      position: entry.position,
      url: entry.url,
      title: entry.title,
      state: entry.url ? "draft" : "failed",
      error: entry.url ? null : "This playlist entry is unavailable.",
    });
    if (batch.state === "queued" && entry.url) await enqueueDownload(tx, id, batch.id);
    return true;
  });
}

export async function finishMediaTask(task: Task, metadata?: MediaMetadata) {
  return withTask(task, async (tx) => {
    if (metadata && task.itemId)
      await tx
        .update(items)
        .set({ metadata, title: metadata.title, inspectedAt: new Date() })
        .where(eq(items.id, task.itemId));
    await tx
      .update(tasks)
      .set({ state: "done", leaseToken: null, leaseExpiresAt: null })
      .where(eq(tasks.id, task.id));
    return true;
  });
}

export async function publishMedia(
  task: Task,
  output: {
    key: string;
    name: string;
    mediaType: string;
    sizeBytes: number;
    description: string;
    metadata: MediaMetadata;
  },
) {
  return withTask(task, async (tx, batch) => {
    if (!task.itemId) throw new Error("Download task has no item.");
    const fileId = randomUUIDv7();
    await tx.insert(files).values({
      id: fileId,
      organizationId: batch.organizationId,
      requestId: task.id,
      state: "ready",
      name: output.name,
      mediaType: output.mediaType,
      expectedSizeBytes: output.sizeBytes,
      sizeBytes: output.sizeBytes,
      storageKey: output.key,
      readyAt: new Date(),
    });
    await tx
      .update(items)
      .set({
        state: "ready",
        outputFileId: fileId,
        outputDescription: output.description,
        outputSizeBytes: output.sizeBytes,
        metadata: output.metadata,
        inspectedAt: new Date(),
        title: output.metadata.title,
        error: null,
      })
      .where(eq(items.id, task.itemId));
    await tx
      .update(tasks)
      .set({ state: "done", progress: null, leaseToken: null, leaseExpiresAt: null })
      .where(eq(tasks.id, task.id));
    return true;
  });
}

export async function failMediaTask(task: Task, error: unknown) {
  const failure =
    error instanceof MediaError
      ? error
      : new MediaError(
          "network",
          "The download worker could not complete this request. Try again.",
        );
  return withTask(task, async (tx) => {
    const retry = ["network", "worker_lost"].includes(failure.code) && task.attempts < 3;
    await tx
      .update(tasks)
      .set({
        state: retry ? "queued" : "failed",
        error: failure.message,
        progress: null,
        leaseToken: null,
        leaseExpiresAt: null,
        availableAt: new Date(Date.now() + task.attempts * 15_000),
      })
      .where(eq(tasks.id, task.id));
    if (task.kind === "download" && task.itemId)
      await tx
        .update(items)
        .set({
          state: retry
            ? "queued"
            : failure.code === "needs_selection"
              ? "needs_selection"
              : "failed",
          error: failure.message,
        })
        .where(eq(items.id, task.itemId));
  });
}

export async function recoverMediaTasks(organizationId?: string) {
  const expired = await db
    .select({ task: tasks })
    .from(tasks)
    .innerJoin(batches, eq(tasks.batchId, batches.id))
    .where(
      and(
        eq(tasks.state, "running"),
        lte(tasks.leaseExpiresAt, new Date()),
        organizationId ? eq(batches.organizationId, organizationId) : undefined,
      ),
    )
    .limit(100);
  for (const { task } of expired)
    await db.transaction(async (tx) => {
      await tx.select().from(batches).where(eq(batches.id, task.batchId)).for("update");
      const retry = task.attempts < 3;
      const updated = await tx
        .update(tasks)
        .set({
          state: retry ? "queued" : "failed",
          error: "The worker stopped before finishing.",
          leaseToken: null,
          leaseExpiresAt: null,
          progress: null,
          availableAt: new Date(Date.now() + 15_000),
        })
        .where(
          and(
            eq(tasks.id, task.id),
            eq(tasks.state, "running"),
            lte(tasks.leaseExpiresAt, new Date()),
          ),
        )
        .returning();
      if (updated.length && task.kind === "download" && task.itemId)
        await tx
          .update(items)
          .set({
            state: retry ? "queued" : "failed",
            error: "The worker stopped before finishing.",
          })
          .where(eq(items.id, task.itemId));
    });
}

export async function cleanMediaStorage(cursor?: string) {
  const deleted = await db
    .select({ id: batches.id })
    .from(batches)
    .where(sql`${batches.deletedAt} IS NOT NULL`)
    .limit(10);
  for (const batch of deleted) {
    const outputs = await db
      .select({ file: files })
      .from(items)
      .innerJoin(files, eq(items.outputFileId, files.id))
      .where(eq(items.batchId, batch.id));
    for (const { file } of outputs) {
      const removed = await minio.deleteObject({ key: file.storageKey });
      if (!removed.ok) throw new Error("Could not clean a deleted media file.");
    }
    await db.transaction(async (tx) => {
      await tx.delete(batches).where(eq(batches.id, batch.id));
      if (outputs.length)
        await tx.delete(files).where(
          inArray(
            files.id,
            outputs.map(({ file }) => file.id),
          ),
        );
    });
  }
  const page = await minio.listObjects({ prefix: "media-downloads/", cursor });
  for (const object of page.objects) {
    if (Date.now() - object.lastModified.getTime() < 24 * 60 * 60_000) continue;
    const [file] = await db
      .select({ id: files.id })
      .from(files)
      .where(eq(files.storageKey, object.key));
    if (!file) await minio.deleteObject({ key: object.key });
  }
  return page.nextCursor;
}
