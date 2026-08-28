import { randomUUIDv7 } from "node:crypto";
import type * as authSchema from "../schema";
import { timingSafeEqual } from "node:crypto";
import type { SessionToken } from "./sessionToken";

function secureRandom(length: number) {
  const buffer = new Uint8Array(length);
  crypto.getRandomValues(buffer);
  return buffer;
}

function constantTimeCompare(a: Uint8Array<ArrayBuffer>, b: Uint8Array<ArrayBuffer>) {
  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}

export interface CreateSessionOptions {
  userId: string;
  nowMs: number;
}
export async function createSession(options: CreateSessionOptions) {
  const id = randomUUIDv7();

  const secret = secureRandom(32);
  const secretStr = secret.toBase64({ alphabet: "base64url" });

  const secretHash = await crypto.subtle.digest("SHA-256", secret);
  const secretHashBuffer = new Uint8Array(secretHash);
  const secretHashStr = secretHashBuffer.toBase64({ alphabet: "base64url" });

  const expiresAt = options.nowMs + 1000 * 60 * 60 * 24 * 30;

  return {
    session: {
      id,
      userId: options.userId,
      secretHash: secretHashStr,
      expiresAt: new Date(expiresAt),
    },
    secret: secretStr,
  };
}

export interface ValidateSessionOptions {
  session: authSchema.Session;
  sessionToken: SessionToken;
  nowMs: number;
}
export async function isSessionValid(options: ValidateSessionOptions) {
  if (options.nowMs >= options.session.expiresAt.getTime()) {
    return false;
  }

  const sessionSecretActualBuf = Uint8Array.fromBase64(options.sessionToken.secret, {
    alphabet: "base64url",
  });

  const sessionSecretActualHash = await crypto.subtle.digest("SHA-256", sessionSecretActualBuf);
  const sessionSecretActualHashBuf = new Uint8Array(sessionSecretActualHash);

  const sessionSecretExpectedHashStr = options.session.secretHash;
  const sessionSecretExpectedHashBuf = Uint8Array.fromBase64(sessionSecretExpectedHashStr, {
    alphabet: "base64url",
  });

  if (!constantTimeCompare(sessionSecretActualHashBuf, sessionSecretExpectedHashBuf)) {
    return false;
  }

  return true;
}
