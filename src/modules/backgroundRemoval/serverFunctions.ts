import { createServerFn } from "@tanstack/solid-start";
import { setResponseHeader } from "@tanstack/solid-start/server";
import * as v from "valibot";

import { authMiddleware } from "@/modules/auth/middleware";
import { getOrganization } from "@/modules/organizations/organizations";
import { OrganizationSlugValidator } from "@/modules/organizations/validators";

import {
  createBackgroundRemoval,
  deleteBackgroundRemoval,
  getBackgroundRemoval,
  listBackgroundRemovals,
  retryBackgroundRemoval,
} from "./backgroundRemovals";

const UuidValidator = v.pipe(v.string(), v.uuid());
const OrganizationValidator = v.object({ organizationSlug: OrganizationSlugValidator });

export const createBackgroundRemovalFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    v.object({
      organizationSlug: OrganizationSlugValidator,
      requestId: UuidValidator,
      inputFileId: UuidValidator,
    }),
  )
  .handler(async ({ context, data }) => {
    const organization = await requireOrganization(context.userId, data.organizationSlug);
    return createBackgroundRemoval({
      organizationId: organization.id,
      requestId: data.requestId,
      inputFileId: data.inputFileId,
    });
  });

export const listBackgroundRemovalsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(
    v.intersect([
      OrganizationValidator,
      v.object({
        cursor: v.optional(
          v.object({
            createdAt: v.pipe(v.string(), v.isoTimestamp()),
            id: UuidValidator,
          }),
        ),
      }),
    ]),
  )
  .handler(async ({ context, data }) => {
    setPrivateResponseHeaders();
    const organization = await requireOrganization(context.userId, data.organizationSlug);
    return listBackgroundRemovals({
      organizationId: organization.id,
      ...(data.cursor ? { cursor: data.cursor } : {}),
    });
  });

export const getBackgroundRemovalFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(
    v.object({
      organizationSlug: OrganizationSlugValidator,
      backgroundRemovalId: UuidValidator,
    }),
  )
  .handler(async ({ context, data }) => {
    setPrivateResponseHeaders();
    const organization = await requireOrganization(context.userId, data.organizationSlug);
    return getBackgroundRemoval({
      organizationId: organization.id,
      backgroundRemovalId: data.backgroundRemovalId,
    });
  });

export const retryBackgroundRemovalFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    v.object({
      organizationSlug: OrganizationSlugValidator,
      backgroundRemovalId: UuidValidator,
    }),
  )
  .handler(async ({ context, data }) => {
    const organization = await requireOrganization(context.userId, data.organizationSlug);
    return retryBackgroundRemoval({
      organizationId: organization.id,
      backgroundRemovalId: data.backgroundRemovalId,
    });
  });

export const deleteBackgroundRemovalFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    v.object({
      organizationSlug: OrganizationSlugValidator,
      backgroundRemovalId: UuidValidator,
    }),
  )
  .handler(async ({ context, data }) => {
    const organization = await requireOrganization(context.userId, data.organizationSlug);
    return deleteBackgroundRemoval({
      organizationId: organization.id,
      backgroundRemovalId: data.backgroundRemovalId,
    });
  });

async function requireOrganization(userId: string, organizationSlug: string) {
  const organization = await getOrganization({ userId, organizationSlug });
  if (!organization) throw new Error("Organization not found");
  return organization;
}

function setPrivateResponseHeaders() {
  setResponseHeader("Cache-Control", "no-store");
  setResponseHeader("Vary", "Cookie");
}
