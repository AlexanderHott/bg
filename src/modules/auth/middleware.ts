import { createMiddleware } from "@tanstack/solid-start";
import { getCookie } from "@tanstack/solid-start/server";

import { getSession } from "./auth";
import { parseSessionToken, SESSION_TOKEN_COOKIE_NAME } from "./lib/sessionToken";

export const authMiddleware = createMiddleware({
  type: "function",
}).server(async ({ next, signal }) => {
  const sessionTokenCookie = getCookie(SESSION_TOKEN_COOKIE_NAME);
  if (!sessionTokenCookie) {
    throw new Error("Unauthorized");
  }
  const sessionToken = parseSessionToken(sessionTokenCookie);
  if (!sessionToken) {
    throw new Error("Unauthorized");
  }

  const session = await getSession({
    sessionToken,
    signal,
  });
  if (!session) {
    throw new Error("Unauthorized");
  }

  return next({
    context: {
      userId: session.userId,
      sessionId: session.sessionId,
    },
  });
});
