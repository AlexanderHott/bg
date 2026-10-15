import { spawn } from "node:child_process";
import { readdir, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

import * as v from "valibot";

import {
  MAX_BATCH_ITEMS,
  MAX_MEDIA_BYTES,
  MediaError,
  normalizeMediaUrl,
  selectFormats,
  type DownloadSettings,
  type FormatSelection,
  type MediaFormat,
  type MediaMetadata,
  type MediaProgress,
} from "./policy";

const optionalNumber = v.optional(v.nullable(v.number()));
const optionalString = v.optional(v.nullable(v.string()));
const RawFormat = v.object({
  format_id: v.string(),
  ext: optionalString,
  vcodec: optionalString,
  acodec: optionalString,
  height: optionalNumber,
  fps: optionalNumber,
  abr: optionalNumber,
  language: optionalString,
  filesize: optionalNumber,
  filesize_approx: optionalNumber,
  protocol: optionalString,
  has_drm: v.optional(v.nullable(v.boolean())),
});
const RawMetadata = v.object({
  title: optionalString,
  duration: optionalNumber,
  uploader: optionalString,
  channel: optionalString,
  description: optionalString,
  upload_date: optionalString,
  view_count: optionalNumber,
  live_status: optionalString,
  formats: v.optional(v.array(RawFormat), []),
});
const RawEntry = v.object({
  id: optionalString,
  title: optionalString,
  webpage_url: optionalString,
  url: optionalString,
  playlist_index: optionalNumber,
  ie_key: optionalString,
  extractor_key: optionalString,
});

export function normalizeMetadata(value: unknown): MediaMetadata {
  const raw = v.parse(RawMetadata, value);
  if (["is_live", "is_upcoming", "post_live"].includes(raw.live_status ?? ""))
    throw new MediaError("unavailable", "Live and upcoming streams are not supported.");
  const formats: MediaFormat[] = raw.formats
    .filter(
      (format) =>
        !format.has_drm &&
        ["https", "http", "http_dash_segments", "m3u8_native"].includes(format.protocol ?? ""),
    )
    .map((format) => ({
      id: format.format_id,
      extension: format.ext ?? "unknown",
      videoCodec: format.vcodec && format.vcodec !== "none" ? format.vcodec : undefined,
      audioCodec: format.acodec && format.acodec !== "none" ? format.acodec : undefined,
      height: format.height ?? undefined,
      fps: format.fps ?? undefined,
      bitrate: format.abr ?? undefined,
      language: format.language ?? undefined,
      sizeBytes: format.filesize ?? format.filesize_approx ?? undefined,
      approximateSize: !format.filesize && Boolean(format.filesize_approx),
    }))
    .filter((format) => format.audioCodec || format.videoCodec);
  return {
    title: raw.title ?? "Untitled media",
    duration: raw.duration ?? undefined,
    uploader: raw.channel ?? raw.uploader ?? undefined,
    description: raw.description?.slice(0, 10_000) ?? undefined,
    uploadDate: raw.upload_date ?? undefined,
    viewCount: raw.view_count ?? undefined,
    formats,
  };
}

function failureFromOutput(output: string) {
  if (/Requested format is not available/i.test(output))
    return new MediaError(
      "needs_selection",
      "The selected format is no longer available. Refresh formats and choose again.",
    );
  if (
    /unavailable|private video|removed|not available|sign in|unsupported url|no video formats|copyright|HTTP Error 403|HTTP Error 404/i.test(
      output,
    )
  )
    return new MediaError(
      "unavailable",
      "The source is unavailable, unsupported, or requires authentication.",
    );
  if (/larger than max|File too large|No space left/i.test(output))
    return new MediaError("limit", "The media exceeds the download or scratch-disk limit.");
  return new MediaError(
    "network",
    "The source could not be downloaded. It may be temporarily unavailable or rate limited.",
  );
}

/** Streams bounded lines and stops the entire process group on cancellation or parser failure. */
export async function runMediaProcess(options: {
  executable: string;
  args: string[];
  cwd: string;
  signal: AbortSignal;
  timeoutMs: number;
  onLine: (line: string) => Promise<void>;
  env?: NodeJS.ProcessEnv;
}) {
  options.signal.throwIfAborted();
  const child = spawn(options.executable, options.args, {
    cwd: options.cwd,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH,
      LANG: "C.UTF-8",
      HOME: options.cwd,
      TMPDIR: options.cwd,
      ...options.env,
    },
  });
  let processError: Error | undefined;
  let stderr = "";
  let stdoutSize = 0;
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  const kill = (signal: NodeJS.Signals) => {
    if (child.pid) {
      try {
        process.kill(-child.pid, signal);
      } catch {
        /* The process group may already have exited. */
      }
    }
  };
  const stop = () => {
    kill("SIGTERM");
    forceKill ??= setTimeout(() => kill("SIGKILL"), 2_000);
  };
  const abort = () => {
    processError = new Error("Cancelled");
    stop();
  };
  const timer = setTimeout(() => {
    processError = new MediaError("limit", "This request exceeded its time limit.");
    stop();
  }, options.timeoutMs);
  options.signal.addEventListener("abort", abort, { once: true });
  child.stderr.on("data", (data: Buffer) => {
    stderr = (stderr + data.toString()).slice(-16_384);
  });
  child.stdout.on("data", (data: Buffer) => {
    stdoutSize += data.length;
    if (stdoutSize > 32 * 1024 * 1024) {
      processError = new MediaError("limit", "The source returned too much metadata.");
      stop();
    }
  });
  const closed = new Promise<number | null>((resolveClose) => {
    child.on("error", (error) => {
      processError = error;
    });
    child.on("close", resolveClose);
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    try {
      for await (const line of lines) await options.onLine(line);
    } catch (error) {
      processError = error instanceof Error ? error : new Error("Invalid media metadata");
      stop();
    }
    const code = await closed;
    if (processError) throw processError;
    options.signal.throwIfAborted();
    if (code !== 0) throw failureFromOutput(stderr);
  } finally {
    clearTimeout(timer);
    // Kill descendants even if the parent exited during cancellation.
    if (forceKill) {
      kill("SIGKILL");
      clearTimeout(forceKill);
    }
    options.signal.removeEventListener("abort", abort);
    lines.close();
  }
}

export function createYtDlpAdapter(proxyUrl: string) {
  const executable = process.env.YT_DLP_PATH ?? "yt-dlp";
  const baseArgs = [
    "--ignore-config",
    "--no-plugin-dirs",
    "--no-remote-components",
    "--js-runtimes",
    "node",
    "--proxy",
    proxyUrl,
    "--socket-timeout",
    "30",
    "--retries",
    "2",
    "--fragment-retries",
    "2",
    "--no-warnings",
    "--no-colors",
  ];
  const run = (
    args: string[],
    cwd: string,
    signal: AbortSignal,
    onLine: (line: string) => Promise<void>,
    timeoutMs = 120_000,
  ) =>
    runMediaProcess({ executable, args: [...baseArgs, ...args], cwd, signal, onLine, timeoutMs });

  async function inspect(url: string, cwd: string, signal: AbortSignal) {
    let metadata: MediaMetadata | undefined;
    await run(
      ["--no-playlist", "--skip-download", "--dump-json", "--", normalizeMediaUrl(url)],
      cwd,
      signal,
      async (line) => {
        if (metadata)
          throw new MediaError(
            "unavailable",
            "This entry contains multiple videos. Submit its playlist URL instead.",
          );
        metadata = normalizeMetadata(JSON.parse(line));
        await writeFile(join(cwd, "source.info.json"), line);
      },
    );
    if (!metadata?.formats.length)
      throw new MediaError("unavailable", "No downloadable audio or video formats were found.");
    return metadata;
  }

  return {
    inspect,
    async discover(
      url: string,
      cwd: string,
      signal: AbortSignal,
      onEntry: (entry: {
        key: string;
        position: number;
        url: string | null;
        title: string;
      }) => Promise<void>,
    ) {
      let position = 0;
      await run(
        [
          "--flat-playlist",
          "--lazy-playlist",
          "--yes-playlist",
          "--dump-json",
          "--",
          normalizeMediaUrl(url),
        ],
        cwd,
        signal,
        async (line) => {
          const entry = v.parse(RawEntry, JSON.parse(line));
          position++;
          if (position > MAX_BATCH_ITEMS)
            throw new MediaError(
              "limit",
              `This playlist exceeds the ${MAX_BATCH_ITEMS}-entry limit. Entries already discovered remain available.`,
            );
          let entryUrl = entry.webpage_url ?? entry.url;
          if (
            (!entryUrl || !entryUrl.startsWith("https://")) &&
            (entry.ie_key === "Youtube" || entry.extractor_key === "Youtube") &&
            entry.id
          )
            entryUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(entry.id)}`;
          let normalized: string | null = null;
          try {
            if (entryUrl) normalized = normalizeMediaUrl(entryUrl);
          } catch {
            /* Unavailable entries remain visible in the playlist. */
          }
          await onEntry({
            key: `${entry.ie_key ?? entry.extractor_key ?? "media"}:${entry.id ?? normalized ?? position}`,
            position: entry.playlist_index ?? position,
            url: normalized,
            title: entry.title ?? "Unavailable item",
          });
        },
        30 * 60_000,
      );
      if (!position)
        throw new MediaError(
          "unavailable",
          "No playlist entries were found. The source may be empty or unavailable.",
        );
    },
    async download(options: {
      url: string;
      settings: DownloadSettings;
      selection: FormatSelection | null;
      cwd: string;
      signal: AbortSignal;
      onProgress: (progress: MediaProgress) => void;
    }) {
      const metadata = await inspect(options.url, options.cwd, options.signal);
      const chosen = selectFormats(metadata, options.settings, options.selection);
      if (
        chosen.some(
          (format) =>
            format.sizeBytes && !format.approximateSize && format.sizeBytes > MAX_MEDIA_BYTES,
        )
      )
        throw new MediaError("limit", "This media exceeds the 4 GB file limit.");
      // Filter across separate and combined streams; "best" alone excludes separate tracks.
      const selector = chosen
        .map((format) => `all[format_id=${JSON.stringify(format.id)}]`)
        .join("+");
      const args = [
        "--no-playlist",
        "--load-info-json",
        join(options.cwd, "source.info.json"),
        "--downloader",
        "native",
        "--format",
        selector,
        "--max-filesize",
        String(MAX_MEDIA_BYTES),
        "--newline",
        "--progress",
        "--progress-delta",
        "1",
        "--progress-template",
        "download:BG_PROGRESS %(progress.{downloaded_bytes,total_bytes,total_bytes_estimate,speed,eta})j",
        "--progress-template",
        "postprocess:BG_CONVERT",
        "--print",
        "after_move:BG_FILE %(filepath)j",
        "--no-simulate",
        "--output",
        "output.%(ext)s",
      ];
      if (chosen.length === 2 && chosen[1]?.videoCodec)
        // Keep the combined source for its audio, then discard its second video stream.
        args.push("--video-multistreams", "--postprocessor-args", "Merger+ffmpeg_o:-map -1:v");
      if (options.settings.mode === "audio")
        args.push(
          "--extract-audio",
          "--audio-format",
          options.settings.conversion === "original" ? "best" : options.settings.conversion,
          "--audio-quality",
          "0",
        );
      let outputPath: string | undefined;
      await run(
        args,
        options.cwd,
        options.signal,
        async (line) => {
          if (line.startsWith("BG_FILE "))
            outputPath = v.parse(v.string(), JSON.parse(line.slice(8)));
          else if (line === "BG_CONVERT") options.onProgress({ phase: "converting" });
          else if (line.startsWith("BG_PROGRESS ")) {
            const progress = v.parse(
              v.object({
                downloaded_bytes: optionalNumber,
                total_bytes: optionalNumber,
                total_bytes_estimate: optionalNumber,
                speed: optionalNumber,
                eta: optionalNumber,
              }),
              JSON.parse(line.slice(12)),
            );
            if ((progress.downloaded_bytes ?? 0) > MAX_MEDIA_BYTES)
              throw new MediaError("limit", "This media exceeds the 4 GB file limit.");
            options.onProgress({
              phase: "downloading",
              downloadedBytes: progress.downloaded_bytes ?? undefined,
              totalBytes: progress.total_bytes ?? progress.total_bytes_estimate ?? undefined,
              speed: progress.speed ?? undefined,
              eta: progress.eta ?? undefined,
            });
          }
        },
        2 * 60 * 60_000,
      );
      if (!outputPath || !resolve(options.cwd, outputPath).startsWith(resolve(options.cwd) + "/"))
        throw new MediaError("unavailable", "The downloader did not produce a media file.");
      let path = resolve(options.cwd, outputPath);
      if (options.settings.conversion === "mp4") {
        options.onProgress({ phase: "converting" });
        const converted = join(options.cwd, "converted.mp4");
        await runMediaProcess({
          executable: "ffmpeg",
          args: [
            "-nostdin",
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            path,
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-c:v",
            "libx264",
            "-crf",
            "18",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            "-fs",
            String(MAX_MEDIA_BYTES + 1),
            converted,
          ],
          cwd: options.cwd,
          signal: options.signal,
          timeoutMs: 2 * 60 * 60_000,
          onLine: async () => {},
        });
        path = converted;
      }
      const outputStat = await stat(path);
      if (!outputStat.isFile() || !outputStat.size || outputStat.size > MAX_MEDIA_BYTES)
        throw new MediaError("limit", "The output is empty or exceeds the 4 GB file limit.");
      const extension = extname(path).slice(1);
      const description = await describeOutput(path, options.cwd, options.signal);
      return {
        path,
        sizeBytes: outputStat.size,
        name: `${Array.from(metadata.title)
          .map((character) =>
            character.charCodeAt(0) < 32 || character === "/" || character === "\\"
              ? "_"
              : character,
          )
          .join("")
          .slice(0, 180)}.${extension}`,
        mediaType: mediaType(extension, options.settings.mode),
        metadata,
        description: `${extension} · ${description}`,
      };
    },
  };
}

async function describeOutput(path: string, cwd: string, signal: AbortSignal) {
  let json = "";
  await runMediaProcess({
    executable: "ffprobe",
    args: ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-of", "json", path],
    cwd,
    signal,
    timeoutMs: 30_000,
    onLine: async (line) => {
      json += line;
    },
  });
  const result = v.parse(
    v.object({
      streams: v.array(
        v.object({
          codec_name: optionalString,
          codec_type: optionalString,
          height: optionalNumber,
          bit_rate: optionalString,
        }),
      ),
    }),
    JSON.parse(json),
  );
  return result.streams
    .filter((stream) => stream.codec_type === "audio" || stream.codec_type === "video")
    .map((stream) =>
      [
        stream.height ? `${stream.height}p` : undefined,
        stream.codec_name,
        stream.codec_type === "audio" && stream.bit_rate
          ? `${Math.round(Number(stream.bit_rate) / 1000)} kbps`
          : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
    )
    .join(" + ");
}

function mediaType(extension: string, mode: string) {
  const types: Record<string, string> = {
    mp4: "video/mp4",
    mkv: "video/x-matroska",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    opus: "audio/ogg",
    ogg: "audio/ogg",
    wav: "audio/wav",
    flac: "audio/flac",
    aac: "audio/aac",
    webm: mode === "audio" ? "audio/webm" : "video/webm",
  };
  return types[extension] ?? "application/octet-stream";
}

export async function scratchSize(path: string): Promise<number> {
  const entries = await readdir(path, { withFileTypes: true });
  let size = 0;
  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    try {
      if (entry.isDirectory()) size += await scratchSize(entryPath);
      else if (entry.isFile()) size += (await stat(entryPath)).size;
    } catch (error) {
      // Downloaders rename and remove temporary files while the worker measures them.
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  return size;
}
