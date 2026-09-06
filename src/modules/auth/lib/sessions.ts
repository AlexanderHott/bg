import { constantTimeCompare, secureRandomBytes, sha256Hash } from "./crypto";

export interface CreateSessionOptions {
  nowMs: number;
}
export async function createSession(options: CreateSessionOptions) {
  const secretBuffer = secureRandomBytes(32);
  const secretStr = secretBuffer.toBase64({ alphabet: "base64url" });

  const secretHashBuffer = await sha256Hash(secretBuffer);
  const secretHashStr = secretHashBuffer.toBase64({ alphabet: "base64url" });

  const expiresAt = options.nowMs + 1000 * 60 * 60 * 24 * 30;

  return {
    secret: secretStr,
    secretHash: secretHashStr,
    expiresAt: new Date(expiresAt),
  };
}

export interface ValidateSessionOptions {
  secret: string;
  secretHash: string;
  expiresAt: Date;
  now: Date;
}
export async function validateSession(options: ValidateSessionOptions) {
  if (options.now.getTime() >= options.expiresAt.getTime()) {
    return false;
  }

  const sessionSecretActualBuffer = decodeBase64Url(options.secret);
  const sessionSecretExpectedHashBuffer = decodeBase64Url(options.secretHash);
  if (!sessionSecretActualBuffer || !sessionSecretExpectedHashBuffer) return false;

  const sessionSecretActualHashBuffer = await sha256Hash(sessionSecretActualBuffer);

  if (!constantTimeCompare(sessionSecretActualHashBuffer, sessionSecretExpectedHashBuffer)) {
    return false;
  }

  return true;
}

function decodeBase64Url(value: string) {
  try {
    return new Uint8Array(Uint8Array.fromBase64(value, { alphabet: "base64url" }));
  } catch {
    return undefined;
  }
}
