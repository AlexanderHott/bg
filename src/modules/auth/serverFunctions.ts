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

import { signUp, signIn, signOut, getSession, listActiveSessions } from "./lib/auth";
import {
  formatSessionToken,
  parseSessionToken,
  SESSION_TOKEN_COOKIE_NAME,
} from "./lib/sessionToken";
import { authMiddleware } from "./middleware";
import { PasswordValidator, UsernameValidator } from "./validators";

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

    const { sessionToken } = signInResult;
    setCookie(SESSION_TOKEN_COOKIE_NAME, formatSessionToken(sessionToken), {
      maxAge: 60 * 60 * 24 * 30,
      httpOnly: true,
      secure: true,
      path: "/",
      sameSite: "lax",
    });
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

export const getSecretDataFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context: { userId, sessionId } }) => {
    return `${sessionId} - ${userId} - secret data`;
  });
