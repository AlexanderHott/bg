import { createServerFn } from "@tanstack/solid-start";
import { signUp, signIn, signOut, getSession } from "./lib/auth";
import { getCookie, getRequest, setCookie } from "@tanstack/solid-start/server";
import * as v from "valibot";
import {
  formatSessionToken,
  parseSessionToken,
  SESSION_TOKEN_COOKIE_NAME,
} from "./lib/sessionToken";
import { authMiddleware } from "./middleware";

export const signUpFn = createServerFn({ method: "POST" })
  .validator(
    v.object({
      username: v.pipe(v.string(), v.minLength(3), v.maxLength(32)),
      password: v.pipe(v.string(), v.minLength(8), v.maxLength(64)),
    }),
  )
  .handler(async ({ data }) => {
    const { signal } = getRequest();
    await signUp({
      username: data.username,
      password: data.password,
      signal,
    });
  });

export const signInFn = createServerFn({ method: "POST" })
  .validator(
    v.object({
      username: v.pipe(v.string(), v.minLength(3), v.maxLength(32)),
      password: v.pipe(v.string(), v.minLength(8), v.maxLength(64)),
    }),
  )
  .handler(async ({ data }) => {
    const { signal } = getRequest();

    const signInResult = await signIn({
      username: data.username,
      password: data.password,
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
    await signOut({ sessionId: context.sessionId, signal });
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

export const getSecretDataFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context: { userId, sessionId } }) => {
    return `${sessionId} - ${userId} - secret data`;
  });
