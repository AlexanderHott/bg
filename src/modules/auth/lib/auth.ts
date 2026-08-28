import { randomUUIDv7 } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";

import * as authSchema from "../schema";
import { argon2Hash, argon2Verify } from "./crypto";
import { createSession, validateSession } from "./sessions";
import { type SessionToken } from "./sessionToken";

export interface SignUpOptions {
  username: string;
  password: string;
  userAgent?: string;
  ip?: string;
  signal?: AbortSignal;
}
export async function signUp(options: SignUpOptions) {
  const passwordHash = await argon2Hash(options.password, options.signal);

  options.signal?.throwIfAborted();
  const id = randomUUIDv7();
  await db.insert(authSchema.users).values({
    id,
    username: options.username,
    passwordHash,
  });

  return { id };
}

export interface SignInOptions {
  username: string;
  password: string;
  userAgent?: string;
  ip?: string;
  signal?: AbortSignal;
}
export async function signIn(options: SignInOptions) {
  options.signal?.throwIfAborted();
  const user = await db.query.users.findFirst({ where: { username: options.username } });
  if (user === undefined) {
    return undefined;
  }

  const passwordsMatch = await argon2Verify(user.passwordHash, options.password, options.signal);
  if (!passwordsMatch) {
    return undefined;
  }

  const { secret, secretHash, expiresAt } = await createSession({
    nowMs: Date.now(),
  });

  options.signal?.throwIfAborted();
  const sessionId = randomUUIDv7();
  await db.insert(authSchema.sessions).values({
    id: sessionId,
    expiresAt,
    secretHash,
    userAgent: options.userAgent,
    ip: options.ip,
    userId: user.id,
  });

  const sessionToken = {
    id: sessionId,
    secret,
  };

  return {
    userId: user.id,
    sessionId,
    sessionToken,
  };
}

export interface SignOutOptions {
  sessionId: string;
  userId: string;
  signal?: AbortSignal;
}
export async function signOut(options: SignOutOptions) {
  options.signal?.throwIfAborted();
  await db
    .delete(authSchema.sessions)
    .where(
      and(
        eq(authSchema.sessions.id, options.sessionId),
        eq(authSchema.sessions.userId, options.userId),
      ),
    );
}

export interface GetSessionOptions {
  sessionToken: SessionToken;
  signal?: AbortSignal;
}
export async function getSession(options: GetSessionOptions) {
  options.signal?.throwIfAborted();
  const session = await db.query.sessions.findFirst({
    where: { id: options.sessionToken.id },
  });
  if (!session) {
    return undefined;
  }

  const sessionIsValid = await validateSession({
    secret: options.sessionToken.secret,
    secretHash: session.secretHash,
    expiresAt: session.expiresAt,
    now: new Date(),
  });
  if (!sessionIsValid) {
    options.signal?.throwIfAborted();
    await db.delete(authSchema.sessions).where(eq(authSchema.sessions.id, options.sessionToken.id));
    return undefined;
  }

  return {
    sessionId: session.id,
    userId: session.userId,
  };
}

export interface ListActiveSessionsOptions {
  userId: string;
  signal?: AbortSignal;
}
export async function listActiveSessions(options: ListActiveSessionsOptions) {
  options.signal?.throwIfAborted();
  const activeSessions = await db.query.sessions.findMany({
    where: { userId: options.userId, expiresAt: { gt: new Date() } },
    orderBy: { expiresAt: "desc" },
  });

  return activeSessions;
}
