import type { BackgroundRemovalFailureCode } from "./schema";

export const BACKGROUND_REMOVAL_MODEL_ID = "birefnet-general-lite-onnx-v1";
export const MAX_BACKGROUND_REMOVAL_INPUT_SIZE_BYTES = 50 * 1024 * 1024;
export const MAX_BACKGROUND_REMOVAL_INPUT_PIXELS = 64 * 1024 * 1024;
export const MAX_BACKGROUND_REMOVAL_INPUT_SIDE = 16_384;
export const MAX_AUTOMATIC_ATTEMPTS = 3;
export const ATTEMPT_LEASE_MS = 60_000;

const retryableFailureCodes = new Set<BackgroundRemovalFailureCode>([
  "inference_failed",
  "storage_failed",
  "worker_lost",
]);

export function isRetryableFailure(code: BackgroundRemovalFailureCode) {
  return retryableFailureCodes.has(code);
}

export function retryDelayMs(failedSequence: number, random = Math.random) {
  const baseMs = failedSequence <= 1 ? 5_000 : 30_000;
  return Math.round(baseMs * (0.8 + random() * 0.4));
}
