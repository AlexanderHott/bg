import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { InferenceSession, Tensor } from "onnxruntime-node";
import sharp from "sharp";

import {
  MAX_BACKGROUND_REMOVAL_INPUT_PIXELS,
  MAX_BACKGROUND_REMOVAL_INPUT_SIDE,
  MAX_BACKGROUND_REMOVAL_INPUT_SIZE_BYTES,
} from "./policy";
import type { BackgroundRemovalFailureCode } from "./schema";

const MODEL_INPUT_SIZE = 1_024;
const EXPECTED_MODEL_SHA256 = "5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333";
const SUPPORTED_FORMATS = new Set(["avif", "jpeg", "png", "webp"]);
const IMAGE_NET_MEAN = [0.485, 0.456, 0.406] as const;
const IMAGE_NET_STANDARD_DEVIATION = [0.229, 0.224, 0.225] as const;
type ImageMetadata = Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;

export class BackgroundRemovalImageError extends Error {
  constructor(
    readonly failureCode: BackgroundRemovalFailureCode,
    options?: ErrorOptions,
  ) {
    super(failureCode, options);
  }
}

export async function createBiRefNetAdapter(modelPath: string) {
  const hash = await sha256(modelPath);
  if (hash !== EXPECTED_MODEL_SHA256) {
    throw new Error(`BiRefNet model checksum mismatch: ${hash}`);
  }

  sharp.cache(false);
  const session = await InferenceSession.create(modelPath, {
    enableCpuMemArena: false,
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  });
  if (session.inputNames.length !== 1 || session.outputNames.length < 1) {
    throw new Error("BiRefNet model has an unexpected input or output contract");
  }

  return {
    async warmUp() {
      await runModel(
        session,
        new Tensor("float32", new Float32Array(3 * MODEL_INPUT_SIZE ** 2), [
          1,
          3,
          MODEL_INPUT_SIZE,
          MODEL_INPUT_SIZE,
        ]),
      );
    },

    async removeBackground(inputPath: string, outputPath: string) {
      const inputStat = await stat(inputPath);
      if (inputStat.size < 1) throw new BackgroundRemovalImageError("invalid_image");
      if (inputStat.size > MAX_BACKGROUND_REMOVAL_INPUT_SIZE_BYTES) {
        throw new BackgroundRemovalImageError("image_too_large");
      }

      let metadata: ImageMetadata;
      try {
        metadata = await sharp(inputPath, { animated: true }).metadata();
      } catch (error) {
        throw new BackgroundRemovalImageError("invalid_image", { cause: error });
      }
      validateMetadata(metadata);

      let source: Awaited<ReturnType<typeof decodeSource>>;
      try {
        source = await decodeSource(inputPath);
      } catch (error) {
        throw new BackgroundRemovalImageError("decode_failed", { cause: error });
      }
      validateDimensions(source.info.width, source.info.height);

      const inputTensor = await createInputTensor(source);
      let logits: Tensor;
      try {
        logits = await runModel(session, inputTensor);
      } catch (error) {
        throw new BackgroundRemovalImageError("inference_failed", { cause: error });
      }

      const alpha = await resizeAlpha(logits, source.info.width, source.info.height);
      const output = Buffer.from(source.data);
      for (let pixel = 0; pixel < alpha.length; pixel += 1) {
        const sourceAlpha = output[pixel * 4 + 3] ?? 0;
        output[pixel * 4 + 3] = Math.round(((alpha[pixel] ?? 0) * sourceAlpha) / 255);
      }

      try {
        await sharp(output, {
          raw: { width: source.info.width, height: source.info.height, channels: 4 },
        })
          .png()
          .toFile(outputPath);
      } catch (error) {
        throw new BackgroundRemovalImageError("decode_failed", { cause: error });
      }

      return { width: source.info.width, height: source.info.height };
    },
  };
}

async function runModel(session: InferenceSession, input: Tensor) {
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) throw new Error("BiRefNet model names disappeared");

  const outputs = await session.run({ [inputName]: input });
  const output = outputs[outputName];
  if (!output) throw new Error("BiRefNet model did not return its expected output");
  return output;
}

async function decodeSource(inputPath: string) {
  return sharp(inputPath, { limitInputPixels: MAX_BACKGROUND_REMOVAL_INPUT_PIXELS })
    .rotate()
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function createInputTensor(source: Awaited<ReturnType<typeof decodeSource>>) {
  const rgb = await sharp(source.data, {
    raw: {
      width: source.info.width,
      height: source.info.height,
      channels: 4,
    },
  })
    .removeAlpha()
    .resize(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, { fit: "fill" })
    .raw()
    .toBuffer();

  const pixels = MODEL_INPUT_SIZE ** 2;
  const tensorData = new Float32Array(3 * pixels);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = (rgb[pixel * 3 + channel] ?? 0) / 255;
      tensorData[channel * pixels + pixel] =
        (value - IMAGE_NET_MEAN[channel]) / IMAGE_NET_STANDARD_DEVIATION[channel];
    }
  }
  return new Tensor("float32", tensorData, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
}

async function resizeAlpha(logits: Tensor, width: number, height: number) {
  if (!(logits.data instanceof Float32Array) || logits.data.length !== MODEL_INPUT_SIZE ** 2) {
    throw new BackgroundRemovalImageError("inference_failed", {
      cause: new Error(`Unexpected BiRefNet output shape: ${logits.dims.join("x")}`),
    });
  }

  const alpha = Buffer.allocUnsafe(logits.data.length);
  for (let index = 0; index < logits.data.length; index += 1) {
    const value = logits.data[index] ?? 0;
    const sigmoid =
      value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
    alpha[index] = Math.round(sigmoid * 255);
  }

  return sharp(alpha, { raw: { width: MODEL_INPUT_SIZE, height: MODEL_INPUT_SIZE, channels: 1 } })
    .resize(width, height, { fit: "fill" })
    .toColourspace("b-w")
    .raw()
    .toBuffer();
}

function validateMetadata(metadata: ImageMetadata) {
  if (!metadata.format || !SUPPORTED_FORMATS.has(metadata.format)) {
    throw new BackgroundRemovalImageError("unsupported_image");
  }
  if ((metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height) {
    throw new BackgroundRemovalImageError("invalid_image");
  }
  validateDimensions(metadata.width, metadata.height);
}

function validateDimensions(width: number, height: number) {
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_BACKGROUND_REMOVAL_INPUT_SIDE ||
    height > MAX_BACKGROUND_REMOVAL_INPUT_SIDE ||
    width * height > MAX_BACKGROUND_REMOVAL_INPUT_PIXELS
  ) {
    throw new BackgroundRemovalImageError("image_too_large");
  }
}

async function sha256(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
