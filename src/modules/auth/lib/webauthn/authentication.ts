import * as v from "valibot";

import { envServer } from "@/envServer";
import { err, ok, type Result } from "@/lib/result";

import { sha256Hash, type Bytes } from "../crypto";
import { importPublicKeySpki, verifyWebAuthnSignature } from "./signature";
import {
  Base64URLValidator,
  bytesMatchBase64url,
  concatBytes,
  CredentialIdValidator,
  isSupportedAlgorithm,
  parseBase64url,
  verifyAuthenticatorData,
  UserHandleValidator,
  verifyClientData,
  type ParsedAuthenticatorData,
  type SupportedCoseAlgorithm,
  type WebAuthnPolicy,
} from "./verification";

export type { WebAuthnPolicy } from "./verification";

const AuthenticationResponseValidator = v.object({
  id: CredentialIdValidator,
  rawId: CredentialIdValidator,
  type: v.literal("public-key"),
  response: v.object({
    clientDataJSON: Base64URLValidator,
    authenticatorData: Base64URLValidator,
    signature: Base64URLValidator,
    userHandle: v.optional(UserHandleValidator),
  }),
});

export function makeAuthenticationOptions(
  challenge: Base64URLString,
): PublicKeyCredentialRequestOptionsJSON {
  return {
    challenge,
    rpId: envServer.WEBAUTHN_RP_ID,
    allowCredentials: [],
    userVerification: "required",
    timeout: 60_000,
  };
}

export interface StoredPasskeyVerificationData {
  credentialId: Base64URLString;
  userHandle: Base64URLString;
  publicKeySpki: Base64URLString;
  algorithm: number;
  signCount: number;
  backupEligible: boolean;
}

export interface VerifyAuthenticationResponseInput {
  credential: AuthenticationResponseJSON;
  expectedChallenge: Base64URLString;
  policy: WebAuthnPolicy;
  storedPasskey: StoredPasskeyVerificationData;
}

export type SignatureCounterStatus = "NOT_SUPPORTED" | "VALID" | "POSSIBLE_CLONE";

export interface VerifiedAuthentication {
  newSignCount: number;
  counterStatus: SignatureCounterStatus;
  backedUp: boolean;
}

export interface AuthenticationVerificationError {
  kind:
    | "MALFORMED_CREDENTIAL"
    | "INVALID_CLIENT_DATA"
    | "WRONG_CLIENT_DATA_TYPE"
    | "CHALLENGE_MISMATCH"
    | "ORIGIN_MISMATCH"
    | "CROSS_ORIGIN_NOT_ALLOWED"
    | "CREDENTIAL_ID_MISMATCH"
    | "USER_HANDLE_REQUIRED"
    | "USER_HANDLE_MISMATCH"
    | "INVALID_AUTHENTICATOR_DATA"
    | "RP_ID_MISMATCH"
    | "USER_PRESENCE_REQUIRED"
    | "USER_VERIFICATION_REQUIRED"
    | "BACKUP_ELIGIBILITY_CHANGED"
    | "INVALID_BACKUP_FLAGS"
    | "UNSUPPORTED_ALGORITHM"
    | "INVALID_PUBLIC_KEY"
    | "INVALID_SIGNATURE";
  cause: unknown;
}

export async function verifyAuthenticationResponse(
  input: VerifyAuthenticationResponseInput,
): Promise<Result<VerifiedAuthentication, AuthenticationVerificationError>> {
  const credentialResult = v.safeParse(AuthenticationResponseValidator, input.credential);
  if (!credentialResult.success) {
    return err({ kind: "MALFORMED_CREDENTIAL", cause: credentialResult.issues });
  }

  const credential = credentialResult.output;
  const identityResult = verifyCredentialIdentity(credential, input.storedPasskey);
  if (!identityResult.ok) return identityResult;

  const clientDataResult = verifyClientData({
    encodedClientData: credential.response.clientDataJSON,
    expectedType: "webauthn.get",
    expectedChallenge: input.expectedChallenge,
    expectedOrigin: input.policy.expectedOrigin,
  });
  if (!clientDataResult.ok) {
    return err({ kind: clientDataResult.error, cause: undefined });
  }

  const authenticatorDataResult = await verifyAuthenticatorData({
    encodedData: credential.response.authenticatorData,
    policy: input.policy,
  });
  if (!authenticatorDataResult.ok) return authenticatorDataResult;
  const authenticatorData = authenticatorDataResult.value;

  const passkeyResult = verifyStoredPasskey(input, authenticatorData);
  if (!passkeyResult.ok) return passkeyResult;

  const signatureResult = await verifySignature(
    credential,
    input.storedPasskey,
    passkeyResult.value,
    authenticatorData,
    clientDataResult.value.bytes,
  );
  if (!signatureResult.ok) return signatureResult;

  return ok({
    newSignCount: authenticatorData.signCount,
    counterStatus: classifySignatureCounter(
      input.storedPasskey.signCount,
      authenticatorData.signCount,
    ),
    backedUp: authenticatorData.backedUp,
  });
}

type AuthenticationCredential = v.InferOutput<typeof AuthenticationResponseValidator>;

function verifyCredentialIdentity(
  credential: AuthenticationCredential,
  storedPasskey: StoredPasskeyVerificationData,
): Result<undefined, AuthenticationVerificationError> {
  const credentialIdResult = parseBase64url(credential.rawId);
  if (
    !credentialIdResult.ok ||
    credential.id !== credential.rawId ||
    !bytesMatchBase64url(credentialIdResult.value, storedPasskey.credentialId)
  ) {
    return err({ kind: "CREDENTIAL_ID_MISMATCH", cause: credentialIdResult });
  }

  const userHandle = credential.response.userHandle;
  if (userHandle === undefined) return err({ kind: "USER_HANDLE_REQUIRED", cause: undefined });

  const userHandleResult = parseBase64url(userHandle);
  if (!userHandleResult.ok) {
    return err({ kind: "MALFORMED_CREDENTIAL", cause: userHandleResult.error });
  }
  if (!bytesMatchBase64url(userHandleResult.value, storedPasskey.userHandle)) {
    return err({ kind: "USER_HANDLE_MISMATCH", cause: undefined });
  }

  return ok(undefined);
}

function verifyStoredPasskey(
  input: VerifyAuthenticationResponseInput,
  authenticatorData: ParsedAuthenticatorData,
): Result<SupportedCoseAlgorithm, AuthenticationVerificationError> {
  if (authenticatorData.hasAttestedCredentialData || invalidExtensionData(authenticatorData)) {
    return err({ kind: "INVALID_AUTHENTICATOR_DATA", cause: undefined });
  }
  if (authenticatorData.backupEligible !== input.storedPasskey.backupEligible) {
    return err({ kind: "BACKUP_ELIGIBILITY_CHANGED", cause: undefined });
  }
  if (!validSignatureCounter(input.storedPasskey.signCount)) {
    return err({ kind: "INVALID_AUTHENTICATOR_DATA", cause: undefined });
  }

  const algorithm = input.storedPasskey.algorithm;
  if (!isSupportedAlgorithm(algorithm, input.policy.supportedAlgorithms)) {
    return err({ kind: "UNSUPPORTED_ALGORITHM", cause: algorithm });
  }
  return ok(algorithm);
}

async function verifySignature(
  credential: AuthenticationCredential,
  storedPasskey: StoredPasskeyVerificationData,
  algorithm: SupportedCoseAlgorithm,
  authenticatorData: ParsedAuthenticatorData,
  clientDataBytes: Bytes,
): Promise<Result<undefined, AuthenticationVerificationError>> {
  const publicKeyResult = parseBase64url(storedPasskey.publicKeySpki);
  if (!publicKeyResult.ok) return err({ kind: "INVALID_PUBLIC_KEY", cause: publicKeyResult.error });

  const publicKey = importPublicKeySpki({ algorithm, publicKeySpki: publicKeyResult.value });
  if (!publicKey.ok) return err({ kind: "INVALID_PUBLIC_KEY", cause: publicKey.error });

  const signature = parseBase64url(credential.response.signature);
  if (!signature.ok) return err({ kind: "MALFORMED_CREDENTIAL", cause: signature.error });

  const clientDataHash = await sha256Hash(clientDataBytes);
  const verificationResult = verifyWebAuthnSignature({
    algorithm,
    publicKey: publicKey.value,
    signature: signature.value,
    signedData: concatBytes(authenticatorData.bytes, clientDataHash),
  });
  if (!verificationResult.ok) {
    return err({ kind: "INVALID_SIGNATURE", cause: verificationResult.error });
  }
  if (!verificationResult.value) return err({ kind: "INVALID_SIGNATURE", cause: undefined });
  return ok(undefined);
}

function invalidExtensionData(data: ParsedAuthenticatorData) {
  return data.hasExtensionData === (data.trailingBytes.byteLength === 0);
}

function validSignatureCounter(counter: number) {
  return Number.isInteger(counter) && counter >= 0 && counter <= 0xffff_ffff;
}

function classifySignatureCounter(stored: number, received: number): SignatureCounterStatus {
  if (stored === 0 && received === 0) {
    return "NOT_SUPPORTED";
  }
  if (received > stored) {
    return "VALID";
  }
  return "POSSIBLE_CLONE";
}
