# Media downloads

The organization tool at `/$orgSlug/download-media` accepts public HTTPS media and playlist URLs. **Simple** downloads the best available video or audio immediately. **Prepare** discovers entries without downloading media, then lets you review metadata, choose streams and codecs, and configure output before selecting **Download all**. The queue uses compact rows with expandable details.

## Settings

The default downloads the best available video and audio without re-encoding. Audio mode extracts the best audio stream. Video-only streams are merged with audio when available.

Batch settings offer a resolution ceiling and optional MP4, MP3, or M4A conversion. Compatible MP4 explicitly encodes H.264 video and AAC audio. Resolution ceilings never upscale a source. Conversion can lose quality and takes extra time.

An item's **Details & formats** panel requests its available streams, duration, uploader, upload date, view count, and description from yt-dlp. Metadata fields appear only when supplied by the source. Choose video and audio, then **Save selection**. Exact item selections override the batch resolution preference. Batch settings freeze when the draft is queued, including for entries discovered afterward. Queued and running items cannot be edited; failed items can be inspected, edited, and retried.

The worker resolves source metadata again when a download starts. An exact format that disappeared produces a selection error rather than a different download. Inspection metadata is cached for 15 minutes; **Refresh formats** bypasses the cache. Raw extraction results and media URLs stay in temporary worker files and are removed after the task.

## Playlists and storage

- Discovery yields entries progressively. Each source has its own status and errors.
- The page shows 50 items at a time. Opening a format panel inspects only that item.
- Repeated entries within a source are deduplicated by extractor and media ID. Retrying partial discovery preserves existing items and can discover additional entries.
- Each worker runs one discovery, one inspection, and one download concurrently. A long discovery does not occupy the inspection or download slot.
- Jobs survive page closes and worker restarts. Transient failures get up to three attempts. Explicit source and format failures require manual retry.
- Cancel stops pending work and invalidates active leases. The worker terminates yt-dlp and ffmpeg children when it observes cancellation. Completed files remain downloadable.
- Files remain in MinIO until the batch is deleted. Deletion hides the batch immediately; worker maintenance removes its files. Unreferenced uploads and abandoned scratch directories are collected after 24 hours.

Current limits are 50 input URLs and 1,000 discovered items per batch, 4 GB per output, and 12 GB of scratch data per task. Reaching the item limit leaves discovered items available and shows a source error. Inspection has a two-minute timeout, discovery 30 minutes, and downloading and MP4 conversion each have a two-hour timeout. The 4 GB output limit keeps storage uploads within the existing single-request uploader's limit.

Live streams, authenticated sources, private playlists, ZIP exports, and subscriptions are outside this version. Source availability and formats can change, including when a site rate limits the deployment's IP address.

## Running the worker

Compose builds the `media-worker` target for amd64 or arm64. It includes yt-dlp 2026.08.19, ffmpeg, ffprobe, and Node. yt-dlp release downloads are checksum-verified. Update the version and both checksums in `Dockerfile` together when upgrading.

The worker has a separate disk volume, `media_scratch`, and does not load the background-removal model. Budget at least 16 GB of free disk for scratch data plus space for MinIO outputs. The scratch limit is monitored per task; the named volume does not impose a filesystem quota. The worker runs as `nobody` with a 2 GB memory limit and two CPUs in Compose.

For local development:

1. Start the existing Postgres and MinIO dependencies and configure `.env`.
2. Install the pinned yt-dlp executable, ffmpeg, and ffprobe. The official yt-dlp executable bundles its JavaScript challenge scripts. The project's Node runtime runs them.
3. Apply the migration with `vp run db:migrate`.
4. Run `vp run dev:media-worker` and `vp dev` in separate terminals.

`YT_DLP_PATH` can point to a specific executable. `MEDIA_SCRATCH_PATH` chooses the scratch directory and defaults to `/tmp/bg-media` locally. Database and S3 settings are shared with the web application. The worker checks its executables before marking itself ready.

yt-dlp receives fixed arguments and a minimal environment without database or S3 credentials. Its requests use a local proxy that validates resolved destinations and pins connections to public addresses, including subsequent redirect requests. Source URLs cannot specify credentials or nonstandard ports. User configuration and external yt-dlp plugins are disabled.

## Verification

`vp test` includes format-selection, network-policy, and subprocess-cancellation tests. Database and worker tests are opt-in and require a migrated test database. Point `DATABASE_URL` at a disposable local database before running:

```sh
RUN_DB_INTEGRATION=1 vp test src/modules/mediaDownloads/mediaDownloads.integration.test.ts
RUN_MEDIA_WORKER_INTEGRATION=1 vp test src/modules/mediaDownloads/mediaWorker.integration.test.ts
```

The worker test also needs local MinIO and ffmpeg/ffprobe. It uses a deterministic executable fixture for yt-dlp, then exercises the real worker, file inspection, S3 upload, and signed download. It creates and cleans its own organization and objects. No browser verification is required by these tests.
