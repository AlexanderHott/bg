import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/solid-start";
import { setResponseHeader } from "@tanstack/solid-start/server";

const privateResponses = createMiddleware().server(async ({ next }) => {
  setResponseHeader("Cache-Control", "private, no-store");
  setResponseHeader("Referrer-Policy", "no-referrer");
  return next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [
    privateResponses,
    createCsrfMiddleware({ filter: (context) => context.handlerType === "serverFn" }),
  ],
}));
