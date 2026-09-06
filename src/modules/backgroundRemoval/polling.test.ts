import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { startBackgroundRemovalPolling } from "./polling";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("startBackgroundRemovalPolling", () => {
  test("polls once per second without overlapping requests", async () => {
    let finishPoll: (() => void) | undefined;
    const onPoll = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishPoll = resolve;
        }),
    );
    const stop = startBackgroundRemovalPolling({ onPoll });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onPoll).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onPoll).toHaveBeenCalledOnce();

    finishPoll?.();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onPoll).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onPoll).toHaveBeenCalledTimes(2);
  });
});
