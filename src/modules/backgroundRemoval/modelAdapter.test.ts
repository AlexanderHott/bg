import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

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

test("accepts a decoded AVIF image", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bg-avif-"));
  try {
    const modelPath = join(directory, "model.onnx");
    const inputPath = join(directory, "input.avif");
    const outputPath = join(directory, "output.png");
    await writeFile(modelPath, "stub model");
    await sharp({
      create: { width: 8, height: 6, channels: 3, background: "red" },
    })
      .avif()
      .toFile(inputPath);
    run.mockResolvedValue({
      output: new Tensor("float32", new Float32Array(1024 ** 2), [1, 1, 1024, 1024]),
    });
    const adapter = await createBiRefNetAdapter(modelPath);
    await adapter.removeBackground(inputPath, outputPath);
    expect(await sharp(outputPath).metadata()).toMatchObject({
      format: "png",
      width: 8,
      height: 6,
      hasAlpha: true,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test.each(["small", "oriented"])(
  "matches the Python transform fixtures for %s input",
  async (name) => {
    const directory = await mkdtemp(join(tmpdir(), "bg-reference-"));
    const fixtures = new URL("./fixtures/", import.meta.url);
    try {
      const modelPath = join(directory, "model.onnx");
      const outputPath = join(directory, "output.png");
      await writeFile(modelPath, "stub model");
      const tensorBytes = gunzipSync(await readFile(new URL(`${name}-tensor.f32.gz`, fixtures)));
      const expectedTensor = new Float32Array(Uint8Array.from(tensorBytes).buffer);
      const logitsBytes = gunzipSync(await readFile(new URL("logits.f32.gz", fixtures)));
      const logits = new Float32Array(Uint8Array.from(logitsBytes).buffer);
      let maxTensorError = 0;
      run.mockImplementationOnce(async (inputs: Record<string, Tensor>) => {
        const actual = inputs.input?.data;
        expect(actual).toBeInstanceOf(Float32Array);
        if (!(actual instanceof Float32Array)) throw new Error("Expected float32 input");
        expect(actual.length).toBe(expectedTensor.length);
        for (let index = 0; index < actual.length; index += 1) {
          maxTensorError = Math.max(
            maxTensorError,
            Math.abs(actual[index] - expectedTensor[index]),
          );
        }
        return { output: new Tensor("float32", logits, [1, 1, 1024, 1024]) };
      });
      const adapter = await createBiRefNetAdapter(modelPath);
      await adapter.removeBackground(new URL(`${name}-input.png`, fixtures).pathname, outputPath);
      // Permit two RGB quantization levels between Pillow and libvips resampling.
      expect(maxTensorError).toBeLessThanOrEqual(2 / 255 / 0.224 + 0.000001);
      const actual = await sharp(outputPath).raw().toBuffer({ resolveWithObject: true });
      const expected = await sharp(await readFile(new URL(`${name}-output.png`, fixtures)))
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(actual.info).toEqual(expected.info);
      let maxAlphaError = 0;
      let maxRgbError = 0;
      for (let index = 0; index < actual.data.length; index += 1) {
        const difference = Math.abs(actual.data[index] - expected.data[index]);
        if (index % 4 === 3) maxAlphaError = Math.max(maxAlphaError, difference);
        else maxRgbError = Math.max(maxRgbError, difference);
      }
      expect(maxRgbError).toBe(0);
      expect(maxAlphaError).toBeLessThanOrEqual(2);
      const metadata = await sharp(outputPath).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

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
