import { randomUUIDv7 } from "node:crypto";

import { db } from "@/db";

import * as organizationSchema from "./schema";

export async function listOrganizations(options: { userId: string }) {
  const organizations = await db.query.organizations.findMany({
    where: { users: { id: options.userId } },
  });
  return organizations;
}

export async function createAndJoinOrganization(options: {
  userId: string;
  name: string;
  slug: string;
}) {
  return await db.transaction(async (tx) => {
    const organizationId = randomUUIDv7();

    await Promise.all([
      tx.insert(organizationSchema.organizations).values({
        id: organizationId,
        name: options.name,
        slug: options.slug,
      }),
      tx.insert(organizationSchema.memberships).values({
        organizationId,
        userId: options.userId,
      }),
    ]);

    return organizationId;
  });
}
