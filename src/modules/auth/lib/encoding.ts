import { type Result, trySync } from "@/lib/result";

import type { Bytes } from "./crypto";

export function encodeBase64url(buffer: Bytes) {
  return buffer.toBase64({ alphabet: "base64url", omitPadding: true });
}

export function decodeBase64url(base64url: string): Result<Bytes, unknown> {
  return trySync(() =>
    Uint8Array.fromBase64(base64url, { alphabet: "base64url", lastChunkHandling: "loose" }),
  );
}
