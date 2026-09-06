// Pillow places samples at pixel centers and rounds each separable pass to uint8.
// Keeping that convention here avoids libvips' different upsampling alignment.
export function resizePixels(options: {
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
  targetWidth: number;
  targetHeight: number;
  kernel: "linear" | "cubic";
}) {
  const { data, width, height, channels, targetWidth, targetHeight, kernel } = options;
  const horizontal = coefficients(width, targetWidth, kernel);
  const vertical = coefficients(height, targetHeight, kernel);
  const intermediate = resizeHorizontal(data, width, height, channels, horizontal);
  return resizeVertical(intermediate, targetWidth, channels, vertical);
}

function resizeHorizontal(
  data: Uint8Array,
  width: number,
  height: number,
  channels: number,
  samples: ReturnType<typeof coefficients>,
) {
  const targetWidth = samples.length;
  const output = Buffer.allocUnsafe(targetWidth * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const { start, weights } = samples[x];
      for (let channel = 0; channel < channels; channel += 1) {
        let sum = 0;
        for (let offset = 0; offset < weights.length; offset += 1) {
          sum += data[(y * width + start + offset) * channels + channel] * weights[offset];
        }
        output[(y * targetWidth + x) * channels + channel] = toByte(sum);
      }
    }
  }
  return output;
}

function resizeVertical(
  data: Uint8Array,
  width: number,
  channels: number,
  samples: ReturnType<typeof coefficients>,
) {
  const output = Buffer.allocUnsafe(width * samples.length * channels);
  for (let y = 0; y < samples.length; y += 1) {
    const { start, weights } = samples[y];
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        let sum = 0;
        for (let offset = 0; offset < weights.length; offset += 1) {
          sum += data[((start + offset) * width + x) * channels + channel] * weights[offset];
        }
        output[(y * width + x) * channels + channel] = toByte(sum);
      }
    }
  }
  return output;
}

function coefficients(inputSize: number, outputSize: number, kernel: "linear" | "cubic") {
  const scale = inputSize / outputSize;
  const filterScale = Math.max(1, scale);
  const support = (kernel === "linear" ? 1 : 2) * filterScale;
  return Array.from({ length: outputSize }, (_, position) => {
    const center = (position + 0.5) * scale;
    const start = Math.max(0, Math.floor(center - support + 0.5));
    const end = Math.min(inputSize, Math.floor(center + support + 0.5));
    const weights = Float64Array.from({ length: end - start }, (_, offset) => {
      const distance = Math.abs((start + offset + 0.5 - center) / filterScale);
      if (kernel === "linear") return Math.max(0, 1 - distance);
      if (distance < 1) return (1.5 * distance - 2.5) * distance * distance + 1;
      if (distance < 2) return ((-0.5 * distance + 2.5) * distance - 4) * distance + 2;
      return 0;
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    for (let index = 0; index < weights.length; index += 1) weights[index] /= total;
    return { start, weights };
  });
}

function toByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
