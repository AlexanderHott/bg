import { randomUUIDv7 } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, test } from "vite-plus/test";

import { db } from "@/db";
import { files } from "@/modules/files/schema";
import { organizations } from "@/modules/organizations/schema";

import {
  addDiscoveredMedia,
  cancelMedia,
  claimMediaTask,
  createMediaBatch,
  failMediaTask,
  finishMediaTask,
  getMediaBatch,
  getMediaItem,
  heartbeatMediaTask,
  inspectMediaItem,
  publishMedia,
  queueMediaBatch,
  recoverMediaTasks,
  retryMedia,
  selectMediaItem,
} from "./mediaDownloads";
import { DEFAULT_SETTINGS, MediaError } from "./policy";
import { mediaTasks } from "./schema";

const organizationIds: string[] = [];
let organizationId: string;
const metadata = {
  title: "Video",
  formats: [
    { id: "video", extension: "webm", videoCodec: "vp9", height: 1080, approximateSize: false },
    { id: "audio", extension: "webm", audioCodec: "opus", approximateSize: false },
  ],
};

describe("media download queue", () => {
  beforeEach(async () => {
    organizationId = randomUUIDv7();
    organizationIds.push(organizationId);
    await db.insert(organizations).values({
      id: organizationId,
      name: "Media integration test",
      slug: `media-${organizationId}`,
    });
  });
  afterAll(async () => {
    await db.delete(organizations).where(inArray(organizations.id, organizationIds));
    await db.$client.end();
  });

  async function create(queue = false) {
    const batchId = await createMediaBatch({
      organizationId,
      requestId: randomUUIDv7(),
      urls: ["https://example.com/playlist"],
      settings: DEFAULT_SETTINGS,
      queue,
    });
    const claim = await claimMediaTask("discover", organizationId);
    if (!claim) throw new Error("Discovery was not claimed");
    return { batchId, claim };
  }
  async function add(
    task: NonNullable<Awaited<ReturnType<typeof claimMediaTask>>>["task"],
    key = "video",
  ) {
    return addDiscoveredMedia(task, {
      key,
      position: 1,
      url: `https://example.com/${key}`,
      title: key,
    });
  }

  test("creates idempotently and claims a task once under contention", async () => {
    const requestId = randomUUIDv7();
    const input = {
      organizationId,
      requestId,
      urls: ["https://example.com/one", "https://example.com/two"],
      settings: DEFAULT_SETTINGS,
      queue: false,
    };
    const ids = await Promise.all(Array.from({ length: 4 }, () => createMediaBatch(input)));
    expect(new Set(ids).size).toBe(1);
    const page = await getMediaBatch(organizationId, ids[0]!);
    expect(page.sources).toHaveLength(2);
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => claimMediaTask("discover", organizationId)),
    );
    const claimed = claims.filter((claim) => claim !== undefined);
    expect(new Set(claimed.map((claim) => claim.task.id)).size).toBe(claimed.length);
    expect(claimed.length).toBeGreaterThan(0);
    await expect(
      createMediaBatch({ ...input, urls: ["https://example.com/changed"] }),
    ).rejects.toThrow("different URLs");
    await expect(
      createMediaBatch({ ...input, settings: { mode: "audio", conversion: "original" } }),
    ).rejects.toThrow("different settings");
  });

  test("draft inspection does not download; late discoveries inherit frozen batch settings", async () => {
    const { batchId, claim } = await create();
    await add(claim.task);
    const first = (await getMediaBatch(organizationId, batchId)).items[0]!;
    expect(first.state).toBe("draft");
    expect(await claimMediaTask("download", organizationId)).toBeUndefined();
    await inspectMediaItem(organizationId, batchId, first.id, false);
    const inspection = await claimMediaTask("inspect", organizationId);
    expect(inspection?.item?.id).toBe(first.id);
    await finishMediaTask(inspection!.task, metadata);
    await selectMediaItem(
      organizationId,
      batchId,
      first.id,
      { videoId: "video", audioId: "audio" },
      DEFAULT_SETTINGS,
    );
    await queueMediaBatch(organizationId, batchId, { ...DEFAULT_SETTINGS, maxHeight: 720 });
    await add(claim.task, "later");
    const page = await getMediaBatch(organizationId, batchId);
    expect(page.items.map((item) => item.state)).toEqual(["queued", "queued"]);
    expect(page.items[0]?.selection).toEqual({ videoId: "video", audioId: "audio" });
    expect(page.batch.settings.maxHeight).toBe(720);
    await expect(
      selectMediaItem(organizationId, batchId, first.id, null, DEFAULT_SETTINGS),
    ).rejects.toThrow("before queueing");
  });

  test("repeated discovery after partial failure preserves completed and queued items", async () => {
    const { batchId, claim } = await create(true);
    await add(claim.task);
    await failMediaTask(
      claim.task,
      new MediaError("unavailable", "The playlist stopped responding."),
    );
    expect((await getMediaBatch(organizationId, batchId)).items).toHaveLength(1);
    await retryMedia(organizationId, batchId, undefined, claim.source!.id);
    const retried = await claimMediaTask("discover", organizationId);
    await add(retried!.task);
    await add(retried!.task, "second");
    await finishMediaTask(retried!.task);
    const page = await getMediaBatch(organizationId, batchId);
    expect(page.items).toHaveLength(2);
    expect(page.sources[0]?.state).toBe("done");
  });

  test("cancellation fences all late discoveries, heartbeats, and output publication", async () => {
    const { batchId, claim } = await create(true);
    await add(claim.task);
    const download = await claimMediaTask("download", organizationId);
    await cancelMedia(organizationId, batchId);
    expect(await heartbeatMediaTask(download!.task)).toBe(false);
    expect(await add(claim.task, "late")).toBeUndefined();
    expect(
      await publishMedia(download!.task, {
        key: "tests/late",
        name: "late.webm",
        mediaType: "video/webm",
        sizeBytes: 20,
        description: "webm",
        metadata,
      }),
    ).toBeUndefined();
    const page = await getMediaBatch(organizationId, batchId);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.state).toBe("cancelled");
  });

  test("worker recovery rejects stale results and retries with a new lease", async () => {
    const { batchId, claim } = await create(true);
    await add(claim.task);
    await finishMediaTask(claim.task);
    const download = await claimMediaTask("download", organizationId);
    await db
      .update(mediaTasks)
      .set({ leaseExpiresAt: new Date(0) })
      .where(eq(mediaTasks.id, download!.task.id));
    await recoverMediaTasks(organizationId);
    expect(await heartbeatMediaTask(download!.task)).toBe(false);
    expect(await finishMediaTask(download!.task)).toBeUndefined();
    await db
      .update(mediaTasks)
      .set({ availableAt: new Date(0) })
      .where(eq(mediaTasks.id, download!.task.id));
    const retried = await claimMediaTask("download", organizationId);
    expect(retried?.task.leaseToken).not.toBe(download?.task.leaseToken);
    expect(retried?.task.attempts).toBe(2);
    expect((await getMediaBatch(organizationId, batchId)).items[0]?.state).toBe("running");
  });

  test("publishes a file larger than 2 GB only once", async () => {
    const { batchId, claim } = await create(true);
    await add(claim.task);
    await finishMediaTask(claim.task);
    const download = await claimMediaTask("download", organizationId);
    const output = {
      key: `tests/${organizationId}/output.webm`,
      name: "Video.webm",
      mediaType: "video/webm",
      sizeBytes: 3_000_000_000,
      description: "webm · 1080p",
      metadata,
    };
    expect(await publishMedia(download!.task, output)).toBe(true);
    expect(await publishMedia(download!.task, output)).toBeUndefined();
    const [file] = await db
      .select()
      .from(files)
      .where(and(eq(files.organizationId, organizationId), eq(files.requestId, download!.task.id)));
    expect(file?.sizeBytes).toBe(3_000_000_000);
    await cancelMedia(organizationId, batchId);
    expect((await getMediaBatch(organizationId, batchId)).items[0]?.state).toBe("ready");
  });

  test("exact format failures require selection and remain retryable after editing", async () => {
    const { batchId, claim } = await create(true);
    await add(claim.task);
    const download = await claimMediaTask("download", organizationId);
    await failMediaTask(download!.task, new MediaError("needs_selection", "Choose a new format."));
    expect((await getMediaBatch(organizationId, batchId)).items[0]?.state).toBe("needs_selection");
    await retryMedia(organizationId, batchId, download!.item!.id);
    expect((await getMediaBatch(organizationId, batchId)).items[0]?.state).toBe("queued");
  });

  test("scopes reads and mutations to the organization", async () => {
    const { batchId, claim } = await create();
    await add(claim.task);
    const itemId = (await getMediaBatch(organizationId, batchId)).items[0]!.id;
    const other = randomUUIDv7();
    await expect(getMediaBatch(other, batchId)).rejects.toThrow("not found");
    await expect(getMediaItem(other, batchId, itemId)).rejects.toThrow("not found");
    await expect(cancelMedia(other, batchId)).rejects.toThrow("not found");
    await expect(inspectMediaItem(other, batchId, itemId, false)).rejects.toThrow("not found");
    await expect(queueMediaBatch(other, batchId, DEFAULT_SETTINGS)).rejects.toThrow("not found");
  });
});
