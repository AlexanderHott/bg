import { err, ok, tryAsync, type Result } from "@/lib/result";

import type {
  CompletedUploadPart,
  FileError,
  FileUploadPlan,
  ReadyFile,
  UploadPartTarget,
} from "./files";
import { beginFileUploadFn, completeFileUploadFn } from "./serverFunctions";

const UPLOAD_CONCURRENCY = 4;
const MAX_PART_ATTEMPTS = 3;
const MAX_UPLOAD_ROUNDS = 3;

export interface UploadProgress {
  phase: "uploading" | "finalizing";
  uploadedBytes: number;
  totalBytes: number;
}

export type UploadFileError =
  | {
      kind: "CANCELLED";
    }
  | {
      kind: "FILE_ERROR";
      error: FileError;
    }
  | {
      kind: "SERVER_REQUEST_FAILED";
      cause: unknown;
    }
  | {
      kind: "PART_UPLOAD_FAILED";
      partNumber: number;
      reason: PartUploadFailureReason;
      status?: number;
    }
  | {
      kind: "RETRY_LIMIT_REACHED";
    };

type PartUploadFailureReason = "HTTP" | "MISSING_ETAG" | "NETWORK" | "URL_EXPIRED";

type UploadFileOptions = {
  organizationSlug: string;
  requestId: string;
  file: File;
  signal: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
};

type RetryUploadRound = { kind: "RETRY_UPLOAD_ROUND" };

const retryUploadRound: RetryUploadRound = { kind: "RETRY_UPLOAD_ROUND" };

export async function uploadFile(
  options: UploadFileOptions,
): Promise<Result<ReadyFile, UploadFileError>> {
  for (let round = 1; round <= MAX_UPLOAD_ROUNDS; round += 1) {
    const result = await uploadFileRound(options, round < MAX_UPLOAD_ROUNDS);
    if (result.ok) return result;
    if (result.error.kind !== "RETRY_UPLOAD_ROUND") return err(result.error);
  }

  return err({ kind: "RETRY_LIMIT_REACHED" });
}

async function uploadFileRound(
  options: UploadFileOptions,
  canRetry: boolean,
): Promise<Result<ReadyFile, UploadFileError | RetryUploadRound>> {
  const planResult = await requestUploadPlan(options);
  if (!planResult.ok) return planResult;

  const plan = planResult.value;
  if (plan.kind === "ready") {
    reportFinalizing(options);
    return ok(plan.file);
  }

  const partsResult = await collectCompletedParts(options, plan, canRetry);
  if (!partsResult.ok) return partsResult;

  return completeUpload(options, plan.fileId, partsResult.value, canRetry);
}

async function requestUploadPlan(
  options: UploadFileOptions,
): Promise<Result<FileUploadPlan, UploadFileError>> {
  if (options.signal.aborted) return err({ kind: "CANCELLED" });

  const requestResult = await tryAsync(() =>
    beginFileUploadFn({
      signal: options.signal,
      data: {
        organizationSlug: options.organizationSlug,
        requestId: options.requestId,
        name: options.file.name,
        mediaType: options.file.type,
        sizeBytes: options.file.size,
      },
    }),
  );
  if (!requestResult.ok) {
    if (options.signal.aborted) return err({ kind: "CANCELLED" });
    return err({ kind: "SERVER_REQUEST_FAILED", cause: requestResult.error });
  }
  if (options.signal.aborted) return err({ kind: "CANCELLED" });
  if (!requestResult.value.ok) {
    return err({ kind: "FILE_ERROR", error: requestResult.value.error });
  }

  return ok(requestResult.value.value);
}

async function collectCompletedParts(
  options: UploadFileOptions,
  plan: Extract<FileUploadPlan, { kind: "upload" }>,
  canRetry: boolean,
): Promise<Result<Array<CompletedUploadPart>, UploadFileError | RetryUploadRound>> {
  const uploadResult = await tryAsync(() =>
    uploadMissingParts({
      plan,
      file: options.file,
      signal: options.signal,
      onProgress: options.onProgress,
    }),
  );
  if (!uploadResult.ok) {
    if (options.signal.aborted) return err({ kind: "CANCELLED" });

    const failure = uploadResult.error;
    if (failure instanceof PartUploadFailure) {
      if (failure.reason === "URL_EXPIRED" && canRetry) return err(retryUploadRound);
      return err({
        kind: "PART_UPLOAD_FAILED",
        partNumber: failure.partNumber,
        reason: failure.reason,
        status: failure.status,
      });
    }

    return err({ kind: "SERVER_REQUEST_FAILED", cause: failure });
  }

  return ok(
    [...plan.uploadedParts, ...uploadResult.value]
      .map(({ partNumber, etag }) => ({ partNumber, etag }))
      .sort((left, right) => left.partNumber - right.partNumber),
  );
}

async function completeUpload(
  options: UploadFileOptions,
  fileId: string,
  parts: Array<CompletedUploadPart>,
  canRetry: boolean,
): Promise<Result<ReadyFile, UploadFileError | RetryUploadRound>> {
  if (options.signal.aborted) return err({ kind: "CANCELLED" });
  reportFinalizing(options);

  const requestResult = await tryAsync(() =>
    completeFileUploadFn({
      signal: options.signal,
      data: { organizationSlug: options.organizationSlug, fileId, parts },
    }),
  );
  if (!requestResult.ok) {
    if (options.signal.aborted) return err({ kind: "CANCELLED" });
    if (canRetry) return err(retryUploadRound);
    return err({ kind: "SERVER_REQUEST_FAILED", cause: requestResult.error });
  }
  if (options.signal.aborted) return err({ kind: "CANCELLED" });

  const result = requestResult.value;
  if (result.ok) return ok(result.value);
  if (canRetry && retryableCompletionError(result.error)) return err(retryUploadRound);
  return err({ kind: "FILE_ERROR", error: result.error });
}

function retryableCompletionError(error: FileError) {
  return (
    error.kind === "INVALID_UPLOAD_PARTS" ||
    error.kind === "INVALID_UPLOAD_STATE" ||
    error.kind === "UPLOAD_NOT_FOUND"
  );
}

function reportFinalizing(options: UploadFileOptions) {
  options.onProgress?.({
    phase: "finalizing",
    uploadedBytes: options.file.size,
    totalBytes: options.file.size,
  });
}

async function uploadMissingParts(options: {
  plan: Extract<FileUploadPlan, { kind: "upload" }>;
  file: File;
  signal: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
}) {
  const controller = new AbortController();
  const progressByPart = new Map<number, number>();
  const completedParts: Array<CompletedUploadPart> = [];
  let nextPartIndex = 0;

  for (const part of options.plan.uploadedParts) {
    progressByPart.set(part.partNumber, part.sizeBytes);
  }
  for (const part of options.plan.parts) {
    progressByPart.set(part.partNumber, 0);
  }

  function reportProgress() {
    let uploadedBytes = 0;
    for (const loadedBytes of progressByPart.values()) {
      uploadedBytes += loadedBytes;
    }

    options.onProgress?.({
      phase: "uploading",
      uploadedBytes: Math.min(uploadedBytes, options.file.size),
      totalBytes: options.file.size,
    });
  }

  function abortUploads() {
    controller.abort(options.signal.reason);
  }

  if (options.signal.aborted) {
    abortUploads();
    throw abortError();
  }

  options.signal.addEventListener("abort", abortUploads, { once: true });
  reportProgress();

  async function worker() {
    while (true) {
      const part = options.plan.parts[nextPartIndex];
      nextPartIndex += 1;
      if (!part) {
        return;
      }

      const completedPart = await uploadPartWithRetry({
        target: part,
        body: options.file.slice(part.offsetBytes, part.offsetBytes + part.sizeBytes),
        signal: controller.signal,
        onProgress(uploadedBytes) {
          progressByPart.set(part.partNumber, uploadedBytes);
          reportProgress();
        },
        onRetry() {
          progressByPart.set(part.partNumber, 0);
          reportProgress();
        },
      });

      progressByPart.set(part.partNumber, part.sizeBytes);
      completedParts.push(completedPart);
      reportProgress();
    }
  }

  try {
    const workerCount = Math.min(UPLOAD_CONCURRENCY, options.plan.parts.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  } catch (cause) {
    controller.abort(cause);
    throw cause;
  } finally {
    options.signal.removeEventListener("abort", abortUploads);
  }

  return completedParts;
}

async function uploadPartWithRetry(options: {
  target: UploadPartTarget;
  body: Blob;
  signal: AbortSignal;
  onProgress: (uploadedBytes: number) => void;
  onRetry: () => void;
}) {
  for (let attempt = 1; attempt <= MAX_PART_ATTEMPTS; attempt += 1) {
    try {
      return await uploadPart(options);
    } catch (cause) {
      if (options.signal.aborted) {
        throw cause;
      }
      if (!(cause instanceof PartUploadFailure)) {
        throw cause;
      }
      if (cause.reason === "URL_EXPIRED" || !cause.retryable || attempt === MAX_PART_ATTEMPTS) {
        throw cause;
      }

      options.onRetry();
      await wait(250 * 2 ** (attempt - 1), options.signal);
    }
  }

  throw new Error("Part upload retry loop exited unexpectedly");
}

function uploadPart(options: {
  target: UploadPartTarget;
  body: Blob;
  signal: AbortSignal;
  onProgress: (uploadedBytes: number) => void;
}): Promise<CompletedUploadPart> {
  if (options.signal.aborted) {
    return Promise.reject(abortError());
  }

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    let settled = false;

    function cleanup() {
      options.signal.removeEventListener("abort", abortRequest);
    }

    function succeed(part: CompletedUploadPart) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(part);
    }

    function fail(cause: unknown) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(cause);
    }

    function abortRequest() {
      request.abort();
    }

    request.open(options.target.method, options.target.url);
    request.upload.addEventListener("progress", (event) => {
      options.onProgress(Math.min(event.loaded, options.target.sizeBytes));
    });
    request.addEventListener("load", () => {
      if (request.status < 200 || request.status >= 300) {
        fail(
          new PartUploadFailure(
            options.target.partNumber,
            request.status === 401 || request.status === 403 ? "URL_EXPIRED" : "HTTP",
            request.status >= 500 || request.status === 408 || request.status === 429,
            request.status,
          ),
        );
        return;
      }

      const etag = request.getResponseHeader("ETag");
      if (!etag) {
        fail(
          new PartUploadFailure(options.target.partNumber, "MISSING_ETAG", false, request.status),
        );
        return;
      }

      succeed({ partNumber: options.target.partNumber, etag });
    });
    request.addEventListener("error", () => {
      fail(new PartUploadFailure(options.target.partNumber, "NETWORK", true));
    });
    request.addEventListener("abort", () => {
      fail(abortError());
    });

    options.signal.addEventListener("abort", abortRequest, { once: true });
    request.send(options.body);
  });
}

function wait(durationMs: number, signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.reject(abortError());
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abortWait);
      resolve();
    }, durationMs);

    function abortWait() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abortWait);
      reject(abortError());
    }

    signal.addEventListener("abort", abortWait, { once: true });
  });
}

function abortError() {
  return new DOMException("The upload was cancelled", "AbortError");
}

class PartUploadFailure extends Error {
  readonly partNumber: number;
  readonly reason: PartUploadFailureReason;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    partNumber: number,
    reason: PartUploadFailureReason,
    retryable: boolean,
    status?: number,
  ) {
    super(`Part ${partNumber} upload failed: ${reason}`);
    this.name = "PartUploadFailure";
    this.partNumber = partNumber;
    this.reason = reason;
    this.retryable = retryable;
    this.status = status;
  }
}
