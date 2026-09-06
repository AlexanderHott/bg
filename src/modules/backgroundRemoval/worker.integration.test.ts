import { randomUUIDv7 } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { desc, eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

import { db } from "@/db";
import * as minio from "@/modules/files/minio";
import * as fileSchema from "@/modules/files/schema";
import * as organizationSchema from "@/modules/organizations/schema";

import { createBackgroundRemoval } from "./backgroundRemovals";
import * as backgroundRemovalSchema from "./schema";

const runWorkerTest = process.env.RUN_WORKER_INTEGRATION === "1";
const organizationId = randomUUIDv7();
const inputFileId = randomUUIDv7();
const inputRequestId = randomUUIDv7();
const removalRequestId = randomUUIDv7();
const inputStorageKey = `tests/${organizationId}/input.png`;
let outputStorageKey: string | undefined;
let scratch: string;

describe.runIf(runWorkerTest)("background-removal worker", () => {
  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "bg-worker-integration-"));
    const inputPath = join(scratch, "input.png");
    await sharp({
      create: {
        width: 48,
        height: 32,
        channels: 4,
        background: { r: 220, g: 80, b: 40, alpha: 0.75 },
      },
    })
      .png()
      .toFile(inputPath);
    const inputStat = await stat(inputPath);

    const upload = await minio.putObjectFromFile({
      key: inputStorageKey,
      path: inputPath,
      sizeBytes: inputStat.size,
      mediaType: "image/png",
    });
    if (!upload.ok) throw new Error("Could not upload worker test input");

    await db.insert(organizationSchema.organizations).values({
      id: organizationId,
      name: "Background removal worker test",
      slug: `background-removal-worker-${organizationId}`,
    });
    await db.insert(fileSchema.files).values({
      id: inputFileId,
      organizationId,
      requestId: inputRequestId,
      state: "ready",
      name: "input.png",
      mediaType: "image/png",
      expectedSizeBytes: inputStat.size,
      sizeBytes: inputStat.size,
      storageKey: inputStorageKey,
      readyAt: new Date(),
    });
  });

  afterAll(async () => {
    await db
      .delete(backgroundRemovalSchema.backgroundRemovals)
      .where(eq(backgroundRemovalSchema.backgroundRemovals.organizationId, organizationId));
    await db
      .delete(organizationSchema.organizations)
      .where(eq(organizationSchema.organizations.id, organizationId));
    await minio.deleteObject({ key: inputStorageKey });
    if (outputStorageKey) await minio.deleteObject({ key: outputStorageKey });
    if (scratch) await rm(scratch, { recursive: true, force: true });
  });

  test("publishes an oriented RGBA PNG at the input dimensions", async () => {
    const created = await createBackgroundRemoval({
      organizationId,
      requestId: removalRequestId,
      inputFileId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("Background removal was not created");

    const attempt = await waitForResult(created.value.id);
    expect(attempt.status).toBe("ready");
    expect(attempt.outputFileId).not.toBeNull();
    if (!attempt.outputFileId) throw new Error("Ready attempt has no output file");

    const [outputFile] = await db
      .select()
      .from(fileSchema.files)
      .where(eq(fileSchema.files.id, attempt.outputFileId))
      .limit(1);
    if (!outputFile) throw new Error("Published output file disappeared");
    outputStorageKey = outputFile.storageKey;

    const outputPath = join(scratch, "output.png");
    const download = await minio.downloadObjectToFile({
      key: outputFile.storageKey,
      path: outputPath,
    });
    if (!download.ok) throw new Error("Could not download worker test output");

    const metadata = await sharp(outputPath).metadata();
    expect(metadata).toMatchObject({
      format: "png",
      width: 48,
      height: 32,
      hasAlpha: true,
    });
  }, 120_000);
});

async function waitForResult(backgroundRemovalId: string) {
  const deadline = Date.now() + 110_000;
  while (Date.now() < deadline) {
    const [attempt] = await db
      .select()
      .from(backgroundRemovalSchema.backgroundRemovalAttempts)
      .where(
        eq(
          backgroundRemovalSchema.backgroundRemovalAttempts.backgroundRemovalId,
          backgroundRemovalId,
        ),
      )
      .orderBy(
        desc(backgroundRemovalSchema.backgroundRemovalAttempts.createdAt),
        desc(backgroundRemovalSchema.backgroundRemovalAttempts.id),
      )
      .limit(1);
    if (attempt?.status === "ready") return attempt;
    if (attempt?.status === "failed") {
      throw new Error(`Worker failed with ${attempt.failureCode ?? "no failure code"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Worker did not finish before the test deadline");
}
