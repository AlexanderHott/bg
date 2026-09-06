import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Tensor } from "onnxruntime-node";
import sharp from "sharp";
import { expect, test, vi } from "vite-plus/test";

import { createBiRefNetAdapter } from "./modelAdapter";

const { run } = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("node:crypto", () => ({
  createHash: () => ({
    update: vi.fn(),
    digest: () => "5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333",
  }),
}));

vi.mock("onnxruntime-node", async (importOriginal) => ({
  ...(await importOriginal<typeof import("onnxruntime-node")>()),
  InferenceSession: {
    create: async () => ({ inputNames: ["input"], outputNames: ["output"], run }),
  },
}));

test.each([255, 128])(
  "keeps the resized mask aligned with source pixels at alpha %i",
  async (sourceAlpha) => {
    const directory = await mkdtemp(join(tmpdir(), "bg-mask-"));
    try {
      const modelPath = join(directory, "model.onnx");
      const inputPath = join(directory, "input.png");
      const outputPath = join(directory, "output.png");
      await writeFile(modelPath, "stub model");
      await sharp({
        create: {
          width: 60,
          height: 40,
          channels: 4,
          background: { r: 80, g: 120, b: 160, alpha: sourceAlpha / 255 },
        },
      })
        .png()
        .toFile(inputPath);

      // A solid foreground on the right must stay on the right in every output row.
      const logits = Float32Array.from({ length: 1024 ** 2 }, (_, index) =>
        index % 1024 < 512 ? -100 : 100,
      );
      run.mockResolvedValue({ output: new Tensor("float32", logits, [1, 1, 1024, 1024]) });
      const adapter = await createBiRefNetAdapter(modelPath);
      await adapter.removeBackground(inputPath, outputPath);

      const { data, info } = await sharp(outputPath).raw().toBuffer({ resolveWithObject: true });
      expect([info.width, info.height, info.channels]).toEqual([60, 40, 4]);
      for (let y = 0; y < info.height; y += 1) {
        for (const x of [5, 20, 40, 55]) {
          const offset = (y * info.width + x) * 4;
          expect([...data.subarray(offset, offset + 3)]).toEqual([80, 120, 160]);
          expect(data[offset + 3], `alpha at (${x}, ${y})`).toBe(x < 30 ? 0 : sourceAlpha);
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
