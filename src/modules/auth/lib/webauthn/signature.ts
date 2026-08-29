import { constants, createPublicKey, verify, type KeyObject } from "node:crypto";

import { err, trySync, type Result } from "@/lib/result";

import type { Bytes } from "../crypto";
import type { SupportedCoseAlgorithm } from "./verification";

export function importPublicKeySpki(input: {
  algorithm: SupportedCoseAlgorithm;
  publicKeySpki: Bytes;
}): Result<KeyObject, unknown> {
  const publicKeyResult = trySync(() =>
    createPublicKey({
      key: input.publicKeySpki,
      format: "der",
      type: "spki",
    }),
  );
  if (!publicKeyResult.ok) {
    return publicKeyResult;
  }

  const keyMatchesAlgorithmResult = trySync(() =>
    keyMatchesAlgorithm(publicKeyResult.value.export({ format: "jwk" }), input.algorithm),
  );
  if (!keyMatchesAlgorithmResult.ok) {
    return keyMatchesAlgorithmResult;
  }
  if (!keyMatchesAlgorithmResult.value) {
    return err(new Error("Public key does not match its WebAuthn algorithm"));
  }

  return publicKeyResult;
}

export function verifyWebAuthnSignature(input: {
  algorithm: SupportedCoseAlgorithm;
  publicKey: KeyObject;
  signature: Bytes;
  signedData: Bytes;
}): Result<boolean, unknown> {
  return trySync(() => {
    switch (input.algorithm) {
      case -8:
        return verify(null, input.signedData, input.publicKey, input.signature);
      case -7:
        return verify(
          "sha256",
          input.signedData,
          { key: input.publicKey, dsaEncoding: "der" },
          input.signature,
        );
      case -257:
        return verify(
          "sha256",
          input.signedData,
          { key: input.publicKey, padding: constants.RSA_PKCS1_PADDING },
          input.signature,
        );
    }
  });
}

function keyMatchesAlgorithm(key: JsonWebKey, algorithm: SupportedCoseAlgorithm) {
  switch (algorithm) {
    case -8:
      return key.kty === "OKP" && key.crv === "Ed25519";
    case -7:
      return key.kty === "EC" && key.crv === "P-256";
    case -257:
      return key.kty === "RSA";
  }
}
