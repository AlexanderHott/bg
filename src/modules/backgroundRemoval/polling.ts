const POLL_INTERVAL_MS = 1_000;

export function startBackgroundRemovalPolling(options: { onPoll: () => Promise<void> }) {
  let polling = false;
  const interval = setInterval(() => {
    if (polling) return;
    polling = true;
    void options
      .onPoll()
      .catch(() => undefined)
      .finally(() => {
        polling = false;
      });
  }, POLL_INTERVAL_MS);

  return () => clearInterval(interval);
}
