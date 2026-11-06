import { Worker } from "node:worker_threads";

import type { Result } from "@/lib/result";

import type { createBiRefNetPipeline } from "./modelPipeline";
import type { BackgroundRemovalFailureCode } from "./schema";

type Pipeline = Awaited<ReturnType<typeof createBiRefNetPipeline>>;
export type ModelThreadJob = Parameters<Pipeline["removeBackground"]>[0];
export type ModelThreadResult = Result<
  Awaited<ReturnType<Pipeline["removeBackground"]>>,
  { failureCode: BackgroundRemovalFailureCode; cause: string }
>;
export type ModelThreadMessage = { kind: "ready" } | { kind: "result"; result: ModelThreadResult };

// Runs the pipeline on its own thread because inference and pixel math block their event loop,
// which would otherwise stop lease renewal. Handles one job at a time. A dead thread exits the
// process so the supervisor restarts it and the expired lease retries the job.
export async function createBiRefNetAdapter(options: { modelPath: string; threadUrl: URL }) {
  const thread = new Worker(options.threadUrl, {
    workerData: { modelPath: options.modelPath },
    // The main thread owns telemetry. A second SDK here would have nothing to instrument.
    env: { ...process.env, OTEL_ENABLED: "false" },
  });
  let closing = false;
  thread.on("error", (error) => console.error("Background removal model thread failed", error));
  thread.on("exit", (code) => {
    if (!closing) process.exit(code || 1);
  });

  await nextMessage();

  function nextMessage() {
    return new Promise<ModelThreadMessage>((resolve) => {
      thread.once("message", (message: ModelThreadMessage) => resolve(message));
    });
  }

  return {
    async removeBackground(job: ModelThreadJob): Promise<ModelThreadResult> {
      const message = nextMessage();
      thread.postMessage(job);
      const reply = await message;
      if (reply.kind !== "result") throw new Error(`Unexpected model thread reply: ${reply.kind}`);
      return reply.result;
    },

    async close() {
      closing = true;
      await thread.terminate();
    },
  };
}
