import { inspect } from "node:util";
import { parentPort, workerData } from "node:worker_threads";

import { err, ok } from "@/lib/result";
import type {
  ModelThreadJob,
  ModelThreadMessage,
  ModelThreadResult,
} from "@/modules/backgroundRemoval/modelAdapter";
import {
  BackgroundRemovalImageError,
  createBiRefNetPipeline,
} from "@/modules/backgroundRemoval/modelPipeline";

if (!parentPort) throw new Error("modelThread must run as a worker thread");
const port = parentPort;
const { modelPath }: { modelPath: string } = workerData;

const pipeline = await createBiRefNetPipeline(modelPath);
await pipeline.warmUp();

function send(message: ModelThreadMessage) {
  port.postMessage(message);
}

async function run(job: ModelThreadJob): Promise<ModelThreadResult> {
  try {
    return ok(await pipeline.removeBackground(job));
  } catch (error) {
    return err({
      failureCode:
        error instanceof BackgroundRemovalImageError ? error.failureCode : "inference_failed",
      cause: inspect(error),
    });
  }
}

port.on("message", (job: ModelThreadJob) => {
  void run(job).then((result) => send({ kind: "result", result }));
});
send({ kind: "ready" });
