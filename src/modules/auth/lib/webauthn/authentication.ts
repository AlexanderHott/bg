import * as v from "valibot";

import { envServer } from "@/envServer";
import { err, ok, type Result } from "@/lib/result";

import { sha256Hash } from "../crypto";
import { importPublicKeySpki, verifyWebAuthnSignature } from "./signature";
import {
  Base64URLValidator,
  bytesMatchBase64url,
  concatBytes,
  CredentialIdValidator,
  isSupportedAlgorithm,
  parseAuthenticatorData,
  parseBase64url,
  rpIdHashMatches,
  UserHandleValidator,
  verifyClientData,
  type WebAuthnPolicy,
} from "./verification";

export type { SupportedCoseAlgorithm, WebAuthnPolicy } from "./verification";

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
  const credentialIdResult = parseBase64url(credential.rawId);
  if (
    !credentialIdResult.ok ||
    credential.id !== credential.rawId ||
    !bytesMatchBase64url(credentialIdResult.value, input.storedPasskey.credentialId)
  ) {
    return err({ kind: "CREDENTIAL_ID_MISMATCH", cause: credentialIdResult });
  }

  const userHandle = credential.response.userHandle;
  if (userHandle === undefined) {
    return err({ kind: "USER_HANDLE_REQUIRED", cause: undefined });
  }
  const userHandleResult = parseBase64url(userHandle);
  if (!userHandleResult.ok) {
    return err({ kind: "MALFORMED_CREDENTIAL", cause: userHandleResult.error });
  }
  if (!bytesMatchBase64url(userHandleResult.value, input.storedPasskey.userHandle)) {
    return err({ kind: "USER_HANDLE_MISMATCH", cause: undefined });
  }

  const clientDataResult = verifyClientData({
    encodedClientData: credential.response.clientDataJSON,
    expectedType: "webauthn.get",
    expectedChallenge: input.expectedChallenge,
    expectedOrigin: input.policy.expectedOrigin,
  });
  if (!clientDataResult.ok) {
    return err({ kind: clientDataResult.error, cause: undefined });
  }

  const authenticatorDataBytesResult = parseBase64url(credential.response.authenticatorData);
  if (!authenticatorDataBytesResult.ok) {
    return err({
      kind: "INVALID_AUTHENTICATOR_DATA",
      cause: authenticatorDataBytesResult.error,
    });
  }

  const authenticatorDataResult = parseAuthenticatorData(authenticatorDataBytesResult.value);
  if (!authenticatorDataResult.ok) {
    return err({ kind: authenticatorDataResult.error, cause: undefined });
  }
  const authenticatorData = authenticatorDataResult.value;

  if (authenticatorData.hasAttestedCredentialData) {
    return err({ kind: "INVALID_AUTHENTICATOR_DATA", cause: undefined });
  }
  if (
    (!authenticatorData.hasExtensionData && authenticatorData.trailingBytes.byteLength !== 0) ||
    (authenticatorData.hasExtensionData && authenticatorData.trailingBytes.byteLength === 0)
  ) {
    return err({ kind: "INVALID_AUTHENTICATOR_DATA", cause: undefined });
  }
  if (!(await rpIdHashMatches(input.policy.rpId, authenticatorData.rpIdHash))) {
    return err({ kind: "RP_ID_MISMATCH", cause: undefined });
  }
  if (!authenticatorData.userPresent) {
    return err({ kind: "USER_PRESENCE_REQUIRED", cause: undefined });
  }
  if (input.policy.requireUserVerification && !authenticatorData.userVerified) {
    return err({ kind: "USER_VERIFICATION_REQUIRED", cause: undefined });
  }
  if (authenticatorData.backupEligible !== input.storedPasskey.backupEligible) {
    return err({ kind: "BACKUP_ELIGIBILITY_CHANGED", cause: undefined });
  }
  if (
    !Number.isInteger(input.storedPasskey.signCount) ||
    input.storedPasskey.signCount < 0 ||
    input.storedPasskey.signCount > 0xffff_ffff
  ) {
    return err({ kind: "INVALID_AUTHENTICATOR_DATA", cause: undefined });
  }
  if (!isSupportedAlgorithm(input.storedPasskey.algorithm, input.policy.supportedAlgorithms)) {
    return err({ kind: "UNSUPPORTED_ALGORITHM", cause: input.storedPasskey.algorithm });
  }

  const publicKeyResult = parseBase64url(input.storedPasskey.publicKeySpki);
  if (!publicKeyResult.ok) {
    return err({ kind: "INVALID_PUBLIC_KEY", cause: publicKeyResult.error });
  }
  const importedPublicKeyResult = importPublicKeySpki({
    algorithm: input.storedPasskey.algorithm,
    publicKeySpki: publicKeyResult.value,
  });
  if (!importedPublicKeyResult.ok) {
    return err({ kind: "INVALID_PUBLIC_KEY", cause: importedPublicKeyResult.error });
  }

  const signatureResult = parseBase64url(credential.response.signature);
  if (!signatureResult.ok) {
    return err({ kind: "MALFORMED_CREDENTIAL", cause: signatureResult.error });
  }

  const clientDataHash = await sha256Hash(clientDataResult.value.bytes);
  const signedData = concatBytes(authenticatorData.bytes, clientDataHash);

  const verificationResult = verifyWebAuthnSignature({
    algorithm: input.storedPasskey.algorithm,
    publicKey: importedPublicKeyResult.value,
    signature: signatureResult.value,
    signedData,
  });
  if (!verificationResult.ok) {
    return err({ kind: "INVALID_SIGNATURE", cause: verificationResult.error });
  }
  if (!verificationResult.value) {
    return err({ kind: "INVALID_SIGNATURE", cause: undefined });
  }

  return ok({
    newSignCount: authenticatorData.signCount,
    counterStatus: classifySignatureCounter(
      input.storedPasskey.signCount,
      authenticatorData.signCount,
    ),
    backedUp: authenticatorData.backedUp,
  });
}

export function classifySignatureCounter(stored: number, received: number): SignatureCounterStatus {
  if (stored === 0 && received === 0) {
    return "NOT_SUPPORTED";
  }
  if (received > stored) {
    return "VALID";
  }
  return "POSSIBLE_CLONE";
}
