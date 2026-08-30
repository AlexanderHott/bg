import { createServerFn } from "@tanstack/solid-start";
import {
  deleteCookie,
  getCookie,
  getRequest,
  getRequestHeader,
  getRequestIP,
  setCookie,
} from "@tanstack/solid-start/server";
import * as v from "valibot";

import { getSession, listActiveSessions, listPasskeys, signIn, signOut, signUp } from "./auth";
import {
  beginPasskeyRegistration,
  beginPasskeySignIn,
  finishPasskeyRegistration,
  finishPasskeySignIn,
} from "./lib/passkeys";
import {
  formatSessionToken,
  parseSessionToken,
  SESSION_TOKEN_COOKIE_NAME,
  type SessionToken,
} from "./lib/sessionToken";
import { authMiddleware } from "./middleware";
import { PasswordValidator, UsernameValidator } from "./validators";

const CeremonyIdValidator = v.pipe(v.string(), v.uuid());
const ClientExtensionResultsValidator = v.object({});
const RegistrationCredentialValidator = v.object({
  authenticatorAttachment: v.optional(v.string()),
  clientExtensionResults: v.optional(ClientExtensionResultsValidator, {}),
  id: v.string(),
  rawId: v.string(),
  response: v.object({
    attestationObject: v.string(),
    authenticatorData: v.string(),
    clientDataJSON: v.string(),
    publicKey: v.optional(v.string()),
    publicKeyAlgorithm: v.pipe(v.number(), v.integer()),
    transports: v.array(v.string()),
  }),
  type: v.string(),
});
const AuthenticationCredentialValidator = v.object({
  authenticatorAttachment: v.optional(v.string()),
  clientExtensionResults: v.optional(ClientExtensionResultsValidator, {}),
  id: v.string(),
  rawId: v.string(),
  response: v.object({
    authenticatorData: v.string(),
    clientDataJSON: v.string(),
    signature: v.string(),
    userHandle: v.optional(v.string()),
  }),
  type: v.string(),
});

function setSessionTokenCookie(sessionToken: SessionToken) {
  setCookie(SESSION_TOKEN_COOKIE_NAME, formatSessionToken(sessionToken), {
    maxAge: 60 * 60 * 24 * 30,
    httpOnly: true,
    secure: true,
    path: "/",
    sameSite: "lax",
  });
}

export const signUpFn = createServerFn({ method: "POST" })
  .validator(
    v.object({
      username: UsernameValidator,
      password: PasswordValidator,
    }),
  )
  .handler(async ({ data }) => {
    const { signal } = getRequest();
    const userAgent = getRequestHeader("User-Agent");
    const ip = getRequestIP();

    await signUp({
      username: data.username,
      password: data.password,
      userAgent,
      ip,
      signal,
    });
  });

export const signInFn = createServerFn({ method: "POST" })
  .validator(
    v.object({
      username: UsernameValidator,
      password: PasswordValidator,
    }),
  )
  .handler(async ({ data }) => {
    const { signal } = getRequest();
    const userAgent = getRequestHeader("User-Agent");
    const ip = getRequestIP();

    const signInResult = await signIn({
      username: data.username,
      password: data.password,
      userAgent,
      ip,
      signal,
    });
    if (!signInResult) {
      // TODO: how to handle this?
      throw new Error("Auth failed...");
    }

    setSessionTokenCookie(signInResult.sessionToken);
  });

export const signOutFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { signal } = getRequest();
    await signOut({ sessionId: context.sessionId, userId: context.userId, signal });
    deleteCookie(SESSION_TOKEN_COOKIE_NAME);
  });

export const getSessionFn = createServerFn({ method: "GET" }).handler(async () => {
  const { signal } = getRequest();
  const sessionTokenCookie = getCookie(SESSION_TOKEN_COOKIE_NAME);
  if (!sessionTokenCookie) {
    return undefined;
  }
  const sessionToken = parseSessionToken(sessionTokenCookie);
  if (!sessionToken) {
    return undefined;
  }

  const session = await getSession({
    sessionToken,
    signal,
  });

  return session;
});

export const listActiveSessionsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context: { userId } }) => {
    const { signal } = getRequest();
    return await listActiveSessions({ userId, signal });
  });

export const revokeSessionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(v.object({ sessionId: v.string() }))
  .handler(async ({ data: { sessionId }, context: { userId } }) => {
    const { signal } = getRequest();
    return await signOut({ sessionId, userId, signal });
  });

export const listPasskeysFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context: { userId } }) => {
    const { signal } = getRequest();
    return listPasskeys({ userId, signal });
  });

export const beginPasskeyRegistrationFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context: { userId } }) => {
    const { signal } = getRequest();
    const result = await beginPasskeyRegistration({ userId, signal });
    if (!result.ok) {
      throw new Error("Could not begin passkey registration", { cause: result.error });
    }
    return result.value;
  });

export const finishPasskeyRegistrationFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    v.object({
      ceremonyId: CeremonyIdValidator,
      credential: RegistrationCredentialValidator,
    }),
  )
  .handler(async ({ data, context: { userId } }) => {
    const { signal } = getRequest();
    const result = await finishPasskeyRegistration({
      userId,
      ceremonyId: data.ceremonyId,
      credential: data.credential,
      signal,
    });
    if (!result.ok) {
      throw new Error("Passkey registration failed", { cause: result.error });
    }
    return result.value;
  });

export const beginPasskeyAuthFn = createServerFn({ method: "POST" }).handler(async () => {
  const { signal } = getRequest();
  return beginPasskeySignIn({ signal });
});

export const finishPasskeyAuthFn = createServerFn({ method: "POST" })
  .validator(
    v.object({
      ceremonyId: CeremonyIdValidator,
      credential: AuthenticationCredentialValidator,
    }),
  )
  .handler(async ({ data }) => {
    const { signal } = getRequest();
    const result = await finishPasskeySignIn({
      ceremonyId: data.ceremonyId,
      credential: data.credential,
      userAgent: getRequestHeader("User-Agent"),
      ip: getRequestIP(),
      signal,
    });
    if (!result.ok) {
      throw new Error("Passkey sign in failed", { cause: result.error });
    }

    setSessionTokenCookie(result.value.sessionToken);
    return { userId: result.value.userId, sessionId: result.value.sessionId };
  });

export const getSecretDataFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context: { userId, sessionId } }) => {
    return `${sessionId} - ${userId} - secret data`;
  });
