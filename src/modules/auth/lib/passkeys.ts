import { randomUUIDv7 } from "node:crypto";

import { and, eq, lt } from "drizzle-orm";
import * as v from "valibot";

import { db } from "@/db";
import { envServer } from "@/envServer";
import { err, ok, type Result } from "@/lib/result";

import { issueSession, type AuthenticatedSession } from "../auth";
import * as authSchema from "../schema";
import { secureRandomBytes } from "./crypto";
import { encodeBase64url } from "./encoding";
import {
  makeAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationVerificationError,
} from "./webauthn/authentication";
import {
  makeRegistrationOptions,
  verifyRegistrationResponse,
  type RegistrationVerificationError,
} from "./webauthn/registration";
import { CredentialIdValidator } from "./webauthn/verification";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SUPPORTED_ALGORITHMS = [-8, -7, -257] as const;

const AuthenticationCredentialIdValidator = v.object({
  rawId: CredentialIdValidator,
});

function passkeyPolicy() {
  return {
    rpId: envServer.WEBAUTHN_RP_ID,
    expectedOrigin: envServer.WEBAUTHN_ORIGIN,
    requireUserVerification: true,
    supportedAlgorithms: SUPPORTED_ALGORITHMS,
  };
}

function newChallenge() {
  return encodeBase64url(secureRandomBytes(32));
}

export type BeginPasskeyRegistrationError = {
  kind: "INVALID_USER_ID";
};

export async function beginPasskeyRegistration(options: {
  userId: string;
  signal?: AbortSignal;
}): Promise<
  Result<
    {
      ceremonyId: string;
      options: PublicKeyCredentialCreationOptionsJSON;
    },
    BeginPasskeyRegistrationError
  >
> {
  options.signal?.throwIfAborted();
  const user = await db.query.users.findFirst({ where: { id: options.userId } });
  if (!user) {
    return err({ kind: "INVALID_USER_ID" });
  }

  options.signal?.throwIfAborted();
  const existingPasskeys = await db.query.passkeys.findMany({
    where: { userId: user.id },
    columns: { id: true, transports: true },
  });

  const now = new Date();
  const ceremonyId = randomUUIDv7();
  const challenge = newChallenge();

  options.signal?.throwIfAborted();
  await db
    .delete(authSchema.webauthnRegistrationChallenges)
    .where(lt(authSchema.webauthnRegistrationChallenges.expiresAt, now));
  await db.insert(authSchema.webauthnRegistrationChallenges).values({
    id: ceremonyId,
    userId: user.id,
    challenge,
    expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
  });

  return ok({
    ceremonyId,
    options: makeRegistrationOptions(
      { id: user.id, username: user.username },
      challenge,
      existingPasskeys,
    ),
  });
}

export type FinishPasskeyRegistrationError =
  | { kind: "INVALID_CEREMONY" }
  | {
      kind: "REGISTRATION_VERIFICATION_FAILED";
      cause: RegistrationVerificationError;
    };

export async function finishPasskeyRegistration(options: {
  userId: string;
  ceremonyId: string;
  credential: RegistrationResponseJSON;
  signal?: AbortSignal;
}): Promise<Result<{ credentialId: string }, FinishPasskeyRegistrationError>> {
  options.signal?.throwIfAborted();
  const consumedChallenges = await db
    .delete(authSchema.webauthnRegistrationChallenges)
    .where(
      and(
        eq(authSchema.webauthnRegistrationChallenges.id, options.ceremonyId),
        eq(authSchema.webauthnRegistrationChallenges.userId, options.userId),
      ),
    )
    .returning({
      challenge: authSchema.webauthnRegistrationChallenges.challenge,
      expiresAt: authSchema.webauthnRegistrationChallenges.expiresAt,
    });
  const consumedChallenge = consumedChallenges[0];
  if (!consumedChallenge || consumedChallenge.expiresAt.getTime() <= Date.now()) {
    return err({ kind: "INVALID_CEREMONY" });
  }

  const verificationResult = await verifyRegistrationResponse({
    credential: options.credential,
    expectedChallenge: consumedChallenge.challenge,
    policy: passkeyPolicy(),
  });
  if (!verificationResult.ok) {
    return err({
      kind: "REGISTRATION_VERIFICATION_FAILED",
      cause: verificationResult.error,
    });
  }

  const registration = verificationResult.value;
  options.signal?.throwIfAborted();
  await db.insert(authSchema.passkeys).values({
    id: registration.credentialId,
    userId: options.userId,
    publicKeySpki: registration.publicKeySpki,
    algorithm: registration.algorithm,
    signCount: registration.signCount,
    transports: registration.transports,
    backupEligible: registration.backupEligible,
    backedUp: registration.backedUp,
  });

  return ok({ credentialId: registration.credentialId });
}

export async function beginPasskeySignIn(options: { signal?: AbortSignal }): Promise<{
  ceremonyId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}> {
  const now = new Date();
  const ceremonyId = randomUUIDv7();
  const challenge = newChallenge();

  options.signal?.throwIfAborted();
  await db
    .delete(authSchema.webauthnAuthenticationChallenges)
    .where(lt(authSchema.webauthnAuthenticationChallenges.expiresAt, now));
  await db.insert(authSchema.webauthnAuthenticationChallenges).values({
    id: ceremonyId,
    challenge,
    expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
  });

  return {
    ceremonyId,
    options: makeAuthenticationOptions(challenge),
  };
}

export type PasskeySignInError =
  | { kind: "INVALID_CEREMONY" }
  | { kind: "MALFORMED_CREDENTIAL"; cause: unknown }
  | { kind: "UNKNOWN_CREDENTIAL" }
  | {
      kind: "AUTHENTICATION_VERIFICATION_FAILED";
      cause: AuthenticationVerificationError;
    }
  | { kind: "SIGNATURE_COUNTER_ROLLBACK" }
  | { kind: "CREDENTIAL_STATE_CHANGED" };

export async function finishPasskeySignIn(options: {
  ceremonyId: string;
  credential: AuthenticationResponseJSON;
  userAgent?: string;
  ip?: string;
  signal?: AbortSignal;
}): Promise<Result<AuthenticatedSession, PasskeySignInError>> {
  options.signal?.throwIfAborted();
  const consumedChallenges = await db
    .delete(authSchema.webauthnAuthenticationChallenges)
    .where(eq(authSchema.webauthnAuthenticationChallenges.id, options.ceremonyId))
    .returning({
      challenge: authSchema.webauthnAuthenticationChallenges.challenge,
      expiresAt: authSchema.webauthnAuthenticationChallenges.expiresAt,
    });
  const consumedChallenge = consumedChallenges[0];
  if (!consumedChallenge || consumedChallenge.expiresAt.getTime() <= Date.now()) {
    return err({ kind: "INVALID_CEREMONY" });
  }

  const credentialIdResult = v.safeParse(AuthenticationCredentialIdValidator, options.credential);
  if (!credentialIdResult.success) {
    return err({ kind: "MALFORMED_CREDENTIAL", cause: credentialIdResult.issues });
  }

  options.signal?.throwIfAborted();
  const passkey = await db.query.passkeys.findFirst({
    where: { id: credentialIdResult.output.rawId },
  });
  if (!passkey) {
    return err({ kind: "UNKNOWN_CREDENTIAL" });
  }

  const verificationResult = await verifyAuthenticationResponse({
    credential: options.credential,
    expectedChallenge: consumedChallenge.challenge,
    policy: passkeyPolicy(),
    storedPasskey: {
      credentialId: passkey.id,
      userHandle: passkey.userId,
      publicKeySpki: passkey.publicKeySpki,
      algorithm: passkey.algorithm,
      signCount: passkey.signCount,
      backupEligible: passkey.backupEligible,
    },
  });
  if (!verificationResult.ok) {
    return err({
      kind: "AUTHENTICATION_VERIFICATION_FAILED",
      cause: verificationResult.error,
    });
  }
  if (verificationResult.value.counterStatus === "POSSIBLE_CLONE") {
    return err({ kind: "SIGNATURE_COUNTER_ROLLBACK" });
  }

  options.signal?.throwIfAborted();
  const updatedPasskeys = await db
    .update(authSchema.passkeys)
    .set({
      signCount: verificationResult.value.newSignCount,
      backedUp: verificationResult.value.backedUp,
    })
    .where(
      and(
        eq(authSchema.passkeys.id, passkey.id),
        eq(authSchema.passkeys.signCount, passkey.signCount),
      ),
    )
    .returning({ id: authSchema.passkeys.id });
  if (updatedPasskeys.length !== 1) {
    return err({ kind: "CREDENTIAL_STATE_CHANGED" });
  }

  return ok(
    await issueSession({
      userId: passkey.userId,
      userAgent: options.userAgent,
      ip: options.ip,
      signal: options.signal,
    }),
  );
}
