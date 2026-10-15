import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import * as minio from "@/modules/files/minio";
import * as downloads from "@/modules/mediaDownloads/mediaDownloads";
import { startMediaProxy } from "@/modules/mediaDownloads/networkProxy";
import { MediaError, type MediaProgress } from "@/modules/mediaDownloads/policy";
import {
  createYtDlpAdapter,
  runMediaProcess,
  scratchSize,
} from "@/modules/mediaDownloads/ytDlpAdapter";

const scratchRoot = process.env.MEDIA_SCRATCH_PATH ?? "/tmp/bg-media";
const readyFile = join(scratchRoot, "ready");
const stop = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    console.info("Media worker stopping", { signal });
    stop.abort();
  });
console.info("Media worker starting", { scratchRoot });
await mkdir(scratchRoot, { recursive: true });
await rm(readyFile, { force: true });
for (const [executable, args] of [
  [process.env.YT_DLP_PATH ?? "yt-dlp", ["--ignore-config", "--version"]],
  ["ffmpeg", ["-version"]],
  ["ffprobe", ["-version"]],
] as const) {
  console.info("Media worker checking executable", { executable });
  await runMediaProcess({
    executable,
    args: [...args],
    cwd: scratchRoot,
    signal: stop.signal,
    timeoutMs: 30_000,
    onLine: async () => {},
  });
}
const proxy = await startMediaProxy();
const adapter = createYtDlpAdapter(proxy.url);
await writeFile(readyFile, "ready\n");
console.info("Media worker ready", { lanes: ["inspect", "discover", "download"] });

try {
  await Promise.all([runLane("inspect"), runLane("discover"), runLane("download"), maintain()]);
} finally {
  stop.abort();
  await rm(readyFile, { force: true });
  await proxy.close();
  console.info("Media worker stopped");
}

async function runLane(kind: "discover" | "inspect" | "download") {
  while (!stop.signal.aborted) {
    try {
      const claim = await downloads.claimMediaTask(kind);
      if (claim) await processTask(claim);
      else await wait(1_000);
    } catch (error) {
      console.error("Media worker lane failed", { kind, error });
      await wait(5_000);
    }
  }
}

async function processTask(
  claim: NonNullable<Awaited<ReturnType<typeof downloads.claimMediaTask>>>,
) {
  const { task, item, source, batch } = claim;
  const context = {
    taskId: task.id,
    kind: task.kind,
    batchId: batch.id,
    itemId: item?.id,
    sourceId: source?.id,
    attempt: task.attempts,
  };
  const startedAt = performance.now();
  console.info("Media worker task started", context);
  const scratch = await mkdtemp(join(scratchRoot, "task-"));
  const controller = new AbortController();
  const signal = AbortSignal.any([stop.signal, controller.signal]);
  let progress: MediaProgress | undefined;
  let renewing = false;
  let scratchLimit = false;
  const heartbeat = setInterval(async () => {
    if (renewing) return;
    renewing = true;
    try {
      if (!(await downloads.heartbeatMediaTask(task, progress))) {
        if (!signal.aborted) console.warn("Media worker task lease lost", context);
        controller.abort();
      }
      const sizeBytes = await scratchSize(scratch);
      if (sizeBytes > 12_000_000_000) {
        if (!scratchLimit)
          console.warn("Media worker scratch limit exceeded", { ...context, sizeBytes });
        scratchLimit = true;
        controller.abort();
      }
    } catch (error) {
      console.error("Media worker heartbeat failed", { ...context, error });
      controller.abort();
    } finally {
      renewing = false;
    }
  }, 2_000);
  try {
    let completed;
    if (task.kind === "discover" && source) {
      await adapter.discover(source.url, scratch, signal, async (entry) => {
        if (!(await downloads.addDiscoveredMedia(task, entry))) {
          console.warn("Media worker discovery no longer accepted", context);
          controller.abort();
          signal.throwIfAborted();
        }
      });
      completed = await downloads.finishMediaTask(task);
    } else if (task.kind === "inspect" && item?.url) {
      completed = await downloads.finishMediaTask(
        task,
        await adapter.inspect(item.url, scratch, signal),
      );
    } else if (task.kind === "download" && item?.url) {
      const output = await adapter.download({
        url: item.url,
        settings: batch.settings,
        selection: item.selection,
        cwd: scratch,
        signal,
        onProgress: (update) => {
          if (update.phase !== progress?.phase)
            console.info("Media worker task progress", { ...context, ...update });
          progress = update;
        },
      });
      signal.throwIfAborted();
      progress = { phase: "uploading" };
      console.info("Media worker task progress", {
        ...context,
        ...progress,
        sizeBytes: output.sizeBytes,
      });
      const uploadedKey = `media-downloads/${batch.id}/${task.id}/${task.leaseToken}/output${extname(output.path)}`;
      const upload = await minio.putObjectFromFile({ key: uploadedKey, ...output, signal });
      if (!upload.ok) {
        console.error("Media worker upload failed", { ...context, error: upload.error });
        throw new MediaError("network", "Could not save the downloaded file. Try again.");
      }
      completed = await downloads.publishMedia(task, { key: uploadedKey, ...output });
    } else throw new MediaError("unavailable", "This source is unavailable.");
    const result = { ...context, durationMs: Math.round(performance.now() - startedAt) };
    if (completed) console.info("Media worker task completed", result);
    else console.warn("Media worker task result no longer accepted", result);
  } catch (error) {
    console.error("Media worker task failed", {
      ...context,
      durationMs: Math.round(performance.now() - startedAt),
      phase: progress?.phase,
      aborted: signal.aborted,
      scratchLimit,
      error,
    });
    await downloads.failMediaTask(
      task,
      scratchLimit
        ? new MediaError("limit", "This request exceeded its scratch-disk limit.")
        : error,
    );
  } finally {
    clearInterval(heartbeat);
    await rm(scratch, { recursive: true, force: true });
    // Abandoned objects are collected after 24 hours; never delete an ambiguously published file.
  }
}

async function maintain() {
  let cursor: string | undefined;
  while (!stop.signal.aborted) {
    try {
      await downloads.recoverMediaTasks();
      cursor = await downloads.cleanMediaStorage(cursor);
      for (const entry of await readdir(scratchRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith("task-")) continue;
        const path = join(scratchRoot, entry.name);
        if (Date.now() - (await stat(path)).mtimeMs > 24 * 60 * 60_000) {
          await rm(path, { recursive: true, force: true });
          console.info("Media worker removed stale scratch directory", { path });
        }
      }
    } catch (error) {
      console.error("Media worker maintenance failed", { error });
    }
    await wait(30_000);
  }
}

async function wait(ms: number) {
  try {
    await delay(ms, undefined, { signal: stop.signal });
  } catch {
    return;
  }
}
