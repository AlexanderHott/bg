export const SUPPORTED_IMAGE_MEDIA_TYPES = [
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const supportedImageMediaTypes = new Set<string>(SUPPORTED_IMAGE_MEDIA_TYPES);

export function isSupportedImageMediaType(mediaType: string) {
  return supportedImageMediaTypes.has(mediaType);
}
