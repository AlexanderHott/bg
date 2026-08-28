import { db } from "@/db";
import * as authSchema from "../schema";
import { randomUUIDv7 } from "node:crypto";
import { createSession, validateSession } from "./sessions";
import { type SessionToken } from "./sessionToken";
import { argon2Hash, argon2Verify } from "./crypto";
import { eq } from "drizzle-orm";

export interface SignUpOptions {
  username: string;
  password: string;
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

  const { session, secret } = await createSession({
    userId: user.id,
    nowMs: Date.now(),
  });

  options.signal?.throwIfAborted();
  await db.insert(authSchema.sessions).values(session);

  const sessionToken = {
    id: session.id,
    secret,
  };

  return {
    userId: user.id,
    sessionId: session.id,
    sessionToken,
  };
}

export interface SignOutOptions {
  sessionId: string;
  signal?: AbortSignal;
}
export async function signOut(options: SignOutOptions) {
  options.signal?.throwIfAborted();
  await db.delete(authSchema.sessions).where(eq(authSchema.sessions.id, options.sessionId));
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
    session,
    sessionToken: options.sessionToken,
    nowMs: Date.now(),
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
