import sharp from "sharp";

// Use oriented RGBA pixels already decoded by the worker. Preview failures are nonfatal.
export async function writeImageThumbnail(options: {
  data: Buffer;
  width: number;
  height: number;
  path: string;
}) {
  try {
    const result = await sharp(options.data, {
      raw: { width: options.width, height: options.height, channels: 4 },
    })
      .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(options.path);
    return { path: options.path, sizeBytes: result.size };
  } catch (error) {
    console.warn("Could not generate image thumbnail", { path: options.path, error });
    return undefined;
  }
}

export type ImageThumbnail = NonNullable<Awaited<ReturnType<typeof writeImageThumbnail>>>;
