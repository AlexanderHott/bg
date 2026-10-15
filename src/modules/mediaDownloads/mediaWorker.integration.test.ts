import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUIDv7 } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { db } from "@/db";
import * as minio from "@/modules/files/minio";
import { files } from "@/modules/files/schema";
import { organizations } from "@/modules/organizations/schema";

import {
  createMediaBatch,
  getMediaBatch,
  getMediaItem,
  inspectMediaItem,
  mediaDownloadUrl,
  queueMediaBatch,
  selectMediaItem,
} from "./mediaDownloads";
import { DEFAULT_SETTINGS } from "./policy";
import { mediaBatches } from "./schema";

const organizationId = randomUUIDv7();
let directory: string;
let worker: ChildProcess;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "bg-media-worker-test-"));
  const fixture = join(directory, "fixture.mp4");
  await promisify(execFile)("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=32x32:d=0.2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=0.2",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-shortest",
    fixture,
  ]);
  const executable = join(directory, "yt-dlp");
  const source = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version')) console.log('fixture');
else if (args.includes('--flat-playlist')) {
 console.log(JSON.stringify({id:'one',url:'https://example.com/video',title:'Fixture',playlist_index:1}));
 console.log(JSON.stringify({id:'missing',title:'Unavailable item',playlist_index:2}));
} else if (args.includes('--dump-json')) console.log(JSON.stringify({id:'one',title:'Fixture',formats:[{format_id:'combined',ext:'mp4',vcodec:'h264',acodec:'aac',height:32,protocol:'https'}]}));
else { fs.copyFileSync(${JSON.stringify(fixture)},'output.mp4'); console.log('BG_FILE '+JSON.stringify(process.cwd()+'/output.mp4')); }
`;
  await writeFile(executable, source);
  await chmod(executable, 0o755);
  await db.insert(organizations).values({
    id: organizationId,
    name: "Media worker test",
    slug: `media-worker-${organizationId}`,
  });
  worker = spawn(process.execPath, ["--import", "tsx", "src/mediaWorker.ts"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      YT_DLP_PATH: executable,
      MEDIA_SCRATCH_PATH: join(directory, "scratch"),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  worker.stderr?.on("data", () => {});
});

afterAll(async () => {
  if (worker && worker.exitCode === null) {
    const stopped = new Promise((resolve) => worker.once("exit", resolve));
    worker.kill("SIGTERM");
    await stopped;
  }
  const outputs = await db.select().from(files).where(eq(files.organizationId, organizationId));
  for (const file of outputs) await minio.deleteObject({ key: file.storageKey });
  await db.delete(mediaBatches).where(eq(mediaBatches.organizationId, organizationId));
  await db.delete(organizations).where(eq(organizations.id, organizationId));
  await db.$client.end();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("discovers progressively, inspects a draft, and publishes the selected media through MinIO", async () => {
  const batchId = await createMediaBatch({
    organizationId,
    requestId: randomUUIDv7(),
    urls: ["https://example.com/playlist"],
    settings: DEFAULT_SETTINGS,
    queue: false,
  });
  const discovered = await waitFor(async () => {
    const page = await getMediaBatch(organizationId, batchId);
    return page.sources[0]?.state === "done" ? page : undefined;
  });
  expect(discovered.items.map((item) => item.state)).toEqual(["draft", "failed"]);
  const item = discovered.items[0]!;
  await inspectMediaItem(organizationId, batchId, item.id, false);
  const inspected = await waitFor(async () => {
    const result = await getMediaItem(organizationId, batchId, item.id);
    return result.inspection?.state === "done" ? result : undefined;
  });
  expect(inspected.item.metadata?.formats[0]?.id).toBe("combined");
  expect(inspected.item.state).toBe("draft");
  await selectMediaItem(
    organizationId,
    batchId,
    item.id,
    { videoId: "combined" },
    DEFAULT_SETTINGS,
  );
  await queueMediaBatch(organizationId, batchId, DEFAULT_SETTINGS);
  const ready = await waitFor(async () => {
    const page = await getMediaBatch(organizationId, batchId);
    const output = page.items.find((row) => row.id === item.id);
    if (output?.state === "failed") throw new Error(output.error ?? "Download failed");
    return output?.state === "ready" ? output : undefined;
  });
  expect(ready.outputDescription).toContain("h264");
  const url = await mediaDownloadUrl(organizationId, batchId, item.id);
  const response = await fetch(url);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toContain("attachment");
  expect(Buffer.from(await response.arrayBuffer())).toEqual(
    await readFile(join(directory, "fixture.mp4")),
  );
}, 45_000);

async function waitFor<T>(read: () => Promise<T | undefined>) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (worker.exitCode !== null) throw new Error("The media worker exited unexpectedly.");
    const result = await read();
    if (result !== undefined) return result;
    await delay(250);
  }
  throw new Error("Timed out waiting for media worker.");
}
