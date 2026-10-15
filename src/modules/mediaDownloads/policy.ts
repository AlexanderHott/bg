import * as v from "valibot";

export const MAX_BATCH_ITEMS = 1_000;
export const MAX_MEDIA_BYTES = 4_000_000_000;
export const TASK_LEASE_MS = 60_000;
export const METADATA_CACHE_MS = 15 * 60_000;

export const DownloadSettings = v.object({
  mode: v.picklist(["video", "audio"]),
  maxHeight: v.optional(v.picklist([720, 1080, 2160])),
  conversion: v.picklist(["original", "mp4", "mp3", "m4a"]),
});
export type DownloadSettings = v.InferOutput<typeof DownloadSettings>;
export const DEFAULT_SETTINGS = { mode: "video", conversion: "original" } as const;

export const FormatSelection = v.object({
  videoId: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(200))),
  audioId: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(200))),
});
export type FormatSelection = v.InferOutput<typeof FormatSelection>;

export type MediaFormat = {
  id: string;
  extension: string;
  videoCodec?: string;
  audioCodec?: string;
  height?: number;
  fps?: number;
  bitrate?: number;
  language?: string;
  sizeBytes?: number;
  approximateSize: boolean;
};
export type MediaMetadata = {
  title: string;
  duration?: number;
  uploader?: string;
  description?: string;
  uploadDate?: string;
  viewCount?: number;
  formats: MediaFormat[];
};
export type MediaProgress = {
  phase: "downloading" | "converting" | "uploading";
  downloadedBytes?: number;
  totalBytes?: number;
  speed?: number;
  eta?: number;
};

export class MediaError extends Error {
  constructor(
    public readonly code: "unavailable" | "needs_selection" | "limit" | "network" | "worker_lost",
    message: string,
  ) {
    super(message);
  }
}

export function normalizeMediaUrl(value: string) {
  const url = new URL(value.trim());
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new Error("Use a public HTTPS media or playlist URL without credentials.");
  }
  url.hash = "";
  return url.href;
}

export function validateSettings(settings: DownloadSettings) {
  if (
    (settings.mode === "video" && !["original", "mp4"].includes(settings.conversion)) ||
    (settings.mode === "audio" && !["original", "mp3", "m4a"].includes(settings.conversion))
  )
    throw new Error("The output format does not match audio/video mode.");
}

/** Resolves a preference against this item's current formats; exact choices never fall back. */
export function selectFormats(
  metadata: MediaMetadata,
  settings: DownloadSettings,
  selection: FormatSelection | null,
) {
  validateSettings(settings);
  const formats = metadata.formats;
  const audio = selection?.audioId
    ? formats.find(
        (format) => format.id === selection.audioId && format.audioCodec && !format.videoCodec,
      )
    : (formats.findLast((format) => format.audioCodec && !format.videoCodec) ??
      formats.findLast((format) => format.audioCodec));
  if (selection?.audioId && !audio) throw selectionError();
  if (settings.mode === "audio") {
    if (selection?.videoId) throw selectionError();
    if (!audio) throw selectionError();
    return [audio];
  }
  const video = selection?.videoId
    ? formats.find((format) => format.id === selection.videoId && format.videoCodec)
    : formats.findLast(
        (format) =>
          format.videoCodec &&
          (!settings.maxHeight ||
            (format.height !== undefined && format.height <= settings.maxHeight)),
      );
  if (!video) throw selectionError();
  if (video.audioCodec) {
    if (selection?.audioId)
      throw new MediaError(
        "needs_selection",
        "This video already contains audio. Choose a video-only stream to select a separate audio track.",
      );
    return [video];
  }
  return audio ? [video, audio] : [video];
}

function selectionError() {
  return new MediaError(
    "needs_selection",
    "The selected format is unavailable. Refresh the formats and choose again.",
  );
}

export function formatLabel(format: MediaFormat) {
  return [
    format.height ? `${format.height}p` : undefined,
    format.fps ? `${format.fps} fps` : undefined,
    format.videoCodec,
    format.audioCodec,
    format.language,
    format.bitrate ? `${Math.round(format.bitrate)} kbps` : undefined,
    format.extension,
    format.sizeBytes
      ? `${format.approximateSize ? "~" : ""}${(format.sizeBytes / 1_000_000).toFixed(1)} MB`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}
