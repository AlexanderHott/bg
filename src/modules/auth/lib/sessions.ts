import type * as authSchema from "../schema";
import type { SessionToken } from "./sessionToken";
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
  session: authSchema.Session;
  sessionToken: SessionToken;
  nowMs: number;
}
export async function validateSession(options: ValidateSessionOptions) {
  if (options.nowMs >= options.session.expiresAt.getTime()) {
    return false;
  }

  const sessionSecretActualBuffer = Uint8Array.fromBase64(options.sessionToken.secret, {
    alphabet: "base64url",
  });
  const sessionSecretActualHashBuffer = await sha256Hash(sessionSecretActualBuffer);

  const sessionSecretExpectedHashStr = options.session.secretHash;
  const sessionSecretExpectedHashBuffer = Uint8Array.fromBase64(sessionSecretExpectedHashStr, {
    alphabet: "base64url",
  });

  if (!constantTimeCompare(sessionSecretActualHashBuffer, sessionSecretExpectedHashBuffer)) {
    return false;
  }

  // TODO: maybe extend session lifetime

  return true;
}
