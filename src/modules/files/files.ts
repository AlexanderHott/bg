import { randomUUIDv7 } from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { err, ok, tryAsync, type Result } from "@/lib/result";

import { isSupportedImageMediaType, SUPPORTED_IMAGE_MEDIA_TYPES } from "./images";
import * as minio from "./minio";
import * as fileSchema from "./schema";

const PART_SIZE_BYTES = 16 * 1024 * 1024;
const MAX_FILE_SIZE_BYTES = 2_000_000_000;
const MAX_PARTS = 10_000;
const UPLOAD_LIFETIME_MS = 24 * 60 * 60 * 1000;

type FileWithUpload = {
  file: fileSchema.File;
  upload: fileSchema.FileUpload | null;
};

export interface ReadyFile {
  id: string;
  organizationId: string;
  name: string;
  mediaType: string;
  sizeBytes: number;
  createdAt: Date;
}

export interface ReadyImage extends ReadyFile {
  url: string;
}

export async function listReadyImages(options: {
  organizationId: string;
}): Promise<Array<ReadyImage>> {
  const files = await db
    .select()
    .from(fileSchema.files)
    .where(
      and(
        eq(fileSchema.files.organizationId, options.organizationId),
        eq(fileSchema.files.state, "ready"),
        inArray(fileSchema.files.mediaType, SUPPORTED_IMAGE_MEDIA_TYPES),
      ),
    )
    .orderBy(desc(fileSchema.files.createdAt), desc(fileSchema.files.id));

  const images = await Promise.all(files.map(toReadyImage));
  return images.filter((image) => image !== undefined);
}

export async function getReadyImage(options: {
  organizationId: string;
  fileId: string;
}): Promise<Result<ReadyImage, FileError>> {
  const fileResult = await tryAsync(() => findFileById(options.organizationId, options.fileId));
  if (!fileResult.ok) {
    return databaseFailure(fileResult.error);
  }
  if (!fileResult.value) {
    return err({ kind: "FILE_NOT_FOUND" });
  }

  const image = await toReadyImage(fileResult.value.file);
  if (!image) {
    return err({ kind: "FILE_NOT_READY" });
  }

  return ok(image);
}

export interface UploadPartTarget {
  partNumber: number;
  offsetBytes: number;
  sizeBytes: number;
  method: "PUT";
  url: string;
  expiresAt: Date;
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
  sizeBytes: number;
}

export interface CompletedUploadPart {
  partNumber: number;
  etag: string;
}

export type FileUploadPlan =
  | {
      kind: "ready";
      file: ReadyFile;
    }
  | {
      kind: "upload";
      fileId: string;
      partSizeBytes: number;
      uploadedParts: Array<UploadedPart>;
      parts: Array<UploadPartTarget>;
    };

// TODO: make more specific error types for each operation
export type FileError =
  | {
      kind: "INVALID_FILE";
      field: "name" | "mediaType" | "sizeBytes";
    }
  | {
      kind: "REQUEST_CONFLICT";
    }
  | {
      kind: "FILE_NOT_FOUND";
    }
  | {
      kind: "FILE_NOT_READY";
    }
  | {
      kind: "UPLOAD_NOT_FOUND";
    }
  | {
      kind: "INVALID_UPLOAD_STATE";
    }
  | {
      kind: "INVALID_UPLOAD_PARTS";
    }
  | {
      kind: "SIZE_MISMATCH";
      expectedSizeBytes: number;
      actualSizeBytes: number;
    };

export async function beginFileUpload(options: {
  organizationId: string;
  requestId: string;
  name: string;
  mediaType: string;
  sizeBytes: number;
  signal: AbortSignal;
}): Promise<Result<FileUploadPlan, FileError>> {
  const invalidField = validateFile(options);
  if (invalidField) {
    return err({ kind: "INVALID_FILE", field: invalidField });
  }

  const existingResult = await tryAsync(() =>
    findFileByRequestId(options.organizationId, options.requestId),
  );
  if (!existingResult.ok) {
    return databaseFailure(existingResult.error);
  }

  if (existingResult.value) {
    if (!requestMatches(existingResult.value.file, options)) {
      return err({ kind: "REQUEST_CONFLICT" });
    }

    return prepareFileUpload(existingResult.value, options.signal);
  }

  const fileId = randomUUIDv7();
  const storageKey = createStorageKey(options.organizationId, fileId);
  const startResult = await minio.startMultipartUpload({
    key: storageKey,
    mediaType: options.mediaType,
    signal: options.signal,
  });
  if (!startResult.ok) {
    return storageFailure(startResult.error);
  }

  const bucketUploadId = startResult.value;
  const insertResult = await tryAsync(() =>
    db.transaction(async (tx) => {
      const [file] = await tx
        .insert(fileSchema.files)
        .values({
          id: fileId,
          organizationId: options.organizationId,
          requestId: options.requestId,
          state: "pending",
          name: options.name,
          mediaType: options.mediaType,
          expectedSizeBytes: options.sizeBytes,
          storageKey,
        })
        .onConflictDoNothing({
          target: [fileSchema.files.organizationId, fileSchema.files.requestId],
        })
        .returning();

      if (!file) {
        return undefined;
      }

      const [upload] = await tx
        .insert(fileSchema.fileUploads)
        .values({
          fileId,
          bucketUploadId,
          partSizeBytes: PART_SIZE_BYTES,
          expiresAt: new Date(Date.now() + UPLOAD_LIFETIME_MS),
        })
        .returning();

      if (!upload) {
        throw new Error("File upload insert returned no row");
      }

      return { file, upload } satisfies FileWithUpload;
    }),
  );

  if (!insertResult.ok) {
    const recoveryResult = await tryAsync(() =>
      findFileByRequestId(options.organizationId, options.requestId),
    );
    if (!recoveryResult.ok) {
      return databaseFailure(insertResult.error);
    }
    if (!recoveryResult.value) {
      await minio.abortMultipartUpload({ key: storageKey, uploadId: bucketUploadId });
      return databaseFailure(insertResult.error);
    }

    if (recoveryResult.value.upload?.bucketUploadId !== bucketUploadId) {
      await minio.abortMultipartUpload({ key: storageKey, uploadId: bucketUploadId });
    }
    if (!requestMatches(recoveryResult.value.file, options)) {
      return err({ kind: "REQUEST_CONFLICT" });
    }

    return prepareFileUpload(recoveryResult.value, options.signal);
  }

  if (insertResult.value) {
    return prepareFileUpload(insertResult.value, options.signal);
  }

  await minio.abortMultipartUpload({ key: storageKey, uploadId: bucketUploadId });

  const winnerResult = await tryAsync(() =>
    findFileByRequestId(options.organizationId, options.requestId),
  );
  if (!winnerResult.ok) {
    return databaseFailure(winnerResult.error);
  }
  if (!winnerResult.value) {
    throw new Error("Conflicting file request disappeared");
  }
  if (!requestMatches(winnerResult.value.file, options)) {
    return err({ kind: "REQUEST_CONFLICT" });
  }

  return prepareFileUpload(winnerResult.value, options.signal);
}

export async function completeFileUpload(options: {
  organizationId: string;
  fileId: string;
  parts: ReadonlyArray<CompletedUploadPart>;
  signal: AbortSignal;
}): Promise<Result<ReadyFile, FileError>> {
  const fileResult = await tryAsync(() => findFileById(options.organizationId, options.fileId));
  if (!fileResult.ok) {
    return databaseFailure(fileResult.error);
  }
  if (!fileResult.value) {
    return err({ kind: "FILE_NOT_FOUND" });
  }

  const fileWithUpload = fileResult.value;
  const readyFile = toReadyFile(fileWithUpload.file);
  if (readyFile) {
    return ok(readyFile);
  }
  if (!fileWithUpload.upload) {
    return err({ kind: "INVALID_UPLOAD_STATE" });
  }

  const expectedPartCount = getPartCount(
    fileWithUpload.file.expectedSizeBytes,
    fileWithUpload.upload.partSizeBytes,
  );
  const completedParts = [...options.parts].sort(
    (left, right) => left.partNumber - right.partNumber,
  );
  if (!validCompletedParts(completedParts, expectedPartCount)) {
    return err({ kind: "INVALID_UPLOAD_PARTS" });
  }

  const uploadedPartsResult = await minio.listUploadedParts({
    key: fileWithUpload.file.storageKey,
    uploadId: fileWithUpload.upload.bucketUploadId,
    signal: options.signal,
  });
  if (!uploadedPartsResult.ok) {
    if (uploadedPartsResult.error.kind === "UPLOAD_NOT_FOUND") {
      return reconcileCompletedFile(fileWithUpload, options.signal);
    }

    return storageFailure(uploadedPartsResult.error);
  }

  const uploadedParts = [...uploadedPartsResult.value].sort(
    (left, right) => left.partNumber - right.partNumber,
  );
  if (
    !validUploadedParts(
      uploadedParts,
      completedParts,
      fileWithUpload.file.expectedSizeBytes,
      fileWithUpload.upload.partSizeBytes,
    )
  ) {
    return err({ kind: "INVALID_UPLOAD_PARTS" });
  }

  const completeResult = await minio.completeMultipartUpload({
    key: fileWithUpload.file.storageKey,
    uploadId: fileWithUpload.upload.bucketUploadId,
    parts: uploadedParts,
    signal: options.signal,
  });
  if (!completeResult.ok) {
    const reconciliationResult = await reconcileCompletedFile(
      fileWithUpload,
      AbortSignal.timeout(5_000),
    );
    if (reconciliationResult.ok || reconciliationResult.error.kind !== "UPLOAD_NOT_FOUND") {
      return reconciliationResult;
    }

    if (completeResult.error.kind !== "UPLOAD_NOT_FOUND") {
      return storageFailure(completeResult.error);
    }

    return reconciliationResult;
  }

  return reconcileCompletedFile(fileWithUpload, options.signal);
}

export async function openFile(options: {
  organizationId: string;
  fileId: string;
  signal: AbortSignal;
}): Promise<Result<{ file: ReadyFile; body: ReadableStream<Uint8Array> }, FileError>> {
  const fileResult = await tryAsync(() => findFileById(options.organizationId, options.fileId));
  if (!fileResult.ok) {
    return databaseFailure(fileResult.error);
  }
  if (!fileResult.value) {
    return err({ kind: "FILE_NOT_FOUND" });
  }

  const readyFile = toReadyFile(fileResult.value.file);
  if (!readyFile) {
    return err({ kind: "FILE_NOT_READY" });
  }

  const objectResult = await minio.openObject({
    key: fileResult.value.file.storageKey,
    signal: options.signal,
  });
  if (!objectResult.ok) {
    return storageFailure(objectResult.error);
  }

  return ok({ file: readyFile, body: objectResult.value.body });
}

async function prepareFileUpload(
  fileWithUpload: FileWithUpload,
  signal: AbortSignal,
): Promise<Result<FileUploadPlan, FileError>> {
  const readyFile = toReadyFile(fileWithUpload.file);
  if (readyFile) {
    return ok({ kind: "ready", file: readyFile });
  }
  if (!fileWithUpload.upload) {
    return err({ kind: "INVALID_UPLOAD_STATE" });
  }

  const uploadedPartsResult = await minio.listUploadedParts({
    key: fileWithUpload.file.storageKey,
    uploadId: fileWithUpload.upload.bucketUploadId,
    signal,
  });
  if (!uploadedPartsResult.ok) {
    if (uploadedPartsResult.error.kind === "UPLOAD_NOT_FOUND") {
      const reconciledResult = await reconcileCompletedFile(fileWithUpload, signal);
      if (!reconciledResult.ok) {
        if (reconciledResult.error.kind === "UPLOAD_NOT_FOUND") {
          return restartFileUpload(fileWithUpload, signal);
        }

        return reconciledResult;
      }

      return ok({ kind: "ready", file: reconciledResult.value });
    }

    return storageFailure(uploadedPartsResult.error);
  }

  const partCount = getPartCount(
    fileWithUpload.file.expectedSizeBytes,
    fileWithUpload.upload.partSizeBytes,
  );
  const uploadedParts = [...uploadedPartsResult.value].sort(
    (left, right) => left.partNumber - right.partNumber,
  );
  const uploadedPartNumbers = new Set<number>();

  for (const part of uploadedParts) {
    if (
      part.partNumber < 1 ||
      part.partNumber > partCount ||
      part.sizeBytes !==
        getPartSize(
          part.partNumber,
          fileWithUpload.file.expectedSizeBytes,
          fileWithUpload.upload.partSizeBytes,
        ) ||
      uploadedPartNumbers.has(part.partNumber)
    ) {
      return err({ kind: "INVALID_UPLOAD_PARTS" });
    }

    uploadedPartNumbers.add(part.partNumber);
  }

  const parts: Array<UploadPartTarget> = [];
  for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
    if (uploadedPartNumbers.has(partNumber)) {
      continue;
    }

    const signedPartResult = await minio.signUploadPart({
      key: fileWithUpload.file.storageKey,
      uploadId: fileWithUpload.upload.bucketUploadId,
      partNumber,
    });
    if (!signedPartResult.ok) {
      return storageFailure(signedPartResult.error);
    }

    parts.push({
      partNumber,
      offsetBytes: (partNumber - 1) * fileWithUpload.upload.partSizeBytes,
      sizeBytes: getPartSize(
        partNumber,
        fileWithUpload.file.expectedSizeBytes,
        fileWithUpload.upload.partSizeBytes,
      ),
      ...signedPartResult.value,
    });
  }

  return ok({
    kind: "upload",
    fileId: fileWithUpload.file.id,
    partSizeBytes: fileWithUpload.upload.partSizeBytes,
    uploadedParts,
    parts,
  });
}

async function restartFileUpload(
  fileWithUpload: FileWithUpload,
  signal: AbortSignal,
): Promise<Result<FileUploadPlan, FileError>> {
  if (!fileWithUpload.upload) {
    return err({ kind: "INVALID_UPLOAD_STATE" });
  }

  const oldUploadId = fileWithUpload.upload.bucketUploadId;
  const oldStorageKey = fileWithUpload.file.storageKey;
  const newStorageKey = createStorageKey(
    fileWithUpload.file.organizationId,
    fileWithUpload.file.id,
  );
  const startResult = await minio.startMultipartUpload({
    key: newStorageKey,
    mediaType: fileWithUpload.file.mediaType,
    signal,
  });
  if (!startResult.ok) {
    return storageFailure(startResult.error);
  }

  const newUploadId = startResult.value;
  const updateResult = await tryAsync(() =>
    db.transaction(async (tx) => {
      const [file] = await tx
        .update(fileSchema.files)
        .set({ storageKey: newStorageKey })
        .where(
          and(
            eq(fileSchema.files.id, fileWithUpload.file.id),
            eq(fileSchema.files.organizationId, fileWithUpload.file.organizationId),
            eq(fileSchema.files.state, "pending"),
            eq(fileSchema.files.storageKey, oldStorageKey),
          ),
        )
        .returning();
      if (!file) {
        return undefined;
      }

      const [upload] = await tx
        .update(fileSchema.fileUploads)
        .set({
          bucketUploadId: newUploadId,
          expiresAt: new Date(Date.now() + UPLOAD_LIFETIME_MS),
          completedAt: null,
        })
        .where(
          and(
            eq(fileSchema.fileUploads.fileId, fileWithUpload.file.id),
            eq(fileSchema.fileUploads.bucketUploadId, oldUploadId),
          ),
        )
        .returning();
      if (!upload) {
        throw new Error("File upload changed during restart");
      }

      return { file, upload } satisfies FileWithUpload;
    }),
  );

  if (!updateResult.ok) {
    const recoveryResult = await tryAsync(() =>
      findFileById(fileWithUpload.file.organizationId, fileWithUpload.file.id),
    );
    if (!recoveryResult.ok) {
      return databaseFailure(updateResult.error);
    }
    if (!recoveryResult.value) {
      await minio.abortMultipartUpload({
        key: newStorageKey,
        uploadId: newUploadId,
      });
      return err({ kind: "FILE_NOT_FOUND" });
    }

    if (
      recoveryResult.value.file.storageKey === newStorageKey &&
      recoveryResult.value.upload?.bucketUploadId === newUploadId
    ) {
      await minio.abortMultipartUpload({
        key: oldStorageKey,
        uploadId: oldUploadId,
      });
    } else {
      await minio.abortMultipartUpload({
        key: newStorageKey,
        uploadId: newUploadId,
      });
    }

    return prepareFileUpload(recoveryResult.value, signal);
  }

  if (!updateResult.value) {
    await minio.abortMultipartUpload({
      key: newStorageKey,
      uploadId: newUploadId,
    });

    const currentResult = await tryAsync(() =>
      findFileById(fileWithUpload.file.organizationId, fileWithUpload.file.id),
    );
    if (!currentResult.ok) {
      return databaseFailure(currentResult.error);
    }
    if (!currentResult.value) {
      return err({ kind: "FILE_NOT_FOUND" });
    }

    return prepareFileUpload(currentResult.value, signal);
  }

  await minio.abortMultipartUpload({
    key: oldStorageKey,
    uploadId: oldUploadId,
  });

  return prepareFileUpload(updateResult.value, signal);
}

async function reconcileCompletedFile(
  fileWithUpload: FileWithUpload,
  signal: AbortSignal,
): Promise<Result<ReadyFile, FileError>> {
  const statResult = await minio.statObject({
    key: fileWithUpload.file.storageKey,
    signal,
  });
  if (!statResult.ok) {
    if (statResult.error.kind === "OBJECT_NOT_FOUND") {
      return err({ kind: "UPLOAD_NOT_FOUND" });
    }

    return storageFailure(statResult.error);
  }
  if (statResult.value.sizeBytes !== fileWithUpload.file.expectedSizeBytes) {
    return err({
      kind: "SIZE_MISMATCH",
      expectedSizeBytes: fileWithUpload.file.expectedSizeBytes,
      actualSizeBytes: statResult.value.sizeBytes,
    });
  }

  const readyAt = new Date();
  const updateResult = await tryAsync(() =>
    db.transaction(async (tx) => {
      const [file] = await tx
        .update(fileSchema.files)
        .set({
          state: "ready",
          sizeBytes: statResult.value.sizeBytes,
          readyAt,
        })
        .where(
          and(
            eq(fileSchema.files.id, fileWithUpload.file.id),
            eq(fileSchema.files.organizationId, fileWithUpload.file.organizationId),
            eq(fileSchema.files.state, "pending"),
            eq(fileSchema.files.storageKey, fileWithUpload.file.storageKey),
          ),
        )
        .returning();

      if (file) {
        await tx
          .update(fileSchema.fileUploads)
          .set({ completedAt: readyAt })
          .where(eq(fileSchema.fileUploads.fileId, file.id));
      }

      return file;
    }),
  );
  if (!updateResult.ok) {
    const recoveryResult = await tryAsync(() =>
      findFileById(fileWithUpload.file.organizationId, fileWithUpload.file.id),
    );
    if (recoveryResult.ok) {
      const readyFile = recoveryResult.value && toReadyFile(recoveryResult.value.file);
      if (readyFile) {
        return ok(readyFile);
      }
    }

    return databaseFailure(updateResult.error);
  }

  if (updateResult.value) {
    const readyFile = toReadyFile(updateResult.value);
    if (readyFile) {
      return ok(readyFile);
    }
  }

  const currentResult = await tryAsync(() =>
    findFileById(fileWithUpload.file.organizationId, fileWithUpload.file.id),
  );
  if (!currentResult.ok) {
    return databaseFailure(currentResult.error);
  }
  if (!currentResult.value) {
    return err({ kind: "FILE_NOT_FOUND" });
  }

  const currentReadyFile = toReadyFile(currentResult.value.file);
  if (currentResult.value.file.storageKey !== fileWithUpload.file.storageKey) {
    await minio.deleteObject({ key: fileWithUpload.file.storageKey });
  }
  if (!currentReadyFile) {
    return err({ kind: "INVALID_UPLOAD_STATE" });
  }

  return ok(currentReadyFile);
}

async function findFileByRequestId(organizationId: string, requestId: string) {
  const [result] = await db
    .select({ file: fileSchema.files, upload: fileSchema.fileUploads })
    .from(fileSchema.files)
    .leftJoin(fileSchema.fileUploads, eq(fileSchema.fileUploads.fileId, fileSchema.files.id))
    .where(
      and(
        eq(fileSchema.files.organizationId, organizationId),
        eq(fileSchema.files.requestId, requestId),
      ),
    )
    .limit(1);

  return result;
}

async function findFileById(organizationId: string, fileId: string) {
  const [result] = await db
    .select({ file: fileSchema.files, upload: fileSchema.fileUploads })
    .from(fileSchema.files)
    .leftJoin(fileSchema.fileUploads, eq(fileSchema.fileUploads.fileId, fileSchema.files.id))
    .where(
      and(eq(fileSchema.files.organizationId, organizationId), eq(fileSchema.files.id, fileId)),
    )
    .limit(1);

  return result;
}

function validateFile(options: { name: string; mediaType: string; sizeBytes: number }) {
  if (options.name.length === 0) {
    return "name" as const;
  }
  if (options.mediaType.length === 0) {
    return "mediaType" as const;
  }
  if (
    !Number.isInteger(options.sizeBytes) ||
    options.sizeBytes < 1 ||
    options.sizeBytes > MAX_FILE_SIZE_BYTES ||
    getPartCount(options.sizeBytes, PART_SIZE_BYTES) > MAX_PARTS
  ) {
    return "sizeBytes" as const;
  }
}

function requestMatches(
  file: fileSchema.File,
  request: { name: string; mediaType: string; sizeBytes: number },
) {
  return (
    file.name === request.name &&
    file.mediaType === request.mediaType &&
    file.expectedSizeBytes === request.sizeBytes
  );
}

function toReadyFile(file: fileSchema.File): ReadyFile | undefined {
  if (file.state !== "ready" || file.sizeBytes === null || file.readyAt === null) {
    return undefined;
  }

  return {
    id: file.id,
    organizationId: file.organizationId,
    name: file.name,
    mediaType: file.mediaType,
    sizeBytes: file.sizeBytes,
    createdAt: file.createdAt,
  };
}

async function toReadyImage(file: fileSchema.File): Promise<ReadyImage | undefined> {
  const readyFile = toReadyFile(file);
  if (!readyFile || !isSupportedImageMediaType(readyFile.mediaType)) {
    return undefined;
  }

  const urlResult = await minio.signOpenObject({ key: file.storageKey });
  if (!urlResult.ok) {
    return storageFailure(urlResult.error);
  }

  return { ...readyFile, url: urlResult.value };
}

function getPartCount(sizeBytes: number, partSizeBytes: number) {
  return Math.ceil(sizeBytes / partSizeBytes);
}

function createStorageKey(organizationId: string, fileId: string) {
  return `organizations/${organizationId}/files/${fileId}/attempts/${randomUUIDv7()}`;
}

function getPartSize(partNumber: number, sizeBytes: number, partSizeBytes: number) {
  const offsetBytes = (partNumber - 1) * partSizeBytes;
  return Math.min(partSizeBytes, sizeBytes - offsetBytes);
}

function validCompletedParts(parts: ReadonlyArray<CompletedUploadPart>, expectedPartCount: number) {
  return (
    parts.length === expectedPartCount &&
    parts.every((part, index) => part.partNumber === index + 1 && part.etag.trim().length > 0)
  );
}

function validUploadedParts(
  uploadedParts: ReadonlyArray<UploadedPart>,
  completedParts: ReadonlyArray<CompletedUploadPart>,
  sizeBytes: number,
  partSizeBytes: number,
) {
  if (uploadedParts.length !== completedParts.length) {
    return false;
  }

  return uploadedParts.every((part, index) => {
    const completedPart = completedParts[index];
    return (
      completedPart !== undefined &&
      part.partNumber === index + 1 &&
      completedPart.partNumber === part.partNumber &&
      completedPart.etag === part.etag &&
      part.sizeBytes === getPartSize(part.partNumber, sizeBytes, partSizeBytes)
    );
  });
}

// TODO: remove these helpers
function databaseFailure(cause: unknown): never {
  throw new Error("File database operation failed", { cause });
}

// TODO: remove these helpers
function storageFailure(cause: unknown): never {
  throw new Error("File storage operation failed", { cause });
}
