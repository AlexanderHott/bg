import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { Tensor } from "onnxruntime-node";
import sharp from "sharp";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { createBiRefNetPipeline } from "./modelPipeline";

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

const logitsTensor = (logit: (index: number) => number) =>
  new Tensor(
    "float32",
    Float32Array.from({ length: 1024 ** 2 }, (_, index) => logit(index)),
    [1, 1, 1024, 1024],
  );

let directory: string;
let modelPath: string;
let outputPath: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "bg-pipeline-"));
  modelPath = join(directory, "model.onnx");
  outputPath = join(directory, "output.png");
  await writeFile(modelPath, "stub model");
  run.mockReset();
});

afterEach(() => rm(directory, { recursive: true, force: true }));

test("accepts a decoded AVIF image", async () => {
  const inputPath = join(directory, "input.avif");
  await sharp({ create: { width: 8, height: 6, channels: 3, background: "red" } })
    .avif()
    .toFile(inputPath);
  run.mockResolvedValue({ output: logitsTensor(() => 0) });

  const pipeline = await createBiRefNetPipeline(modelPath);
  await pipeline.removeBackground({ inputPath, outputPath });

  expect(await sharp(outputPath).metadata()).toMatchObject({
    format: "png",
    width: 8,
    height: 6,
    hasAlpha: true,
  });
});

test.each(["small", "oriented"])("matches the Python input tensor for %s input", async (name) => {
  const fixtures = new URL("./fixtures/", import.meta.url);
  const tensorBytes = gunzipSync(await readFile(new URL(`${name}-tensor.f32.gz`, fixtures)));
  const expected = new Float32Array(Uint8Array.from(tensorBytes).buffer);
  let maxError = 0;
  run.mockImplementationOnce(async (inputs: Record<string, Tensor>) => {
    const actual = inputs.input?.data;
    if (!(actual instanceof Float32Array)) throw new Error("Expected float32 input");
    expect(actual.length).toBe(expected.length);
    for (let index = 0; index < actual.length; index += 1) {
      maxError = Math.max(maxError, Math.abs(actual[index] - expected[index]));
    }
    return { output: logitsTensor(() => 0) };
  });

  const pipeline = await createBiRefNetPipeline(modelPath);
  await pipeline.removeBackground({
    inputPath: new URL(`${name}-input.png`, fixtures).pathname,
    outputPath,
  });

  // Permit two RGB quantization levels between Pillow and libvips resampling.
  expect(maxError).toBeLessThanOrEqual(2 / 255 / 0.224 + 0.000001);
});

test.each([255, 128])(
  "keeps the resized mask aligned with source pixels at alpha %i",
  async (sourceAlpha) => {
    const inputPath = join(directory, "input.png");
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
    run.mockResolvedValue({ output: logitsTensor((index) => (index % 1024 < 512 ? -100 : 100)) });

    const pipeline = await createBiRefNetPipeline(modelPath);
    await pipeline.removeBackground({ inputPath, outputPath });

    const { data, info } = await sharp(outputPath).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([60, 40, 4]);
    for (let y = 0; y < info.height; y += 1) {
      for (const x of [5, 20, 40, 55]) {
        const offset = (y * info.width + x) * 4;
        // Invisible pixels drop their color, so the original background can't be recovered.
        expect([...data.subarray(offset, offset + 3)]).toEqual(x < 30 ? [0, 0, 0] : [80, 120, 160]);
        expect(data[offset + 3], `alpha at (${x}, ${y})`).toBe(x < 30 ? 0 : sourceAlpha);
      }
    }
  },
);

test("makes a confident foreground fully opaque", async () => {
  const inputPath = join(directory, "input.png");
  await sharp({ create: { width: 16, height: 16, channels: 3, background: "red" } })
    .png()
    .toFile(inputPath);
  // Logits this size are ordinary for the real model but keep sigmoid below 1.
  run.mockResolvedValue({ output: logitsTensor(() => 25) });

  const pipeline = await createBiRefNetPipeline(modelPath);
  await pipeline.removeBackground({ inputPath, outputPath });

  const { data } = await sharp(outputPath).raw().toBuffer({ resolveWithObject: true });
  expect(data[3]).toBe(255);
});

test("publishes the PNG and remaining preview when one thumbnail cannot be written", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    run.mockResolvedValue({ output: logitsTensor(() => 0) });
    const pipeline = await createBiRefNetPipeline(modelPath);
    const result = await pipeline.removeBackground({
      inputPath: new URL("./fixtures/small-input.png", import.meta.url).pathname,
      outputPath,
      thumbnailPaths: {
        input: join(directory, "missing", "thumbnail.webp"),
        output: join(directory, "output-thumbnail.webp"),
      },
    });
    expect(result.thumbnails.input).toBeUndefined();
    expect(result.thumbnails.output?.sizeBytes).toBeGreaterThan(0);
    expect(await sharp(outputPath).metadata()).toMatchObject({ format: "png", hasAlpha: true });
    expect(warning).toHaveBeenCalledOnce();
  } finally {
    warning.mockRestore();
  }
});
