import { describe, expect, test } from "vite-plus/test";

import {
  DEFAULT_SETTINGS,
  formatLabel,
  normalizeMediaUrl,
  selectFormats,
  type MediaMetadata,
} from "./policy";
import { normalizeMetadata } from "./ytDlpAdapter";

const metadata: MediaMetadata = {
  title: "Example",
  formats: [
    {
      id: "combined",
      extension: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      height: 360,
      approximateSize: false,
    },
    { id: "aac", extension: "m4a", audioCodec: "aac", bitrate: 128, approximateSize: false },
    { id: "opus", extension: "webm", audioCodec: "opus", bitrate: 160, approximateSize: false },
    { id: "720", extension: "webm", videoCodec: "vp9", height: 720, approximateSize: false },
    { id: "1080", extension: "webm", videoCodec: "vp9", height: 1080, approximateSize: false },
    { id: "2160", extension: "webm", videoCodec: "av1", height: 2160, approximateSize: false },
  ],
};

describe("media choices", () => {
  test("keeps the highest source video and audio without requiring conversion", () => {
    expect(selectFormats(metadata, DEFAULT_SETTINGS, null).map((format) => format.id)).toEqual([
      "2160",
      "opus",
    ]);
    expect(
      selectFormats(metadata, { mode: "audio", conversion: "original" }, null).map(
        (format) => format.id,
      ),
    ).toEqual(["opus"]);
  });
  test("applies resolution ceilings independently and never upscales", () => {
    expect(selectFormats(metadata, { ...DEFAULT_SETTINGS, maxHeight: 1080 }, null)[0]?.id).toBe(
      "1080",
    );
    expect(
      selectFormats(
        {
          ...metadata,
          formats: metadata.formats.filter(
            (format) => format.id !== "1080" && format.id !== "2160",
          ),
        },
        { ...DEFAULT_SETTINGS, maxHeight: 1080 },
        null,
      )[0]?.id,
    ).toBe("720");
  });
  test("preserves audio when it is available only in a combined stream", () => {
    const combinedAudio = {
      ...metadata,
      formats: metadata.formats.filter((format) => format.videoCodec),
    };
    expect(selectFormats(combinedAudio, DEFAULT_SETTINGS, null).map((format) => format.id)).toEqual(
      ["2160", "combined"],
    );
    expect(
      selectFormats(combinedAudio, DEFAULT_SETTINGS, { videoId: "1080" }).map(
        (format) => format.id,
      ),
    ).toEqual(["1080", "combined"]);
    expect(
      selectFormats(combinedAudio, { ...DEFAULT_SETTINGS, maxHeight: 720 }, null).map(
        (format) => format.id,
      ),
    ).toEqual(["720", "combined"]);
    expect(
      selectFormats(combinedAudio, { mode: "audio", conversion: "original" }, null).map(
        (format) => format.id,
      ),
    ).toEqual(["combined"]);
    expect(selectFormats(combinedAudio, DEFAULT_SETTINGS, { videoId: "combined" })).toHaveLength(1);
  });
  test("exact choices override preferences and never silently fall back", () => {
    expect(
      selectFormats(
        metadata,
        { ...DEFAULT_SETTINGS, maxHeight: 720 },
        { videoId: "1080", audioId: "aac" },
      ).map((format) => format.id),
    ).toEqual(["1080", "aac"]);
    expect(() => selectFormats(metadata, DEFAULT_SETTINGS, { videoId: "removed" })).toThrow(
      "selected format is unavailable",
    );
    expect(() => selectFormats(metadata, DEFAULT_SETTINGS, { audioId: "removed" })).toThrow(
      "selected format is unavailable",
    );
    expect(() =>
      selectFormats(metadata, DEFAULT_SETTINGS, { videoId: "combined", audioId: "opus" }),
    ).toThrow("already contains audio");
  });
  test("labels estimates and normalizes only downloadable formats without exposing URLs", () => {
    const result = normalizeMetadata({
      title: "Example",
      formats: [
        {
          format_id: "1",
          ext: "webm",
          vcodec: "vp9",
          acodec: "none",
          protocol: "https",
          height: 1080,
          filesize_approx: 1230000,
          url: "https://secret.example/token",
        },
        { format_id: "2", ext: "mp4", vcodec: "h264", protocol: "rtmp" },
        { format_id: "3", ext: "mp4", vcodec: "h264", protocol: "https", has_drm: true },
      ],
    });
    expect(result.formats).toHaveLength(1);
    expect(formatLabel(result.formats[0]!)).toContain("~1.2 MB");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(() => normalizeMetadata({ live_status: "is_live" })).toThrow("Live and upcoming");
  });
  test("accepts only credential-free HTTPS source URLs", () => {
    expect(normalizeMediaUrl(" https://example.com/video#section ")).toBe(
      "https://example.com/video",
    );
    for (const url of [
      "file:///etc/passwd",
      "http://example.com",
      "https://user:password@example.com",
      "https://example.com:9000",
      "--exec=anything",
    ])
      expect(() => normalizeMediaUrl(url)).toThrow();
  });
});
