import { createServerFn } from "@tanstack/solid-start";
import * as v from "valibot";

import { authMiddleware } from "@/modules/auth/middleware";
import { getSessionFn } from "@/modules/auth/serverFunctions";

import { acceptInvite, createInvite, listInvites, previewInvite, revokeInvite } from "./invites";
import { InviteValidityDaysValidator } from "./validators";

const organizationInput = v.object({ organizationId: v.pipe(v.string(), v.uuid()) });
const tokenInput = v.object({ token: v.pipe(v.string(), v.maxLength(200)) });

export const createInviteFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    v.object({
      ...organizationInput.entries,
      validityDays: v.optional(InviteValidityDaysValidator, 7),
    }),
  )
  .handler(({ data, context }) => createInvite({ ...data, userId: context.userId }));

export const listInvitesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(organizationInput)
  .handler(({ data, context }) => listInvites({ ...data, userId: context.userId }));

export const revokeInviteFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(v.object({ ...organizationInput.entries, inviteId: v.pipe(v.string(), v.uuid()) }))
  .handler(({ data, context }) => revokeInvite({ ...data, userId: context.userId }));

// Keep the secret in the request body, including for this read-only operation.
export const previewInviteFn = createServerFn({ method: "POST" })
  .validator(tokenInput)
  .handler(async ({ data }) => {
    const session = await getSessionFn();
    const invite = await previewInvite({ ...data, userId: session?.userId });
    return { invite, session: session ? { username: session.username } : undefined };
  });

export const acceptInviteFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(tokenInput)
  .handler(({ data, context }) => acceptInvite({ ...data, userId: context.userId }));
