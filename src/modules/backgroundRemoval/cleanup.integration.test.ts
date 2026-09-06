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
  publishBackgroundRemovalOutput,
} from "./backgroundRemovals";

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
    });
    if (!output.ok) throw new Error(output.error.kind);
    vi.mocked(minio.listObjects).mockResolvedValueOnce({
      objects: [{ key: output.value.storageKey, lastModified: new Date(0) }],
      nextCursor: undefined,
    });
    await cleanUnreferencedBackgroundRemovalObjects();
    expect(minio.deleteObject).not.toHaveBeenCalled();
    const second = await create(output.value.fileId);
    await remove(first.id);
    expect(minio.deleteObject).not.toHaveBeenCalledWith({ key: output.value.storageKey });
    await remove(second.id);
    expect(minio.deleteObject).toHaveBeenCalledWith({ key: output.value.storageKey });
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
        { key: inputStorageKey, lastModified },
        { key: orphan, lastModified },
        { key: recent, lastModified: now },
        { key: "unrelated-object", lastModified },
      ],
      nextCursor: undefined,
    });
    await cleanUnreferencedBackgroundRemovalObjects({ now, cursor: "previous-page" });
    expect(minio.listObjects).toHaveBeenCalledWith({
      prefix: "organizations/",
      cursor: "previous-page",
    });
    expect(minio.deleteObject).toHaveBeenCalledExactlyOnceWith({ key: orphan });
  });
});
