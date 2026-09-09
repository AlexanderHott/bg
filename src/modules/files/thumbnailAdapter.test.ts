import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { writeImageThumbnail } from "./thumbnailAdapter";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "bg-thumbnail-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

test.each([
  [1600, 800, 640, 320],
  [800, 1600, 320, 640],
  [48, 32, 48, 32],
])(
  "bounds a %i × %i image without cropping or upscaling",
  async (width, height, outWidth, outHeight) => {
    const data = await sharp({
      create: { width, height, channels: 4, background: { r: 220, g: 80, b: 40, alpha: 0.5 } },
    })
      .raw()
      .toBuffer();
    const path = join(directory, "thumbnail.webp");
    const result = await writeImageThumbnail({ data, width, height, path });
    expect(result).toEqual({ path, sizeBytes: (await stat(path)).size });
    expect(await sharp(path).metadata()).toMatchObject({
      format: "webp",
      width: outWidth,
      height: outHeight,
      hasAlpha: true,
    });
    const pixels = await sharp(path).raw().toBuffer();
    const alpha = new Set<number>();
    for (let index = 3; index < pixels.length; index += 4) {
      alpha.add(pixels[index]!);
    }
    expect(alpha).toEqual(new Set([128]));
  },
);

test("returns no thumbnail when encoding or writing fails", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  await expect(
    writeImageThumbnail({
      data: Buffer.alloc(4),
      width: 1,
      height: 1,
      path: join(directory, "missing", "thumbnail.webp"),
    }),
  ).resolves.toBeUndefined();
  expect(warning).toHaveBeenCalledOnce();
});
