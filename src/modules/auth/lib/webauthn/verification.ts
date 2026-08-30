import * as v from "valibot";

import { err, ok, trySync, type Result } from "@/lib/result";

import { constantTimeCompare, sha256Hash, type Bytes } from "../crypto";
import { decodeBase64url, encodeBase64url } from "../encoding";

export type SupportedCoseAlgorithm = -8 | -7 | -257;

export const MAX_CREDENTIAL_ID_LENGTH = 1023;
export const MAX_USER_HANDLE_LENGTH = 64;

export interface WebAuthnPolicy {
  rpId: string;
  expectedOrigin: string;
  requireUserVerification: boolean;
  supportedAlgorithms: readonly SupportedCoseAlgorithm[];
}

export type ClientDataVerificationError =
  | "INVALID_CLIENT_DATA"
  | "WRONG_CLIENT_DATA_TYPE"
  | "CHALLENGE_MISMATCH"
  | "ORIGIN_MISMATCH"
  | "CROSS_ORIGIN_NOT_ALLOWED";

export const Base64URLValidator = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9_-]+$/),
  v.check((encoded) => {
    const decodedResult = decodeBase64url(encoded);
    return decodedResult.ok && encodeBase64url(decodedResult.value) === encoded;
  }, "Base64url must use canonical, unpadded encoding"),
);

export const CredentialIdValidator = v.pipe(
  Base64URLValidator,
  v.check((encoded) => {
    const decodedResult = decodeBase64url(encoded);
    return (
      decodedResult.ok &&
      decodedResult.value.byteLength > 0 &&
      decodedResult.value.byteLength <= MAX_CREDENTIAL_ID_LENGTH
    );
  }, "Credential ID must contain between 1 and 1023 bytes"),
);

export const UserHandleValidator = v.pipe(
  Base64URLValidator,
  v.check((encoded) => {
    const decodedResult = decodeBase64url(encoded);
    return (
      decodedResult.ok &&
      decodedResult.value.byteLength > 0 &&
      decodedResult.value.byteLength <= MAX_USER_HANDLE_LENGTH
    );
  }, "User handle must contain between 1 and 64 bytes"),
);

const CollectedClientDataValidator = v.object({
  type: v.string(),
  challenge: Base64URLValidator,
  origin: v.string(),
  crossOrigin: v.optional(v.boolean()),
});

export interface VerifiedClientData {
  bytes: Bytes;
}

export function verifyClientData(options: {
  encodedClientData: string;
  expectedType: "webauthn.create" | "webauthn.get";
  expectedChallenge: string;
  expectedOrigin: string;
}): Result<VerifiedClientData, ClientDataVerificationError> {
  const encodedClientDataResult = parseBase64url(options.encodedClientData);
  if (!encodedClientDataResult.ok) {
    return err("INVALID_CLIENT_DATA");
  }

  const clientDataResult = trySync(() => {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(encodedClientDataResult.value);
    return JSON.parse(json) as unknown;
  });
  if (!clientDataResult.ok) {
    return err("INVALID_CLIENT_DATA");
  }

  const parsedClientDataResult = v.safeParse(CollectedClientDataValidator, clientDataResult.value);
  if (!parsedClientDataResult.success) {
    return err("INVALID_CLIENT_DATA");
  }
  const parsedClientData = parsedClientDataResult.output;
  if (parsedClientData.type !== options.expectedType) {
    return err("WRONG_CLIENT_DATA_TYPE");
  }
  if (parsedClientData.challenge !== options.expectedChallenge) {
    return err("CHALLENGE_MISMATCH");
  }
  if (parsedClientData.origin !== options.expectedOrigin) {
    return err("ORIGIN_MISMATCH");
  }
  if (parsedClientData.crossOrigin === true) {
    return err("CROSS_ORIGIN_NOT_ALLOWED");
  }

  return ok({ bytes: encodedClientDataResult.value });
}

const AUTHENTICATOR_DATA_PREFIX_LENGTH = 37;
const FLAG_USER_PRESENT = 0x01;
const FLAG_RESERVED_1 = 0x02;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_BACKUP_ELIGIBLE = 0x08;
const FLAG_BACKED_UP = 0x10;
const FLAG_RESERVED_2 = 0x20;
const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40;
const FLAG_EXTENSION_DATA = 0x80;

export interface ParsedAuthenticatorData {
  bytes: Bytes;
  rpIdHash: Bytes;
  signCount: number;
  userPresent: boolean;
  userVerified: boolean;
  backupEligible: boolean;
  backedUp: boolean;
  hasAttestedCredentialData: boolean;
  hasExtensionData: boolean;
  trailingBytes: Bytes;
}

export function parseAuthenticatorData(
  bytes: Bytes,
): Result<ParsedAuthenticatorData, "INVALID_AUTHENTICATOR_DATA" | "INVALID_BACKUP_FLAGS"> {
  if (bytes.byteLength < AUTHENTICATOR_DATA_PREFIX_LENGTH) {
    return err("INVALID_AUTHENTICATOR_DATA");
  }

  const flags = bytes[32];
  if (flags === undefined || (flags & (FLAG_RESERVED_1 | FLAG_RESERVED_2)) !== 0) {
    return err("INVALID_AUTHENTICATOR_DATA");
  }

  const backupEligible = (flags & FLAG_BACKUP_ELIGIBLE) !== 0;
  const backedUp = (flags & FLAG_BACKED_UP) !== 0;
  if (backedUp && !backupEligible) {
    return err("INVALID_BACKUP_FLAGS");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return ok({
    bytes,
    rpIdHash: bytes.slice(0, 32),
    signCount: view.getUint32(33, false),
    userPresent: (flags & FLAG_USER_PRESENT) !== 0,
    userVerified: (flags & FLAG_USER_VERIFIED) !== 0,
    backupEligible,
    backedUp,
    hasAttestedCredentialData: (flags & FLAG_ATTESTED_CREDENTIAL_DATA) !== 0,
    hasExtensionData: (flags & FLAG_EXTENSION_DATA) !== 0,
    trailingBytes: bytes.slice(AUTHENTICATOR_DATA_PREFIX_LENGTH),
  });
}

export async function rpIdHashMatches(rpId: string, actualHash: Bytes) {
  const expectedHash = await sha256Hash(new TextEncoder().encode(rpId));
  return constantTimeCompare(expectedHash, actualHash);
}

export function bytesMatchBase64url(bytes: Bytes, encoded: string) {
  const expectedResult = parseBase64url(encoded);
  return expectedResult.ok && constantTimeCompare(bytes, expectedResult.value);
}

export function parseBase64url(value: unknown): Result<Bytes, unknown> {
  const parsedResult = v.safeParse(Base64URLValidator, value);
  if (!parsedResult.success) {
    return err(parsedResult.issues);
  }
  return decodeBase64url(parsedResult.output);
}

export function concatBytes(first: Bytes, second: Bytes): Bytes {
  const combined = new Uint8Array(first.byteLength + second.byteLength);
  combined.set(first);
  combined.set(second, first.byteLength);
  return combined;
}

export function isSupportedAlgorithm(
  value: number,
  supported: readonly SupportedCoseAlgorithm[],
): value is SupportedCoseAlgorithm {
  return supported.some((algorithm) => algorithm === value);
}
