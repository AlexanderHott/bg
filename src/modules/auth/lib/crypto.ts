import { timingSafeEqual } from "node:crypto";

import { hash, verify } from "@node-rs/argon2";

export type Bytes = Uint8Array<ArrayBuffer>;

export function secureRandomBytes(length: number) {
  const buffer = new Uint8Array(length);
  crypto.getRandomValues(buffer);
  return buffer;
}

export function constantTimeCompare(a: Bytes, b: Bytes) {
  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}

export async function sha256Hash(buffer: Bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
}

const Algorithm = {
  /**
   * Optimizes against GPU cracking attacks but vulnerable to side-channels.
   * Accesses the memory array in a password dependent order, reducing the possibility of time–memory tradeoff (TMTO) attacks.
   */
  Argon2d: 0,
  /**
   * Optimized to resist side-channel attacks.
   * Accesses the memory array in a password independent order, increasing the possibility of time-memory tradeoff (TMTO) attacks.
   */
  Argon2i: 1,
  /**
   * Default value, this is the default algorithm for normative recommendations.
   * Hybrid that mixes Argon2i and Argon2d passes.
   * Uses the Argon2i approach for the first half pass over memory and Argon2d approach for subsequent passes. This effectively places it in the “middle” between the other two: it doesn’t provide as good TMTO/GPU cracking resistance as Argon2d, nor as good of side-channel resistance as Argon2i, but overall provides the most well-rounded approach to both classes of attacks.
   */
  Argon2id: 2,
} as const;

export async function argon2Hash(password: string, signal?: AbortSignal) {
  const passwordHash = await hash(
    password,
    {
      algorithm: Algorithm.Argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    },
    signal,
  );
  return passwordHash;
}

export async function argon2Verify(hashed: string, password: string, signal?: AbortSignal) {
  const equal = await verify(hashed, password, undefined, signal);
  return equal;
}
