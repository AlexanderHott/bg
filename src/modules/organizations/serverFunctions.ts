import { createServerFn } from "@tanstack/solid-start";
import * as v from "valibot";

import { authMiddleware } from "@/modules/auth/middleware";

import { createAndJoinOrganization, getOrganization, listOrganizations } from "./organizations";
import { OrganizationNameValidator, OrganizationSlugValidator } from "./validators";

export const listOrganizationsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context: { userId } }) => {
    return await listOrganizations({ userId });
  });

export const createAndJoinOrganizationFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(
    v.object({
      slug: OrganizationSlugValidator,
      name: OrganizationNameValidator,
    }),
  )
  .handler(async ({ context, data }) => {
    return await createAndJoinOrganization({
      userId: context.userId,
      name: data.name,
      slug: data.slug,
    });
  });

export const getOrganizationFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(v.object({ organizationSlug: OrganizationSlugValidator }))
  .handler(async ({ context, data }) => {
    return await getOrganization({
      userId: context.userId,
      organizationSlug: data.organizationSlug,
    });
  });
