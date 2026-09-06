# Background removal

## First release

Use BiRefNet General Lite as the only model. Do not expose model selection until another model
offers a clear quality or speed advantage on real usage.

The first release processes one image per request and returns an RGBA PNG at the oriented input
dimensions. It uses one worker replica with one inference in flight. PostgreSQL is the durable
queue; MinIO stores inputs and outputs.

Release requires a fixed corpus of representative images. Record cold and warm latency, peak RSS,
retained memory, output dimensions, and crashes on that corpus. Human review is the v1 quality
gate; do not invent a segmentation score that does not match product usefulness.

## Model contract

- Artifact: `BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx` from the
  [first-party ONNX release](https://github.com/ZhengPeng7/BiRefNet/releases/tag/v1)
- SHA-256: `5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333`
- Input: auto-oriented sRGB, resized to 1024 by 1024, float32 NCHW, ImageNet normalization
- Output: sigmoid alpha resized to the oriented source dimensions, multiplied by any source alpha,
  and encoded with the oriented sRGB pixels as an RGBA PNG

Strip metadata from the output. Accept single-frame JPEG, PNG, WebP, and AVIF up to 50 MiB, 64
megapixels, and 16,384 pixels on either side. Verify the decoded format and limits in the worker;
never trust the browser-provided MIME type or dimensions.

Keep preprocessing and postprocessing behind one adapter. Add fixture tests against the
first-party Python path before relying on a TypeScript implementation. Pin the model in the
worker image so startup never depends on a download.

Prefer a standalone TypeScript worker using ONNX Runtime and Sharp. Use a Python worker only if
the Node binding cannot match the reference output or package cleanly for production. Inference
must never run in the web process.

## Queue and storage invariants

Keep each background-removal request's organization, client request ID, input file, and model ID
immutable. Store each execution in a background-removal attempt row with its series ID, sequence,
next eligible time, lease token and expiry, output file, completion timestamps, and bounded failure
code. A manual retry starts a new attempt series. Permit at most three automatic attempts within a
series.

Durable attempt states are queued, processing, ready, and failed. `retrying` is an API and UI
projection for a queued attempt that follows an earlier attempt; do not persist it as a state.

Workers claim queued rows with `FOR UPDATE SKIP LOCKED` and commit before inference. Completion,
failure, and lease renewal must match the current lease token so an expired worker cannot
overwrite a newer attempt. Retry transient failures with capped backoff; fail invalid input and
exhausted jobs. Start with a 60-second lease renewed every 15 seconds. Claim by next eligible time,
then creation time, then ID. Keep these timings configurable and revisit them after benchmarking.

Generated-file publication must be idempotent. Encode to bounded local scratch space and upload to
an object key containing the request and lease or attempt ID. Commit the generated-file row and
successful attempt together only while the lease token is current. A stale worker may leave an
orphan, but it cannot overwrite the selected result. Clean unreferenced objects asynchronously.

## Deployment guardrails

- Disable ONNX Runtime's CPU memory arena. Local measurement reduced BiRefNet Lite's retained
  memory substantially, while peak memory remained high enough to require isolation.
- Give the worker an 8 GiB container limit and keep web, database, and object storage outside that
  limit.
- Start with one replica and one active job. Do not add concurrency until production memory and
  latency measurements show room for it.
- Report readiness only after the model has loaded and completed a warm-up inference.
- Monitor worker working set and peak RSS, OOM kills, restarts, queue age, attempt count, and
  inference duration. Alert before sustained worker memory reaches 7 GiB.
- On shutdown, stop claiming work and let an unfinished lease expire if the current job cannot
  finish cleanly.
- Build web and worker as separate targets from the same package. Apply migrations during production
  startup under a shared PostgreSQL advisory lock. Use `db:migrate` for local migrations.

## Product flow

After an upload completes, create a background-removal request and show it as queued immediately.
The client-generated request ID makes creation idempotent and reconciles the optimistic entry
without reordering the screen.

While the page is visible and displayed requests are unsettled, poll their normal authenticated
read endpoints once per second. Skip a poll while the previous one is still running. Stop polling
when the page is hidden or all displayed requests have settled.

Show honest states: queued, processing, ready, retrying, and failed. The result view needs a
transparency preview, input/output comparison, PNG download, retry, and process-another-image
action. Do not show fake percentage progress.

Show the newest 20 organization requests and use cursor pagination for older results. Requests and
their files persist until an organization member deletes them. Remove deleted requests from the UI
immediately and clean their objects asynchronously. Do not offer retry for invalid, unsupported,
oversized, or undecodable input.

## Delivery order

1. Package the pinned model and prove adapter parity, offline startup, memory settings, and output
   dimensions.
2. Add queue fields, claim and lease operations, retries, and concurrency tests.
3. Add idempotent generated-file publication and the worker loop.
4. Add authenticated create, list, inspect, and retry operations.
5. Complete the optimistic UI and add failure-path tests and production telemetry.

Batch jobs, WebSockets, manual mask editing, multiple models, GPUs, and a separate queue service
remain out of scope until usage shows a need.
