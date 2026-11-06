import { expect, test } from "vite-plus/test";

import { estimateForeground } from "./foreground";

const plane = { width: 256, height: 64 };

// A soft vertical edge: red subject on the left over a green background on the right.
function compositeEdge() {
  const pixels = plane.width * plane.height;
  const rgba = new Uint8Array(pixels * 4);
  const alpha = new Uint8Array(pixels);
  for (let y = 0; y < plane.height; y += 1) {
    for (let x = 0; x < plane.width; x += 1) {
      const pixel = y * plane.width + x;
      const coverage = Math.max(0, Math.min(1, (138 - x) / 20));
      alpha[pixel] = Math.round(coverage * 255);
      rgba[pixel * 4] = Math.round(220 * coverage);
      rgba[pixel * 4 + 1] = Math.round(240 * (1 - coverage));
      rgba[pixel * 4 + 2] = 30;
      rgba[pixel * 4 + 3] = 255;
    }
  }
  return { rgba, alpha };
}

test("removes background color from partly transparent pixels", () => {
  const { rgba, alpha } = compositeEdge();
  const before = rgba.slice();
  estimateForeground(rgba, alpha, plane);

  for (const x of [120, 125, 128, 131, 135]) {
    const offset = (32 * plane.width + x) * 4;
    expect(alpha[32 * plane.width + x], `alpha at ${x}`).toBeGreaterThan(0);
    expect(alpha[32 * plane.width + x], `alpha at ${x}`).toBeLessThan(255);
    expect(rgba[offset + 1], `green at ${x}`).toBeLessThan(before[offset + 1]);
    expect(rgba[offset], `red at ${x}`).toBeGreaterThan(before[offset]);
  }
});

test("keeps fully opaque pixels at their exact source color", () => {
  const { rgba, alpha } = compositeEdge();
  const before = rgba.slice();
  estimateForeground(rgba, alpha, plane);

  for (let pixel = 0; pixel < alpha.length; pixel += 1) {
    if (alpha[pixel] !== 255) continue;
    expect([...rgba.subarray(pixel * 4, pixel * 4 + 3)]).toEqual([
      ...before.subarray(pixel * 4, pixel * 4 + 3),
    ]);
  }
});

test("leaves a uniform image unchanged at any alpha", () => {
  const pixels = plane.width * plane.height;
  const rgba = new Uint8Array(pixels * 4);
  const alpha = new Uint8Array(pixels);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    rgba.set([80, 120, 160, 255], pixel * 4);
    alpha[pixel] = pixel % 256;
  }
  estimateForeground(rgba, alpha, plane);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    expect([...rgba.subarray(pixel * 4, pixel * 4 + 3)]).toEqual([80, 120, 160]);
  }
});
