import { createMiddleware, createServerFn } from "@tanstack/solid-start";
import * as v from "valibot";
import { db } from "../../../db";
import * as authSchema from "../schema";
import { hash, verify } from "@node-rs/argon2";
import { notFound } from "@tanstack/solid-router";
import { randomUUIDv7 } from "node:crypto";
import { getCookie, setCookie, setResponseStatus } from "@tanstack/solid-start/server";
import { HttpStatusCode } from "../../../lib/http";
import { createSession, isSessionValid } from "./sessions";
import { formatSessionToken, parseSessionToken } from "./sessionToken";

const SESSION_TOKEN_COOKIE_NAME = "bg_session_token";

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

export const signUp = createServerFn({ method: "POST" })
  .validator(
    v.object({
      username: v.pipe(v.string(), v.minLength(3), v.maxLength(32)),
      password: v.pipe(v.string(), v.minLength(8), v.maxLength(64)),
    }),
  )
  .handler(async ({ data }) => {
    const passwordHash = await hash(data.password, {
      algorithm: Algorithm.Argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    const id = randomUUIDv7();
    await db.insert(authSchema.users).values({
      id,
      username: data.username,
      passwordHash,
    });
    return { id };
  });

export const logIn = createServerFn({ method: "POST" })
  .validator(
    v.object({
      username: v.pipe(v.string(), v.minLength(3), v.maxLength(32)),
      password: v.pipe(v.string(), v.minLength(8), v.maxLength(64)),
    }),
  )
  .handler(async ({ data }) => {
    const user = await db.query.users.findFirst({ where: { username: data.username } });
    if (user === undefined) {
      console.log("[logIn] no user with username", data.username);
      throw notFound();
    }

    const passwordsMatch = await verify(user.passwordHash, data.password, {
      algorithm: Algorithm.Argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    if (!passwordsMatch) {
      console.log("[logIn] password doesn't match");
      setResponseStatus(HttpStatusCode.UNAUTHORIZED);
      return;
    }

    console.log("[logIn] creating session...");
    const { session, secret } = await createSession({
      userId: user.id,
      nowMs: Date.now(),
    });

    try {
      await db.insert(authSchema.sessions).values(session);
    } catch (e) {
      console.log("error inserting session", e);
      throw e;
    }

    const sessionToken = {
      id: session.id,
      secret,
    };

    setCookie(SESSION_TOKEN_COOKIE_NAME, formatSessionToken(sessionToken), {
      maxAge: 86400,
      httpOnly: true,
      secure: true,
      path: "/",
      sameSite: "lax",
    });

    return {
      userId: user.id,
      sessionId: session.id,
    };
  });

function unauthorized() {
  setResponseStatus(HttpStatusCode.UNAUTHORIZED);
  return new Error("Unauthorized");
}

async function assertSession() {
  const sessionTokenCookie = getCookie(SESSION_TOKEN_COOKIE_NAME);
  if (!sessionTokenCookie) {
    throw unauthorized();
  }
  const sessionToken = parseSessionToken(sessionTokenCookie);
  if (!sessionToken) {
    throw unauthorized();
  }

  const session = await db.query.sessions.findFirst({
    where: { id: sessionToken.id },
  });
  if (!session) {
    throw unauthorized();
  }

  if (
    !isSessionValid({
      session,
      sessionToken,
      nowMs: Date.now(),
    })
  ) {
    throw unauthorized();
  }

  return {
    sessionId: session.id,
    userId: session.userId,
  };
}

export const authMiddleware = createMiddleware({
  type: "function",
}).server(async ({ next }) => {
  console.time("assertSession");
  const session = await assertSession();
  console.timeEnd("assertSession");

  return next({
    context: {
      userId: session.userId,
      sessionId: session.sessionId,
    },
  });
});

export const getSecretData = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context: { userId, sessionId } }) => {
    return `${sessionId} - ${userId} - secret data`;
  });
