import * as v from "valibot";

import { envServer } from "@/envServer";
import { err, ok, type Result } from "@/lib/result";

import type { Bytes } from "../crypto";
import { importPublicKeySpki } from "./signature";
import {
  Base64URLValidator,
  bytesMatchBase64url,
  CredentialIdValidator,
  isSupportedAlgorithm,
  MAX_CREDENTIAL_ID_LENGTH,
  parseBase64url,
  verifyAuthenticatorData,
  verifyClientData,
  type SupportedCoseAlgorithm,
  type WebAuthnPolicy,
} from "./verification";

export type { SupportedCoseAlgorithm, WebAuthnPolicy } from "./verification";

const RegistrationResponseValidator = v.object({
  id: CredentialIdValidator,
  rawId: CredentialIdValidator,
  type: v.literal("public-key"),
  response: v.object({
    clientDataJSON: Base64URLValidator,
    authenticatorData: Base64URLValidator,
    publicKey: Base64URLValidator,
    publicKeyAlgorithm: v.pipe(v.number(), v.integer()),
    transports: v.array(v.string()),
  }),
});

export function makeRegistrationOptions(
  user: { id: string; username: string },
  challenge: Base64URLString,
  existingPasskeys: Array<{
    id: Base64URLString;
    transports: string[];
  }>,
): PublicKeyCredentialCreationOptionsJSON {
  return {
    rp: {
      id: envServer.WEBAUTHN_RP_ID,
      name: "bg",
    },
    user: {
      id: user.id,
      name: user.username,
      displayName: user.username,
    },
    challenge,
    pubKeyCredParams: [
      // TODO: name algorithms via constants
      { type: "public-key", alg: -8 },
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 },
    ],
    timeout: 60 * 1000,
    excludeCredentials: existingPasskeys.map((passkey) => ({
      type: "public-key",
      id: passkey.id,
      transports: passkey.transports,
    })),
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    },
    attestation: "none",
    extensions: {
      credProps: true,
    },
  };
}

export interface VerifyRegistrationResponseInput {
  credential: RegistrationResponseJSON;
  expectedChallenge: Base64URLString;
  policy: WebAuthnPolicy;
}

export interface VerifiedRegistration {
  credentialId: Base64URLString;

  /**
   * The credential public key encoded as DER SubjectPublicKeyInfo.
   */
  publicKeySpki: Base64URLString;

  algorithm: SupportedCoseAlgorithm;
  signCount: number;

  backupEligible: boolean;
  backedUp: boolean;

  /**
   * Browser-provided hints. They are useful when constructing
   * allowCredentials but are not cryptographically trusted.
   */
  transports: string[];
}

export interface RegistrationVerificationError {
  kind:
    | "MALFORMED_CREDENTIAL"
    | "INVALID_CLIENT_DATA"
    | "WRONG_CLIENT_DATA_TYPE"
    | "CHALLENGE_MISMATCH"
    | "ORIGIN_MISMATCH"
    | "CROSS_ORIGIN_NOT_ALLOWED"
    | "INVALID_AUTHENTICATOR_DATA"
    | "RP_ID_MISMATCH"
    | "USER_PRESENCE_REQUIRED"
    | "USER_VERIFICATION_REQUIRED"
    | "INVALID_BACKUP_FLAGS"
    | "MISSING_CREDENTIAL_DATA"
    | "CREDENTIAL_ID_MISMATCH"
    | "UNSUPPORTED_ALGORITHM"
    | "INVALID_PUBLIC_KEY";
  cause: unknown;
}

export async function verifyRegistrationResponse(
  input: VerifyRegistrationResponseInput,
): Promise<Result<VerifiedRegistration, RegistrationVerificationError>> {
  const credentialResult = v.safeParse(RegistrationResponseValidator, input.credential);
  if (!credentialResult.success) {
    return err({ kind: "MALFORMED_CREDENTIAL", cause: credentialResult.issues });
  }

  const credential = credentialResult.output;
  const clientDataResult = verifyClientData({
    encodedClientData: credential.response.clientDataJSON,
    expectedType: "webauthn.create",
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

  if (!authenticatorData.hasAttestedCredentialData) {
    return err({ kind: "MISSING_CREDENTIAL_DATA", cause: undefined });
  }

  const credentialIdResult = parseAttestedCredentialId(authenticatorData.trailingBytes);
  if (!credentialIdResult.ok) {
    return credentialIdResult;
  }

  if (
    credential.id !== credential.rawId ||
    !bytesMatchBase64url(credentialIdResult.value, credential.rawId)
  ) {
    return err({ kind: "CREDENTIAL_ID_MISMATCH", cause: undefined });
  }

  const algorithm = credential.response.publicKeyAlgorithm;
  if (!isSupportedAlgorithm(algorithm, input.policy.supportedAlgorithms)) {
    return err({ kind: "UNSUPPORTED_ALGORITHM", cause: algorithm });
  }

  const publicKeySpkiResult = parseBase64url(credential.response.publicKey);
  if (!publicKeySpkiResult.ok) {
    return err({ kind: "INVALID_PUBLIC_KEY", cause: publicKeySpkiResult.error });
  }
  const importedPublicKeyResult = importPublicKeySpki({
    algorithm,
    publicKeySpki: publicKeySpkiResult.value,
  });
  if (!importedPublicKeyResult.ok) {
    return err({ kind: "INVALID_PUBLIC_KEY", cause: importedPublicKeyResult.error });
  }

  return ok({
    credentialId: credential.rawId,
    publicKeySpki: credential.response.publicKey,
    algorithm,
    signCount: authenticatorData.signCount,
    backupEligible: authenticatorData.backupEligible,
    backedUp: authenticatorData.backedUp,
    transports: [...new Set(credential.response.transports)],
  });
}

function parseAttestedCredentialId(bytes: Bytes): Result<Bytes, RegistrationVerificationError> {
  const AAGUID_LENGTH = 16;
  const CREDENTIAL_ID_LENGTH_FIELD = 2;
  if (bytes.byteLength < AAGUID_LENGTH + CREDENTIAL_ID_LENGTH_FIELD) {
    return err({ kind: "MISSING_CREDENTIAL_DATA", cause: undefined });
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const credentialIdLength = view.getUint16(AAGUID_LENGTH, false);
  if (credentialIdLength === 0 || credentialIdLength > MAX_CREDENTIAL_ID_LENGTH) {
    return err({ kind: "MISSING_CREDENTIAL_DATA", cause: undefined });
  }

  const credentialIdStart = AAGUID_LENGTH + CREDENTIAL_ID_LENGTH_FIELD;
  const publicKeyStart = credentialIdStart + credentialIdLength;
  if (publicKeyStart >= bytes.byteLength) {
    return err({ kind: "MISSING_CREDENTIAL_DATA", cause: undefined });
  }

  return ok(bytes.slice(credentialIdStart, publicKeyStart));
}
