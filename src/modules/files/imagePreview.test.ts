import { expect, test } from "vite-plus/test";

import { selectImagePreview } from "./imagePreview";

const original = { id: "input", url: "https://example.test/input.png?signature=1" };
const thumbnailUrl = "https://example.test/input-thumbnail.webp?signature=1";

test("keeps a preview through polling and upgrades when its thumbnail arrives", () => {
  const failed = new Set<string>();
  const first = selectImagePreview(original, undefined, failed);
  const refreshed = { ...original, url: "https://example.test/input.png?signature=2" };
  expect(selectImagePreview(refreshed, first, failed)).toBe(first);

  const thumbnail = selectImagePreview({ ...refreshed, thumbnailUrl }, first, failed);
  expect(thumbnail.url).toBe(thumbnailUrl);
  expect(
    selectImagePreview({ ...refreshed, thumbnailUrl: `${thumbnailUrl}new` }, thumbnail, failed),
  ).toBe(thumbnail);
});

test("falls back from a failed thumbnail and retries with a refreshed signature", () => {
  const image = { ...original, thumbnailUrl };
  const failed = new Set<string>();
  const first = selectImagePreview(image, undefined, failed);
  failed.add(thumbnailUrl);
  const fallback = selectImagePreview(image, first, failed);
  expect(fallback.url).toBe(original.url);
  expect(selectImagePreview(image, fallback, failed)).toBe(fallback);

  const refreshed = { ...image, thumbnailUrl: `${thumbnailUrl}new` };
  expect(selectImagePreview(refreshed, fallback, failed).url).toBe(refreshed.thumbnailUrl);
});

test("stops retrying failed URLs until a fresh URL arrives", () => {
  const image = { ...original, thumbnailUrl };
  const failed = new Set([thumbnailUrl, original.url]);
  const unavailable = selectImagePreview(image, undefined, failed);
  expect(unavailable.url).toBeUndefined();
  const refreshed = { ...image, url: `${original.url}new` };
  expect(selectImagePreview(refreshed, unavailable, failed).url).toBe(refreshed.url);
});

test("switches between original and transparent files and supports optimistic entries", () => {
  const failed = new Set<string>();
  const pending = selectImagePreview({ id: original.id }, undefined, failed);
  expect(pending.url).toBeUndefined();
  const input = selectImagePreview({ ...original, thumbnailUrl }, pending, failed);
  const output = { id: "output", url: "output.png", thumbnailUrl: "output-thumbnail.webp" };
  const transparent = selectImagePreview(output, input, failed);
  expect(transparent.url).toBe(output.thumbnailUrl);
  expect(selectImagePreview({ ...original, thumbnailUrl }, transparent, failed).url).toBe(
    thumbnailUrl,
  );
});
