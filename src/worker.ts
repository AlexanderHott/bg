import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  claimNextBackgroundRemoval,
  cleanDeletedBackgroundRemoval,
  cleanUnreferencedBackgroundRemovalObjects,
  failBackgroundRemovalAttempt,
  publishBackgroundRemovalOutput,
  recoverExpiredBackgroundRemovalAttempt,
  renewBackgroundRemovalLease,
} from "@/modules/backgroundRemoval/backgroundRemovals";
import {
  BackgroundRemovalImageError,
  createBiRefNetAdapter,
} from "@/modules/backgroundRemoval/modelAdapter";
import { ATTEMPT_LEASE_MS } from "@/modules/backgroundRemoval/policy";
import type { BackgroundRemovalFailureCode } from "@/modules/backgroundRemoval/schema";
import { downloadObjectToFile } from "@/modules/files/minio";

const MODEL_PATH = process.env.BACKGROUND_REMOVAL_MODEL_PATH ?? "/opt/bg/models/birefnet.onnx";
const SCRATCH_ROOT = process.env.BACKGROUND_REMOVAL_SCRATCH_PATH ?? "/tmp/bg";
const READY_FILE = join(SCRATCH_ROOT, "ready");
const IDLE_WAIT_MS = 1_000;
const LEASE_RENEWAL_MS = 15_000;
const CLEANUP_INTERVAL_MS = 60_000;

let stopping = false;
const stopController = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
    stopController.abort();
  });
}

await mkdir(SCRATCH_ROOT, { recursive: true });
await rm(READY_FILE, { force: true });
const adapter = await createBiRefNetAdapter(MODEL_PATH);
await adapter.warmUp();
await writeFile(READY_FILE, "ready\n");

let cleanupCursor: string | undefined;
let nextCleanupAt = 0;
try {
  while (!stopping) {
    while (await cleanDeletedBackgroundRemoval()) {
      if (stopping) break;
    }
    while (await recoverExpiredBackgroundRemovalAttempt()) {
      if (stopping) break;
    }
    if (stopping) break;

    if (Date.now() >= nextCleanupAt) {
      cleanupCursor = await cleanUnreferencedBackgroundRemovalObjects({ cursor: cleanupCursor });
      nextCleanupAt = Date.now() + CLEANUP_INTERVAL_MS;
    }

    const job = await claimNextBackgroundRemoval();
    if (!job) {
      await waitForWork();
      continue;
    }
    await processJob(job);
  }
} finally {
  await rm(READY_FILE, { force: true });
}

async function processJob(
  job: NonNullable<Awaited<ReturnType<typeof claimNextBackgroundRemoval>>>,
) {
  const leaseToken = requireLeaseToken(job.attempt.leaseToken);

  const scratch = await mkdtemp(join(SCRATCH_ROOT, "job-"));
  const inputPath = join(scratch, "input");
  const outputPath = join(scratch, "output.png");
  let leaseLost = false;
  let renewing = false;
  const renewal = setInterval(async () => {
    if (renewing || leaseLost) return;
    renewing = true;
    try {
      const attempt = await renewBackgroundRemovalLease({
        attemptId: job.attempt.id,
        leaseToken,
        leaseMs: ATTEMPT_LEASE_MS,
      });
      if (!attempt) leaseLost = true;
    } catch {
      leaseLost = true;
    } finally {
      renewing = false;
    }
  }, LEASE_RENEWAL_MS);

  try {
    const downloadResult = await downloadObjectToFile({
      key: job.inputFile.storageKey,
      path: inputPath,
    });
    if (!downloadResult.ok) {
      await failIfLeased("storage_failed");
      return;
    }

    let result;
    try {
      result = await adapter.removeBackground(inputPath, outputPath, {
        ...(job.inputFile.thumbnailStorageKey
          ? {}
          : { input: join(scratch, "input-thumbnail.webp") }),
        output: join(scratch, "output-thumbnail.webp"),
      });
    } catch (error) {
      await failIfLeased(
        error instanceof BackgroundRemovalImageError ? error.failureCode : "inference_failed",
      );
      return;
    }
    if (leaseLost) return;

    const outputStat = await stat(outputPath);
    const publication = await publishBackgroundRemovalOutput({
      attemptId: job.attempt.id,
      leaseToken,
      path: outputPath,
      sizeBytes: outputStat.size,
      thumbnails: result.thumbnails,
    });
    if (!publication.ok && publication.error.kind === "STORAGE_FAILED") {
      await failIfLeased("storage_failed");
    }
  } finally {
    clearInterval(renewal);
    await rm(scratch, { recursive: true, force: true });
  }

  async function failIfLeased(failureCode: BackgroundRemovalFailureCode) {
    if (leaseLost) return;
    const result = await failBackgroundRemovalAttempt({
      attemptId: job.attempt.id,
      leaseToken,
      failureCode,
    });
    if (!result.ok) leaseLost = true;
  }
}

function requireLeaseToken(leaseToken: string | null) {
  if (!leaseToken) throw new Error("Claimed attempt has no lease token");
  return leaseToken;
}

async function waitForWork() {
  try {
    await delay(IDLE_WAIT_MS, undefined, { signal: stopController.signal });
  } catch {
    return;
  }
}
