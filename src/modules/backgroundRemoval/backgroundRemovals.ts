import { randomUUIDv7 } from "node:crypto";

import { and, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { err, ok, type Result } from "@/lib/result";
import { getReadyImages, type ReadyImage } from "@/modules/files/files";
import { isSupportedImageMediaType } from "@/modules/files/images";
import * as minio from "@/modules/files/minio";
import * as fileSchema from "@/modules/files/schema";

import {
  ATTEMPT_LEASE_MS,
  BACKGROUND_REMOVAL_MODEL_ID,
  isRetryableFailure,
  MAX_AUTOMATIC_ATTEMPTS,
  MAX_BACKGROUND_REMOVAL_INPUT_SIZE_BYTES,
  retryDelayMs,
} from "./policy";
import * as backgroundRemovalSchema from "./schema";

export type BackgroundRemovalViewStatus = "queued" | "processing" | "ready" | "retrying" | "failed";

export type BackgroundRemovalSummary = {
  id: string;
  requestId: string;
  modelId: string;
  status: BackgroundRemovalViewStatus;
  failureCode?: backgroundRemovalSchema.BackgroundRemovalFailureCode;
  input: ReadyImage;
  output?: ReadyImage;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
};

export type BackgroundRemovalError =
  | { kind: "INPUT_NOT_FOUND" }
  | { kind: "INPUT_NOT_READY" }
  | { kind: "UNSUPPORTED_IMAGE" }
  | { kind: "IMAGE_TOO_LARGE" }
  | { kind: "REQUEST_CONFLICT" }
  | { kind: "BACKGROUND_REMOVAL_NOT_FOUND" }
  | { kind: "RETRY_NOT_ALLOWED" }
  | { kind: "LEASE_LOST" };

export type BackgroundRemovalCursor = {
  createdAt: string;
  id: string;
};

export async function createBackgroundRemoval(options: {
  organizationId: string;
  requestId: string;
  inputFileId: string;
}): Promise<Result<BackgroundRemovalSummary, BackgroundRemovalError>> {
  const transactionResult = await db.transaction(async (tx) => {
    const [inputFile] = await tx
      .select()
      .from(fileSchema.files)
      .where(
        and(
          eq(fileSchema.files.organizationId, options.organizationId),
          eq(fileSchema.files.id, options.inputFileId),
        ),
      )
      .for("key share")
      .limit(1);

    if (!inputFile) return err({ kind: "INPUT_NOT_FOUND" } as const);
    if (inputFile.state !== "ready") return err({ kind: "INPUT_NOT_READY" } as const);
    if (!isSupportedImageMediaType(inputFile.mediaType)) {
      return err({ kind: "UNSUPPORTED_IMAGE" } as const);
    }
    if (inputFile.expectedSizeBytes > MAX_BACKGROUND_REMOVAL_INPUT_SIZE_BYTES) {
      return err({ kind: "IMAGE_TOO_LARGE" } as const);
    }

    const backgroundRemovalId = randomUUIDv7();
    const [created] = await tx
      .insert(backgroundRemovalSchema.backgroundRemovals)
      .values({
        id: backgroundRemovalId,
        organizationId: options.organizationId,
        requestId: options.requestId,
        inputFileId: options.inputFileId,
        modelId: BACKGROUND_REMOVAL_MODEL_ID,
      })
      .onConflictDoNothing({
        target: [
          backgroundRemovalSchema.backgroundRemovals.organizationId,
          backgroundRemovalSchema.backgroundRemovals.requestId,
        ],
      })
      .returning();

    if (!created) {
      const [existing] = await tx
        .select()
        .from(backgroundRemovalSchema.backgroundRemovals)
        .where(
          and(
            eq(backgroundRemovalSchema.backgroundRemovals.organizationId, options.organizationId),
            eq(backgroundRemovalSchema.backgroundRemovals.requestId, options.requestId),
          ),
        )
        .limit(1);

      if (
        !existing ||
        existing.deletedAt !== null ||
        existing.inputFileId !== options.inputFileId ||
        existing.modelId !== BACKGROUND_REMOVAL_MODEL_ID
      ) {
        return err({ kind: "REQUEST_CONFLICT" } as const);
      }
      return ok(existing.id);
    }

    const seriesId = randomUUIDv7();
    await tx.insert(backgroundRemovalSchema.backgroundRemovalAttempts).values({
      id: randomUUIDv7(),
      backgroundRemovalId,
      organizationId: options.organizationId,
      seriesId,
      sequence: 1,
    });
    return ok(backgroundRemovalId);
  });

  if (!transactionResult.ok) return transactionResult;
  const result = await getBackgroundRemoval({
    organizationId: options.organizationId,
    backgroundRemovalId: transactionResult.value,
  });
  if (!result.ok) throw new Error("Created background removal could not be loaded");
  return result;
}

export async function listBackgroundRemovals(options: {
  organizationId: string;
  cursor?: BackgroundRemovalCursor;
  limit?: number;
}) {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 20);
  const cursorDate = options.cursor && new Date(options.cursor.createdAt);
  const cursorCondition =
    options.cursor && cursorDate
      ? or(
          lt(backgroundRemovalSchema.backgroundRemovals.createdAt, cursorDate),
          and(
            eq(backgroundRemovalSchema.backgroundRemovals.createdAt, cursorDate),
            lt(backgroundRemovalSchema.backgroundRemovals.id, options.cursor.id),
          ),
        )
      : undefined;

  const removals = await db
    .select()
    .from(backgroundRemovalSchema.backgroundRemovals)
    .where(
      and(
        eq(backgroundRemovalSchema.backgroundRemovals.organizationId, options.organizationId),
        isNull(backgroundRemovalSchema.backgroundRemovals.deletedAt),
        cursorCondition,
      ),
    )
    .orderBy(
      desc(backgroundRemovalSchema.backgroundRemovals.createdAt),
      desc(backgroundRemovalSchema.backgroundRemovals.id),
    )
    .limit(limit + 1);

  const page = removals.slice(0, limit);
  const items = await hydrateSummaries(options.organizationId, page);
  const last = page.at(-1);
  return {
    items,
    nextCursor:
      removals.length > limit && last
        ? { createdAt: last.createdAt.toISOString(), id: last.id }
        : undefined,
  };
}

export async function getBackgroundRemoval(options: {
  organizationId: string;
  backgroundRemovalId: string;
}): Promise<Result<BackgroundRemovalSummary, BackgroundRemovalError>> {
  const [removal] = await db
    .select()
    .from(backgroundRemovalSchema.backgroundRemovals)
    .where(
      and(
        eq(backgroundRemovalSchema.backgroundRemovals.organizationId, options.organizationId),
        eq(backgroundRemovalSchema.backgroundRemovals.id, options.backgroundRemovalId),
        isNull(backgroundRemovalSchema.backgroundRemovals.deletedAt),
      ),
    )
    .limit(1);
  if (!removal) return err({ kind: "BACKGROUND_REMOVAL_NOT_FOUND" });

  const [summary] = await hydrateSummaries(options.organizationId, [removal]);
  if (!summary) throw new Error("Background removal has no attempt");
  return ok(summary);
}

export async function retryBackgroundRemoval(options: {
  organizationId: string;
  backgroundRemovalId: string;
}): Promise<Result<BackgroundRemovalSummary, BackgroundRemovalError>> {
  const result = await db.transaction(async (tx) => {
    const [removal] = await tx
      .select()
      .from(backgroundRemovalSchema.backgroundRemovals)
      .where(
        and(
          eq(backgroundRemovalSchema.backgroundRemovals.organizationId, options.organizationId),
          eq(backgroundRemovalSchema.backgroundRemovals.id, options.backgroundRemovalId),
          isNull(backgroundRemovalSchema.backgroundRemovals.deletedAt),
        ),
      )
      .for("update")
      .limit(1);
    if (!removal) return err({ kind: "BACKGROUND_REMOVAL_NOT_FOUND" } as const);

    const [latestAttempt] = await tx
      .select()
      .from(backgroundRemovalSchema.backgroundRemovalAttempts)
      .where(eq(backgroundRemovalSchema.backgroundRemovalAttempts.backgroundRemovalId, removal.id))
      .orderBy(
        desc(backgroundRemovalSchema.backgroundRemovalAttempts.createdAt),
        desc(backgroundRemovalSchema.backgroundRemovalAttempts.id),
      )
      .limit(1);

    if (
      !latestAttempt ||
      latestAttempt.status !== "failed" ||
      !latestAttempt.failureCode ||
      !isRetryableFailure(latestAttempt.failureCode)
    ) {
      return err({ kind: "RETRY_NOT_ALLOWED" } as const);
    }

    await tx.insert(backgroundRemovalSchema.backgroundRemovalAttempts).values({
      id: randomUUIDv7(),
      backgroundRemovalId: removal.id,
      organizationId: removal.organizationId,
      seriesId: randomUUIDv7(),
      sequence: 1,
    });
    return ok(undefined);
  });

  if (!result.ok) return result;
  return getBackgroundRemoval(options);
}

export async function deleteBackgroundRemoval(options: {
  organizationId: string;
  backgroundRemovalId: string;
  now?: Date;
}): Promise<Result<undefined, BackgroundRemovalError>> {
  return db.transaction(async (tx) => {
    const [removal] = await tx
      .update(backgroundRemovalSchema.backgroundRemovals)
      .set({ deletedAt: options.now ?? new Date() })
      .where(
        and(
          eq(backgroundRemovalSchema.backgroundRemovals.organizationId, options.organizationId),
          eq(backgroundRemovalSchema.backgroundRemovals.id, options.backgroundRemovalId),
          isNull(backgroundRemovalSchema.backgroundRemovals.deletedAt),
        ),
      )
      .returning();
    if (!removal) return err({ kind: "BACKGROUND_REMOVAL_NOT_FOUND" } as const);

    return ok(undefined);
  });
}

export async function claimNextBackgroundRemoval(options?: {
  now?: Date;
  leaseMs?: number;
  organizationId?: string;
}) {
  const now = options?.now ?? new Date();
  const leaseToken = randomUUIDv7();
  const leaseExpiresAt = new Date(now.getTime() + (options?.leaseMs ?? ATTEMPT_LEASE_MS));

  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({
        attempt: backgroundRemovalSchema.backgroundRemovalAttempts,
        removal: backgroundRemovalSchema.backgroundRemovals,
        inputFile: fileSchema.files,
      })
      .from(backgroundRemovalSchema.backgroundRemovalAttempts)
      .innerJoin(
        backgroundRemovalSchema.backgroundRemovals,
        eq(
          backgroundRemovalSchema.backgroundRemovals.id,
          backgroundRemovalSchema.backgroundRemovalAttempts.backgroundRemovalId,
        ),
      )
      .innerJoin(
        fileSchema.files,
        eq(fileSchema.files.id, backgroundRemovalSchema.backgroundRemovals.inputFileId),
      )
      .where(
        and(
          eq(backgroundRemovalSchema.backgroundRemovalAttempts.status, "queued"),
          lte(backgroundRemovalSchema.backgroundRemovalAttempts.nextEligibleAt, now),
          isNull(backgroundRemovalSchema.backgroundRemovals.deletedAt),
          options?.organizationId
            ? eq(
                backgroundRemovalSchema.backgroundRemovalAttempts.organizationId,
                options.organizationId,
              )
            : undefined,
        ),
      )
      .orderBy(
        backgroundRemovalSchema.backgroundRemovalAttempts.nextEligibleAt,
        backgroundRemovalSchema.backgroundRemovalAttempts.createdAt,
        backgroundRemovalSchema.backgroundRemovalAttempts.id,
      )
      .for("update", {
        of: backgroundRemovalSchema.backgroundRemovalAttempts,
        skipLocked: true,
      })
      .limit(1);
    if (!candidate) return undefined;

    const [attempt] = await tx
      .update(backgroundRemovalSchema.backgroundRemovalAttempts)
      .set({
        status: "processing",
        leaseToken,
        leaseExpiresAt,
        startedAt: now,
      })
      .where(
        and(
          eq(backgroundRemovalSchema.backgroundRemovalAttempts.id, candidate.attempt.id),
          eq(backgroundRemovalSchema.backgroundRemovalAttempts.status, "queued"),
        ),
      )
      .returning();
    if (!attempt) return undefined;

    return {
      attempt,
      removal: candidate.removal,
      inputFile: candidate.inputFile,
    };
  });
}

export async function renewBackgroundRemovalLease(options: {
  attemptId: string;
  leaseToken: string;
  now?: Date;
  leaseMs?: number;
}) {
  const now = options.now ?? new Date();
  const [attempt] = await db
    .update(backgroundRemovalSchema.backgroundRemovalAttempts)
    .set({ leaseExpiresAt: new Date(now.getTime() + (options.leaseMs ?? ATTEMPT_LEASE_MS)) })
    .where(
      and(
        eq(backgroundRemovalSchema.backgroundRemovalAttempts.id, options.attemptId),
        eq(backgroundRemovalSchema.backgroundRemovalAttempts.status, "processing"),
        eq(backgroundRemovalSchema.backgroundRemovalAttempts.leaseToken, options.leaseToken),
        gt(backgroundRemovalSchema.backgroundRemovalAttempts.leaseExpiresAt, now),
      ),
    )
    .returning();
  return attempt;
}

export async function completeBackgroundRemovalAttempt(options: {
  attemptId: string;
  leaseToken: string;
  outputFileId: string;
  now?: Date;
}): Promise<Result<undefined, BackgroundRemovalError>> {
  const now = options.now ?? new Date();
  const result = await db.transaction(async (tx) => {
    const [attempt] = await tx
      .update(backgroundRemovalSchema.backgroundRemovalAttempts)
      .set({ status: "ready", outputFileId: options.outputFileId, completedAt: now })
      .where(
        and(
          eq(backgroundRemovalSchema.backgroundRemovalAttempts.id, options.attemptId),
          eq(backgroundRemovalSchema.backgroundRemovalAttempts.status, "processing"),
          eq(backgroundRemovalSchema.backgroundRemovalAttempts.leaseToken, options.leaseToken),
          gt(backgroundRemovalSchema.backgroundRemovalAttempts.leaseExpiresAt, now),
        ),
      )
      .returning();
    if (!attempt) return err({ kind: "LEASE_LOST" } as const);

    return ok(undefined);
  });
  return result;
}

export async function failBackgroundRemovalAttempt(options: {
  attemptId: string;
  leaseToken: string;
  failureCode: backgroundRemovalSchema.BackgroundRemovalFailureCode;
  now?: Date;
  random?: () => number;
}): Promise<Result<undefined, BackgroundRemovalError>> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const [attempt] = await tx
      .update(backgroundRemovalSchema.backgroundRemovalAttempts)
      .set({ status: "failed", failureCode: options.failureCode, completedAt: now })
      .where(
        and(
          eq(backgroundRemovalSchema.backgroundRemovalAttempts.id, options.attemptId),
          eq(backgroundRemovalSchema.backgroundRemovalAttempts.status, "processing"),
          eq(backgroundRemovalSchema.backgroundRemovalAttempts.leaseToken, options.leaseToken),
          gt(backgroundRemovalSchema.backgroundRemovalAttempts.leaseExpiresAt, now),
        ),
      )
      .returning();
    if (!attempt) return err({ kind: "LEASE_LOST" } as const);

    await enqueueAutomaticRetry(tx, attempt, options.failureCode, now, options.random);
    return ok(undefined);
  });
}

export async function recoverExpiredBackgroundRemovalAttempt(options?: {
  now?: Date;
  random?: () => number;
  organizationId?: string;
}) {
  const now = options?.now ?? new Date();
  return db.transaction(async (tx) => {
    const [attempt] = await tx
      .select()
      .from(backgroundRemovalSchema.backgroundRemovalAttempts)
      .where(
        and(
          eq(backgroundRemovalSchema.backgroundRemovalAttempts.status, "processing"),
          lte(backgroundRemovalSchema.backgroundRemovalAttempts.leaseExpiresAt, now),
          options?.organizationId
            ? eq(
                backgroundRemovalSchema.backgroundRemovalAttempts.organizationId,
                options.organizationId,
              )
            : undefined,
        ),
      )
      .orderBy(
        backgroundRemovalSchema.backgroundRemovalAttempts.leaseExpiresAt,
        backgroundRemovalSchema.backgroundRemovalAttempts.id,
      )
      .for("update", { skipLocked: true })
      .limit(1);
    if (!attempt) return undefined;

    const [failedAttempt] = await tx
      .update(backgroundRemovalSchema.backgroundRemovalAttempts)
      .set({ status: "failed", failureCode: "worker_lost", completedAt: now })
      .where(
        and(
          eq(backgroundRemovalSchema.backgroundRemovalAttempts.id, attempt.id),
          eq(backgroundRemovalSchema.backgroundRemovalAttempts.status, "processing"),
          lte(backgroundRemovalSchema.backgroundRemovalAttempts.leaseExpiresAt, now),
        ),
      )
      .returning();
    if (!failedAttempt) return undefined;

    await enqueueAutomaticRetry(tx, failedAttempt, "worker_lost", now, options?.random);
    return failedAttempt;
  });
}

export async function publishBackgroundRemovalOutput(options: {
  attemptId: string;
  leaseToken: string;
  path: string;
  sizeBytes: number;
  now?: Date;
}): Promise<
  Result<{ fileId: string; storageKey: string }, { kind: "LEASE_LOST" | "STORAGE_FAILED" }>
> {
  const [leasedAttempt] = await db
    .select()
    .from(backgroundRemovalSchema.backgroundRemovalAttempts)
    .where(eq(backgroundRemovalSchema.backgroundRemovalAttempts.id, options.attemptId))
    .limit(1);
  if (!leasedAttempt || leasedAttempt.leaseToken !== options.leaseToken) {
    return err({ kind: "LEASE_LOST" });
  }
  if (leasedAttempt.status === "ready" && leasedAttempt.outputFileId) {
    const [file] = await db
      .select({ id: fileSchema.files.id, storageKey: fileSchema.files.storageKey })
      .from(fileSchema.files)
      .where(eq(fileSchema.files.id, leasedAttempt.outputFileId))
      .limit(1);
    if (!file) throw new Error("Ready attempt references a missing output file");
    return ok({ fileId: file.id, storageKey: file.storageKey });
  }
  if (
    leasedAttempt.status !== "processing" ||
    !leasedAttempt.leaseExpiresAt ||
    leasedAttempt.leaseExpiresAt <= (options.now ?? new Date())
  ) {
    return err({ kind: "LEASE_LOST" });
  }

  const storageKey = createOutputStorageKey(leasedAttempt, options.leaseToken);
  const uploadResult = await minio.putObjectFromFile({
    key: storageKey,
    path: options.path,
    sizeBytes: options.sizeBytes,
    mediaType: "image/png",
  });
  if (!uploadResult.ok) return err({ kind: "STORAGE_FAILED" });

  const fileId = randomUUIDv7();
  return db.transaction(async (tx) => {
    const [attempt] = await tx
      .select()
      .from(backgroundRemovalSchema.backgroundRemovalAttempts)
      .where(eq(backgroundRemovalSchema.backgroundRemovalAttempts.id, options.attemptId))
      .for("update")
      .limit(1);
    const completedAt = options.now ?? new Date();

    if (
      !attempt ||
      attempt.status !== "processing" ||
      attempt.leaseToken !== options.leaseToken ||
      !attempt.leaseExpiresAt ||
      attempt.leaseExpiresAt <= completedAt
    ) {
      return err({ kind: "LEASE_LOST" } as const);
    }

    const [removal] = await tx
      .select({
        inputName: fileSchema.files.name,
        deletedAt: backgroundRemovalSchema.backgroundRemovals.deletedAt,
      })
      .from(backgroundRemovalSchema.backgroundRemovals)
      .innerJoin(
        fileSchema.files,
        eq(fileSchema.files.id, backgroundRemovalSchema.backgroundRemovals.inputFileId),
      )
      .where(eq(backgroundRemovalSchema.backgroundRemovals.id, attempt.backgroundRemovalId))
      .for("share", { of: backgroundRemovalSchema.backgroundRemovals })
      .limit(1);
    if (!removal) throw new Error("Background removal input disappeared");
    if (removal.deletedAt) return err({ kind: "LEASE_LOST" } as const);

    await tx.insert(fileSchema.files).values({
      id: fileId,
      organizationId: attempt.organizationId,
      requestId: options.leaseToken,
      state: "ready",
      name: outputFileName(removal.inputName),
      mediaType: "image/png",
      expectedSizeBytes: options.sizeBytes,
      sizeBytes: options.sizeBytes,
      storageKey,
      readyAt: completedAt,
    });

    const [completedAttempt] = await tx
      .update(backgroundRemovalSchema.backgroundRemovalAttempts)
      .set({ status: "ready", outputFileId: fileId, completedAt })
      .where(
        and(
          eq(backgroundRemovalSchema.backgroundRemovalAttempts.id, attempt.id),
          eq(backgroundRemovalSchema.backgroundRemovalAttempts.status, "processing"),
          eq(backgroundRemovalSchema.backgroundRemovalAttempts.leaseToken, options.leaseToken),
        ),
      )
      .returning();
    if (!completedAttempt) throw new Error("Leased attempt changed while locked");

    return ok({ fileId, storageKey });
  });
}

// Delete durable references first. A failed object deletion is retried by the orphan sweep.
export async function cleanDeletedBackgroundRemoval(options?: { backgroundRemovalId?: string }) {
  const deletedFiles = await db.transaction(async (tx) => {
    const [removal] = await tx
      .select()
      .from(backgroundRemovalSchema.backgroundRemovals)
      .where(
        and(
          sql`${backgroundRemovalSchema.backgroundRemovals.deletedAt} is not null`,
          options?.backgroundRemovalId
            ? eq(backgroundRemovalSchema.backgroundRemovals.id, options.backgroundRemovalId)
            : undefined,
        ),
      )
      .orderBy(
        backgroundRemovalSchema.backgroundRemovals.deletedAt,
        backgroundRemovalSchema.backgroundRemovals.id,
      )
      .limit(1);
    if (!removal) return undefined;

    const attempts = await tx
      .select()
      .from(backgroundRemovalSchema.backgroundRemovalAttempts)
      .where(eq(backgroundRemovalSchema.backgroundRemovalAttempts.backgroundRemovalId, removal.id));
    const fileIds = [
      removal.inputFileId,
      ...attempts.flatMap((attempt) => (attempt.outputFileId ? [attempt.outputFileId] : [])),
    ];
    // File locks serialize cleanup with creation of requests that reuse an input.
    const files = await tx
      .select()
      .from(fileSchema.files)
      .where(inArray(fileSchema.files.id, fileIds))
      .orderBy(fileSchema.files.id)
      .for("update");

    await tx
      .select()
      .from(backgroundRemovalSchema.backgroundRemovalAttempts)
      .where(eq(backgroundRemovalSchema.backgroundRemovalAttempts.backgroundRemovalId, removal.id))
      .orderBy(backgroundRemovalSchema.backgroundRemovalAttempts.id)
      .for("update");

    const [deleted] = await tx
      .delete(backgroundRemovalSchema.backgroundRemovals)
      .where(eq(backgroundRemovalSchema.backgroundRemovals.id, removal.id))
      .returning();
    if (!deleted) return undefined;

    const unreferenced = [];
    for (const file of files) {
      const [inputReference] = await tx
        .select({ id: backgroundRemovalSchema.backgroundRemovals.id })
        .from(backgroundRemovalSchema.backgroundRemovals)
        .where(eq(backgroundRemovalSchema.backgroundRemovals.inputFileId, file.id))
        .limit(1);
      const [outputReference] = await tx
        .select({ id: backgroundRemovalSchema.backgroundRemovalAttempts.id })
        .from(backgroundRemovalSchema.backgroundRemovalAttempts)
        .where(eq(backgroundRemovalSchema.backgroundRemovalAttempts.outputFileId, file.id))
        .limit(1);
      if (inputReference || outputReference) continue;
      await tx.delete(fileSchema.files).where(eq(fileSchema.files.id, file.id));
      unreferenced.push(file);
    }
    return unreferenced;
  });
  if (!deletedFiles) return false;
  for (const file of deletedFiles) await minio.deleteObject({ key: file.storageKey });
  return true;
}

// Sweep one bounded page, including objects left by a worker killed before publication.
export async function cleanUnreferencedBackgroundRemovalObjects(options?: {
  cursor?: string;
  now?: Date;
}) {
  const now = options?.now ?? new Date();
  const oldestAllowed = new Date(now.getTime() - 60 * 60 * 1_000);
  const page = await minio.listObjects({ prefix: "organizations/", cursor: options?.cursor });
  for (const object of page.objects) {
    if (object.lastModified > oldestAllowed) continue;
    const output =
      /^organizations\/[^/]+\/background-removals\/[^/]+\/attempts\/([^/]+)\/leases\/([^/]+)\/output\.png$/.exec(
        object.key,
      );
    const input = /^organizations\/[^/]+\/files\/[^/]+\/attempts\/[^/]+$/.test(object.key);
    if (!output && !input) continue;

    await db.transaction(async (tx) => {
      if (output) {
        const [attempt] = await tx
          .select()
          .from(backgroundRemovalSchema.backgroundRemovalAttempts)
          .where(eq(backgroundRemovalSchema.backgroundRemovalAttempts.id, output[1]))
          .for("update")
          .limit(1);
        if (
          attempt?.status === "processing" &&
          attempt.leaseToken === output[2] &&
          attempt.leaseExpiresAt &&
          attempt.leaseExpiresAt > now
        )
          return;
      }
      const [file] = await tx
        .select({ id: fileSchema.files.id })
        .from(fileSchema.files)
        .where(eq(fileSchema.files.storageKey, object.key))
        .limit(1);
      if (!file) await minio.deleteObject({ key: object.key });
    });
  }
  return page.nextCursor;
}

async function hydrateSummaries(
  organizationId: string,
  removals: ReadonlyArray<backgroundRemovalSchema.BackgroundRemoval>,
) {
  if (removals.length === 0) return [];

  const attempts = await db
    .select()
    .from(backgroundRemovalSchema.backgroundRemovalAttempts)
    .where(
      inArray(
        backgroundRemovalSchema.backgroundRemovalAttempts.backgroundRemovalId,
        removals.map((removal) => removal.id),
      ),
    )
    .orderBy(
      desc(backgroundRemovalSchema.backgroundRemovalAttempts.createdAt),
      desc(backgroundRemovalSchema.backgroundRemovalAttempts.id),
    );

  const attemptsByRemoval = new Map<
    string,
    Array<backgroundRemovalSchema.BackgroundRemovalAttempt>
  >();
  for (const attempt of attempts) {
    const current = attemptsByRemoval.get(attempt.backgroundRemovalId) ?? [];
    current.push(attempt);
    attemptsByRemoval.set(attempt.backgroundRemovalId, current);
  }

  const fileIds = removals.flatMap((removal) => {
    const latestAttempt = attemptsByRemoval.get(removal.id)?.[0];
    return latestAttempt?.outputFileId
      ? [removal.inputFileId, latestAttempt.outputFileId]
      : [removal.inputFileId];
  });
  const images = await getReadyImages({ organizationId, fileIds });
  const imagesById = new Map(images.map((image) => [image.id, image]));

  return removals.map((removal) => {
    const removalAttempts = attemptsByRemoval.get(removal.id);
    const latestAttempt = removalAttempts?.[0];
    const input = imagesById.get(removal.inputFileId);
    if (!latestAttempt || !input) {
      throw new Error("Background removal references missing state");
    }

    const status = toViewStatus(latestAttempt, removalAttempts.length);
    return {
      id: removal.id,
      requestId: removal.requestId,
      modelId: removal.modelId,
      status,
      ...(latestAttempt.failureCode ? { failureCode: latestAttempt.failureCode } : {}),
      input,
      ...(latestAttempt.outputFileId ? { output: imagesById.get(latestAttempt.outputFileId) } : {}),
      createdAt: removal.createdAt,
      ...(latestAttempt.startedAt ? { startedAt: latestAttempt.startedAt } : {}),
      ...(latestAttempt.completedAt ? { completedAt: latestAttempt.completedAt } : {}),
    } satisfies BackgroundRemovalSummary;
  });
}

function createOutputStorageKey(
  attempt: backgroundRemovalSchema.BackgroundRemovalAttempt,
  leaseToken: string,
) {
  return `organizations/${attempt.organizationId}/background-removals/${attempt.backgroundRemovalId}/attempts/${attempt.id}/leases/${leaseToken}/output.png`;
}

function outputFileName(inputName: string) {
  const baseName =
    inputName
      .replace(/\.[^.]*$/, "")
      .slice(0, 220)
      .trim() || "image";
  return `${baseName}-background-removed.png`;
}

function toViewStatus(
  attempt: backgroundRemovalSchema.BackgroundRemovalAttempt,
  attemptCount: number,
): BackgroundRemovalViewStatus {
  if (attempt.status === "queued" && attemptCount > 1) return "retrying";
  return attempt.status;
}

async function enqueueAutomaticRetry(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  attempt: backgroundRemovalSchema.BackgroundRemovalAttempt,
  failureCode: backgroundRemovalSchema.BackgroundRemovalFailureCode,
  now: Date,
  random?: () => number,
) {
  if (attempt.sequence >= MAX_AUTOMATIC_ATTEMPTS || !isRetryableFailure(failureCode)) return;

  await tx.insert(backgroundRemovalSchema.backgroundRemovalAttempts).values({
    id: randomUUIDv7(),
    backgroundRemovalId: attempt.backgroundRemovalId,
    organizationId: attempt.organizationId,
    seriesId: attempt.seriesId,
    sequence: attempt.sequence + 1,
    nextEligibleAt: new Date(now.getTime() + retryDelayMs(attempt.sequence, random)),
  });
}
