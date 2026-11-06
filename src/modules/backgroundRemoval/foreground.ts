type Plane = { width: number; height: number };
type FusionPass = { radius: number; meanCoverage: Float32Array };
type Workspace = {
  plane: Plane;
  coverage: Float32Array;
  image: Float32Array;
  foreground: Float32Array;
  background: Float32Array;
  blurred: Float32Array;
  scratch: Float32Array;
};

const FOREGROUND_RADII = [45, 3];
const EPSILON = 1e-5;

// Replaces RGB in place so partly transparent pixels stop carrying the old background's color.
// Implements two-pass Blur-Fusion (Forte 2021), the estimator BiRefNet's own demo uses.
// Fully opaque pixels keep their exact source color.
export function estimateForeground(rgba: Uint8Array, alpha: Uint8Array, plane: Plane) {
  const pixels = plane.width * plane.height;
  const workspace: Workspace = {
    plane,
    coverage: Float32Array.from(alpha, (value) => value / 255),
    image: new Float32Array(pixels),
    foreground: new Float32Array(pixels),
    background: new Float32Array(pixels),
    blurred: new Float32Array(pixels),
    scratch: new Float32Array(pixels),
  };
  const passes = FOREGROUND_RADII.map((radius) => ({
    radius,
    meanCoverage: boxMean({
      source: workspace.coverage,
      target: new Float32Array(pixels),
      scratch: workspace.scratch,
      plane,
      radius,
    }),
  }));

  for (let channel = 0; channel < 3; channel += 1) {
    loadChannel(rgba, channel, workspace);
    for (const pass of passes) runFusionPass(pass, workspace);
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      if (alpha[pixel] !== 255) rgba[pixel * 4 + channel] = Math.round(workspace.foreground[pixel]);
    }
  }
}

function loadChannel(rgba: Uint8Array, channel: number, workspace: Workspace) {
  const { image, foreground, background } = workspace;
  for (let pixel = 0; pixel < image.length; pixel += 1) {
    const value = rgba[pixel * 4 + channel];
    image[pixel] = value;
    foreground[pixel] = value;
    background[pixel] = value;
  }
}

// Refines both color estimates from coverage-weighted means of the previous ones.
function runFusionPass({ radius, meanCoverage }: FusionPass, workspace: Workspace) {
  const { plane, coverage, image, foreground, background, blurred, scratch } = workspace;
  for (let pixel = 0; pixel < image.length; pixel += 1) {
    foreground[pixel] *= coverage[pixel];
    background[pixel] *= 1 - coverage[pixel];
  }
  boxMean({ source: foreground, target: blurred, scratch, plane, radius });
  boxMean({ source: background, target: background, scratch, plane, radius });
  for (let pixel = 0; pixel < image.length; pixel += 1) {
    const a = coverage[pixel];
    const meanForeground = blurred[pixel] / (meanCoverage[pixel] + EPSILON);
    const meanBackground = background[pixel] / (1 - meanCoverage[pixel] + EPSILON);
    const estimate =
      meanForeground + a * (image[pixel] - a * meanForeground - (1 - a) * meanBackground);
    foreground[pixel] = Math.max(0, Math.min(255, estimate));
    background[pixel] = meanBackground;
  }
}

// Mean over a square window clipped at image edges, in O(pixels) for any radius.
// `target` may be `source`; `scratch` must be a different array of the same length.
function boxMean(options: {
  source: Float32Array;
  target: Float32Array;
  scratch: Float32Array;
  plane: Plane;
  radius: number;
}) {
  const { source, target, scratch, plane, radius } = options;
  for (let y = 0; y < plane.height; y += 1) {
    meanAlongRow(source, scratch, y * plane.width, plane.width, radius);
  }
  meanAlongColumns(scratch, target, plane, radius);
  return target;
}

function meanAlongRow(
  source: Float32Array,
  target: Float32Array,
  row: number,
  width: number,
  radius: number,
) {
  let sum = 0;
  for (let x = 0; x <= Math.min(radius, width - 1); x += 1) sum += source[row + x];
  for (let x = 0; x < width; x += 1) {
    const count = Math.min(width - 1, x + radius) - Math.max(0, x - radius) + 1;
    target[row + x] = sum / count;
    if (x + radius + 1 < width) sum += source[row + x + radius + 1];
    if (x >= radius) sum -= source[row + x - radius];
  }
}

// Walks rows rather than columns so large images stay cache-friendly.
function meanAlongColumns(
  source: Float32Array,
  target: Float32Array,
  { width, height }: Plane,
  radius: number,
) {
  const sums = new Float64Array(width);
  for (let y = 0; y <= Math.min(radius, height - 1); y += 1) addRow(sums, source, y * width, 1);
  for (let y = 0; y < height; y += 1) {
    const count = Math.min(height - 1, y + radius) - Math.max(0, y - radius) + 1;
    for (let x = 0; x < width; x += 1) target[y * width + x] = sums[x] / count;
    if (y + radius + 1 < height) addRow(sums, source, (y + radius + 1) * width, 1);
    if (y >= radius) addRow(sums, source, (y - radius) * width, -1);
  }
}

function addRow(sums: Float64Array, source: Float32Array, row: number, sign: 1 | -1) {
  for (let x = 0; x < sums.length; x += 1) sums[x] += sign * source[row + x];
}
