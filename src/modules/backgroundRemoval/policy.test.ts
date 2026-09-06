import { describe, expect, test } from "vite-plus/test";

import { isRetryableFailure, retryDelayMs } from "./policy";

describe("background-removal retry policy", () => {
  test.each(["inference_failed", "storage_failed", "worker_lost"] as const)(
    "retries %s",
    (failureCode) => {
      expect(isRetryableFailure(failureCode)).toBe(true);
    },
  );

  test.each(["invalid_image", "unsupported_image", "image_too_large", "decode_failed"] as const)(
    "does not retry %s",
    (failureCode) => {
      expect(isRetryableFailure(failureCode)).toBe(false);
    },
  );

  test("applies bounded jitter to retry delays", () => {
    expect(retryDelayMs(1, () => 0)).toBe(4_000);
    expect(retryDelayMs(1, () => 1)).toBe(6_000);
    expect(retryDelayMs(2, () => 0)).toBe(24_000);
    expect(retryDelayMs(2, () => 1)).toBe(36_000);
  });
});
