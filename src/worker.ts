import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
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
import { createBiRefNetAdapter } from "@/modules/backgroundRemoval/modelAdapter";
import { ATTEMPT_LEASE_MS } from "@/modules/backgroundRemoval/policy";
import type { BackgroundRemovalFailureCode } from "@/modules/backgroundRemoval/schema";
import { downloadObjectToFile } from "@/modules/files/minio";

const MODEL_PATH = process.env.BACKGROUND_REMOVAL_MODEL_PATH ?? "/opt/bg/models/birefnet.onnx";
const SCRATCH_ROOT = process.env.BACKGROUND_REMOVAL_SCRATCH_PATH ?? "/tmp/bg";
const READY_FILE = join(SCRATCH_ROOT, "ready");
const IDLE_WAIT_MS = 1_000;
const ERROR_WAIT_MS = 5_000;
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
const adapter = await createBiRefNetAdapter({
  modelPath: MODEL_PATH,
  // Built as a sibling entry, so the extension is .ts under tsx and .mjs in production.
  threadUrl: new URL(`./modelThread${extname(import.meta.url)}`, import.meta.url),
});
await writeFile(READY_FILE, "ready\n");

let cleanupCursor: string | undefined;
let nextCleanupAt = 0;
try {
  while (!stopping) {
    try {
      if (!(await runNextStep())) await waitFor(IDLE_WAIT_MS);
    } catch (error) {
      // A claimed job stays leased, so its expiry retries it once storage or the database recover.
      console.error("Background removal worker step failed", error);
      await waitFor(ERROR_WAIT_MS);
    }
  }
} finally {
  await rm(READY_FILE, { force: true });
  await adapter.close();
}

// Returns whether a job ran, so the caller only idles when the queue was empty.
async function runNextStep() {
  while (await cleanDeletedBackgroundRemoval()) {
    if (stopping) return true;
  }
  while (await recoverExpiredBackgroundRemovalAttempt()) {
    if (stopping) return true;
  }

  if (Date.now() >= nextCleanupAt) {
    cleanupCursor = await cleanUnreferencedBackgroundRemovalObjects({ cursor: cleanupCursor });
    nextCleanupAt = Date.now() + CLEANUP_INTERVAL_MS;
  }

  const job = await claimNextBackgroundRemoval();
  if (!job) return false;
  await processJob(job);
  return true;
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
    } catch (error) {
      // Publishing rechecks the lease, so one failed renewal must not abandon the job.
      console.warn("Could not renew background removal lease", {
        attemptId: job.attempt.id,
        error,
      });
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
      console.error("Could not download background removal input", {
        attemptId: job.attempt.id,
        error: downloadResult.error,
      });
      await failIfLeased("storage_failed");
      return;
    }

    const result = await adapter.removeBackground({
      inputPath,
      outputPath,
      thumbnailPaths: {
        ...(job.inputFile.thumbnailStorageKey
          ? {}
          : { input: join(scratch, "input-thumbnail.webp") }),
        output: join(scratch, "output-thumbnail.webp"),
      },
    });
    if (!result.ok) {
      console.error("Background removal failed", { attemptId: job.attempt.id, ...result.error });
      await failIfLeased(result.error.failureCode);
      return;
    }
    if (leaseLost) {
      console.warn("Discarding background removal after losing its lease", {
        attemptId: job.attempt.id,
      });
      return;
    }

    const outputStat = await stat(outputPath);
    const publication = await publishBackgroundRemovalOutput({
      attemptId: job.attempt.id,
      leaseToken,
      path: outputPath,
      sizeBytes: outputStat.size,
      thumbnails: result.value.thumbnails,
    });
    if (!publication.ok) {
      console.warn("Could not publish background removal", {
        attemptId: job.attempt.id,
        error: publication.error.kind,
      });
      if (publication.error.kind === "STORAGE_FAILED") await failIfLeased("storage_failed");
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

async function waitFor(ms: number) {
  try {
    await delay(ms, undefined, { signal: stopController.signal });
  } catch {
    return;
  }
}
