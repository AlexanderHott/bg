import { randomUUIDv7 } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { db } from "@/db";
import { err, ok } from "@/lib/result";
import * as minio from "@/modules/files/minio";
import * as fileSchema from "@/modules/files/schema";
import * as organizationSchema from "@/modules/organizations/schema";

import {
  claimNextBackgroundRemoval,
  cleanDeletedBackgroundRemoval,
  cleanUnreferencedBackgroundRemovalObjects,
  createBackgroundRemoval,
  deleteBackgroundRemoval,
  getBackgroundRemoval,
  publishBackgroundRemovalOutput,
} from "./backgroundRemovals";
import * as backgroundRemovalSchema from "./schema";

vi.mock("@/modules/files/minio", async (importOriginal) => ({
  ...(await importOriginal<typeof minio>()),
  deleteObject: vi.fn(async () => ok(undefined)),
  putObjectFromFile: vi.fn(async () => ok(undefined)),
  listObjects: vi.fn(async () => ({ objects: [], nextCursor: undefined })),
}));

const organizationId = randomUUIDv7();
let inputFileId: string;
let inputStorageKey: string;

describe.runIf(process.env.RUN_DB_INTEGRATION === "1")("background-removal cleanup", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await db.insert(organizationSchema.organizations).values({
      id: organizationId,
      name: "Cleanup test",
      slug: `cleanup-${organizationId}`,
    });
    inputFileId = randomUUIDv7();
    inputStorageKey = `organizations/${organizationId}/files/${inputFileId}/attempts/${randomUUIDv7()}`;
    await db.insert(fileSchema.files).values({
      id: inputFileId,
      organizationId,
      requestId: randomUUIDv7(),
      state: "ready",
      name: "input.png",
      mediaType: "image/png",
      expectedSizeBytes: 100,
      sizeBytes: 100,
      storageKey: inputStorageKey,
      readyAt: new Date(),
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db
      .delete(backgroundRemovalSchema.backgroundRemovals)
      .where(eq(backgroundRemovalSchema.backgroundRemovals.organizationId, organizationId));
    await db
      .delete(organizationSchema.organizations)
      .where(eq(organizationSchema.organizations.id, organizationId));
  });

  async function create(inputId = inputFileId) {
    const result = await createBackgroundRemoval({
      organizationId,
      requestId: randomUUIDv7(),
      inputFileId: inputId,
    });
    if (!result.ok) throw new Error(result.error.kind);
    return result.value;
  }

  async function remove(id: string) {
    await deleteBackgroundRemoval({ organizationId, backgroundRemovalId: id });
    await cleanDeletedBackgroundRemoval({ backgroundRemovalId: id });
  }

  async function claimPublication() {
    const job = await claimNextBackgroundRemoval({
      organizationId,
      now: new Date(Date.now() + 1000),
    });
    if (!job?.attempt.leaseToken) throw new Error("No job");
    return {
      attemptId: job.attempt.id,
      leaseToken: job.attempt.leaseToken,
      path: "mock.png",
      sizeBytes: 100,
      thumbnails: {
        input: { path: "input-thumbnail.webp", sizeBytes: 20 },
        output: { path: "output-thumbnail.webp", sizeBytes: 30 },
      },
    };
  }

  test("publishes signed previews once and reuses a shared input thumbnail", async () => {
    const first = await create();
    const publication = await claimPublication();
    const output = await publishBackgroundRemovalOutput(publication);
    if (!output.ok) throw new Error(output.error.kind);
    expect(minio.putObjectFromFile).toHaveBeenCalledTimes(3);
    await expect(publishBackgroundRemovalOutput(publication)).resolves.toEqual(output);
    expect(minio.putObjectFromFile).toHaveBeenCalledTimes(3);

    const summary = await getBackgroundRemoval({ organizationId, backgroundRemovalId: first.id });
    if (!summary.ok) throw new Error(summary.error.kind);
    expect(summary.value.input.thumbnailUrl).toContain("input-thumbnail.webp");
    expect(summary.value.output?.thumbnailUrl).toContain("output-thumbnail.webp");
    expect(summary.value.output?.url).toContain("output.png");
    const inputThumbnailKey = output.value.storageKey.replace("output.png", "input-thumbnail.webp");

    const second = await create();
    const secondOutput = await publishBackgroundRemovalOutput(await claimPublication());
    expect(secondOutput.ok).toBe(true);
    expect(minio.putObjectFromFile).toHaveBeenCalledTimes(5);
    await remove(first.id);
    expect(minio.deleteObject).not.toHaveBeenCalledWith({ key: inputThumbnailKey });
    vi.mocked(minio.listObjects).mockResolvedValueOnce({
      objects: [{ key: inputThumbnailKey, lastModified: new Date(0) }],
      nextCursor: undefined,
    });
    await cleanUnreferencedBackgroundRemovalObjects();
    expect(minio.deleteObject).not.toHaveBeenCalledWith({ key: inputThumbnailKey });
    await remove(second.id);
    expect(minio.deleteObject).toHaveBeenCalledWith({ key: inputThumbnailKey });
  });

  test("keeps the successful output when a thumbnail upload fails", async () => {
    const removal = await create();
    const publication = await claimPublication();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(minio.putObjectFromFile)
      .mockResolvedValueOnce(ok(undefined))
      .mockResolvedValueOnce(err({ kind: "PUT_OBJECT_FAILED", cause: new Error("offline") }));
    const output = await publishBackgroundRemovalOutput(publication);
    expect(output.ok).toBe(true);
    const summary = await getBackgroundRemoval({ organizationId, backgroundRemovalId: removal.id });
    if (!summary.ok) throw new Error(summary.error.kind);
    expect(summary.value.status).toBe("ready");
    expect(summary.value.input.thumbnailUrl).toBeUndefined();
    expect(summary.value.output?.thumbnailUrl).toContain("output-thumbnail.webp");
    expect(warning).toHaveBeenCalledOnce();
  });

  test("concurrent removals share one input thumbnail and sweep the unused upload", async () => {
    await create();
    await create();
    const first = await claimPublication();
    const second = await claimPublication();
    const uploads = Promise.withResolvers<void>();
    let arrivals = 0;
    async function upload() {
      if (++arrivals === 2) uploads.resolve();
      await uploads.promise;
      return ok(undefined);
    }
    vi.mocked(minio.putObjectFromFile)
      .mockImplementationOnce(upload)
      .mockImplementationOnce(upload);
    const results = await Promise.all([
      publishBackgroundRemovalOutput(first),
      publishBackgroundRemovalOutput(second),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    const [input] = await db
      .select()
      .from(fileSchema.files)
      .where(eq(fileSchema.files.id, inputFileId));
    expect(input?.thumbnailStorageKey).toBeTruthy();
    const uploadedKeys = vi
      .mocked(minio.putObjectFromFile)
      .mock.calls.map(([options]) => options.key);
    vi.mocked(minio.listObjects).mockResolvedValueOnce({
      objects: uploadedKeys.map((key) => ({ key, lastModified: new Date(0) })),
      nextCursor: undefined,
    });
    await cleanUnreferencedBackgroundRemovalObjects();
    const unused = uploadedKeys.filter(
      (key) => key.endsWith("input-thumbnail.webp") && key !== input?.thumbnailStorageKey,
    );
    expect(unused).toHaveLength(1);
    expect(minio.deleteObject).toHaveBeenCalledExactlyOnceWith({ key: unused[0] });
  });

  test.each(["expired", "deleted"])(
    "does not attach thumbnails if the job is %s during upload",
    async (reason) => {
      const removal = await create();
      const publication = await claimPublication();
      vi.mocked(minio.putObjectFromFile).mockImplementationOnce(async () => {
        if (reason === "deleted") {
          await deleteBackgroundRemoval({ organizationId, backgroundRemovalId: removal.id });
        } else {
          await db
            .update(backgroundRemovalSchema.backgroundRemovalAttempts)
            .set({ leaseExpiresAt: new Date(0) })
            .where(eq(backgroundRemovalSchema.backgroundRemovalAttempts.id, publication.attemptId));
        }
        return ok(undefined);
      });
      await expect(publishBackgroundRemovalOutput(publication)).resolves.toEqual({
        ok: false,
        error: { kind: "LEASE_LOST" },
      });
      const files = await db
        .select()
        .from(fileSchema.files)
        .where(eq(fileSchema.files.organizationId, organizationId));
      expect(files).toHaveLength(1);
      expect(files[0]?.thumbnailStorageKey).toBeNull();

      if (reason === "deleted")
        await cleanDeletedBackgroundRemoval({ backgroundRemovalId: removal.id });
      const uploadedKeys = vi
        .mocked(minio.putObjectFromFile)
        .mock.calls.map(([options]) => options.key);
      vi.mocked(minio.listObjects).mockResolvedValueOnce({
        objects: uploadedKeys.map((key) => ({ key, lastModified: new Date(0) })),
        nextCursor: undefined,
      });
      await cleanUnreferencedBackgroundRemovalObjects();
      for (const key of uploadedKeys) expect(minio.deleteObject).toHaveBeenCalledWith({ key });
    },
  );

  test("keeps a shared input until its last request is deleted", async () => {
    const first = await create();
    const second = await create();
    await remove(first.id);
    expect(
      await db.select().from(fileSchema.files).where(eq(fileSchema.files.id, inputFileId)),
    ).toHaveLength(1);
    expect(minio.deleteObject).not.toHaveBeenCalled();
    await remove(second.id);
    expect(
      await db.select().from(fileSchema.files).where(eq(fileSchema.files.id, inputFileId)),
    ).toHaveLength(0);
    expect(minio.deleteObject).toHaveBeenCalledWith({ key: inputStorageKey });
  });

  test("preserves an output reused as another request's input", async () => {
    const first = await create();
    const job = await claimNextBackgroundRemoval({
      organizationId,
      now: new Date(Date.now() + 1000),
    });
    if (!job?.attempt.leaseToken) throw new Error("No job");
    const output = await publishBackgroundRemovalOutput({
      attemptId: job.attempt.id,
      leaseToken: job.attempt.leaseToken,
      path: "mock.png",
      sizeBytes: 100,
      thumbnails: { output: { path: "thumbnail.webp", sizeBytes: 20 } },
    });
    if (!output.ok) throw new Error(output.error.kind);
    const thumbnailKey = output.value.storageKey.replace("output.png", "output-thumbnail.webp");
    vi.mocked(minio.listObjects).mockResolvedValueOnce({
      objects: [output.value.storageKey, thumbnailKey].map((key) => ({
        key,
        lastModified: new Date(0),
      })),
      nextCursor: undefined,
    });
    await cleanUnreferencedBackgroundRemovalObjects();
    expect(minio.deleteObject).not.toHaveBeenCalled();
    const second = await create(output.value.fileId);
    await remove(first.id);
    expect(minio.deleteObject).not.toHaveBeenCalledWith({ key: output.value.storageKey });
    expect(minio.deleteObject).not.toHaveBeenCalledWith({ key: thumbnailKey });
    await remove(second.id);
    expect(minio.deleteObject).toHaveBeenCalledWith({ key: output.value.storageKey });
    expect(minio.deleteObject).toHaveBeenCalledWith({ key: thumbnailKey });
  });

  test("serializes request creation with cleanup of the same input", async () => {
    const first = await create();
    await deleteBackgroundRemoval({ organizationId, backgroundRemovalId: first.id });
    const [, created] = await Promise.all([
      cleanDeletedBackgroundRemoval({ backgroundRemovalId: first.id }),
      createBackgroundRemoval({ organizationId, requestId: randomUUIDv7(), inputFileId }),
    ]);
    const files = await db
      .select()
      .from(fileSchema.files)
      .where(eq(fileSchema.files.id, inputFileId));
    if (created.ok) {
      expect(files).toHaveLength(1);
      expect(minio.deleteObject).not.toHaveBeenCalledWith({ key: inputStorageKey });
    } else {
      expect(created.error.kind).toBe("INPUT_NOT_FOUND");
      expect(files).toHaveLength(0);
    }
  });

  test("retries failed storage deletion through the orphan sweep", async () => {
    const removal = await create();
    vi.mocked(minio.deleteObject).mockResolvedValueOnce(
      err({ kind: "DELETE_OBJECT_FAILED", cause: new Error("offline") }),
    );
    await remove(removal.id);
    const now = new Date();
    vi.mocked(minio.listObjects).mockResolvedValueOnce({
      objects: [{ key: inputStorageKey, lastModified: new Date(now.getTime() - 3_600_001) }],
      nextCursor: "next-page",
    });
    expect(await cleanUnreferencedBackgroundRemovalObjects({ now })).toBe("next-page");
    expect(minio.deleteObject).toHaveBeenCalledTimes(2);
  });

  test("sweeps orphan uploads but protects live leases, referenced files, and recent objects", async () => {
    const removal = await create();
    const now = new Date(Date.now() + 1000);
    const job = await claimNextBackgroundRemoval({ organizationId, now });
    if (!job?.attempt.leaseToken) throw new Error("No job");
    const prefix = `organizations/${organizationId}/background-removals/${removal.id}/attempts/`;
    const active = `${prefix}${job.attempt.id}/leases/${job.attempt.leaseToken}/output.png`;
    const orphan = `${prefix}${randomUUIDv7()}/leases/${randomUUIDv7()}/output.png`;
    const recent = `${prefix}${randomUUIDv7()}/leases/${randomUUIDv7()}/output.png`;
    const lastModified = new Date(now.getTime() - 3_600_001);
    vi.mocked(minio.listObjects).mockResolvedValueOnce({
      objects: [
        { key: active, lastModified },
        { key: active.replace("output.png", "input-thumbnail.webp"), lastModified },
        { key: active.replace("output.png", "output-thumbnail.webp"), lastModified },
        { key: inputStorageKey, lastModified },
        { key: orphan, lastModified },
        { key: orphan.replace("output.png", "input-thumbnail.webp"), lastModified },
        { key: orphan.replace("output.png", "output-thumbnail.webp"), lastModified },
        { key: recent, lastModified: now },
        { key: recent.replace("output.png", "output-thumbnail.webp"), lastModified: now },
        { key: "unrelated-object", lastModified },
      ],
      nextCursor: undefined,
    });
    await cleanUnreferencedBackgroundRemovalObjects({ now, cursor: "previous-page" });
    expect(minio.listObjects).toHaveBeenCalledWith({
      prefix: "organizations/",
      cursor: "previous-page",
    });
    expect(minio.deleteObject).toHaveBeenCalledTimes(3);
    for (const name of ["output.png", "input-thumbnail.webp", "output-thumbnail.webp"]) {
      expect(minio.deleteObject).toHaveBeenCalledWith({ key: orphan.replace("output.png", name) });
    }
  });
});
