import { randomUUIDv7 } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { err, ok } from "@/lib/result";
import { constantTimeCompare, secureRandomBytes, sha256Hash } from "@/modules/auth/lib/crypto";
import { users } from "@/modules/auth/schema";

import { inviteStatus } from "./inviteStatus";
import { parseInviteToken } from "./inviteToken";
import { memberships, organizationInvites, organizations } from "./schema";

const inviteLifetimeMs = 7 * 24 * 60 * 60 * 1000;

function membershipWhere(organizationId: string, userId: string) {
  return and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId));
}

async function isMember(organizationId: string, userId: string) {
  const [membership] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(membershipWhere(organizationId, userId))
    .limit(1);
  return membership !== undefined;
}

async function secretMatches(secret: string, secretHash: string) {
  const hash = await sha256Hash(
    new Uint8Array(Uint8Array.fromBase64(secret, { alphabet: "base64url" })),
  );
  return constantTimeCompare(
    hash,
    new Uint8Array(Uint8Array.fromBase64(secretHash, { alphabet: "base64url" })),
  );
}

export async function createInvite(options: { organizationId: string; userId: string }) {
  if (!(await isMember(options.organizationId, options.userId))) return err("forbidden" as const);
  const secret = secureRandomBytes(32);
  const id = randomUUIDv7();
  const expiresAt = new Date(Date.now() + inviteLifetimeMs);
  await db.insert(organizationInvites).values({
    id,
    organizationId: options.organizationId,
    createdByUserId: options.userId,
    secretHash: (await sha256Hash(secret)).toBase64({ alphabet: "base64url" }),
    expiresAt,
  });
  return ok({
    id,
    token: `${id}.${secret.toBase64({ alphabet: "base64url", omitPadding: true })}`,
    expiresAt,
  });
}

export async function listInvites(options: { organizationId: string; userId: string }) {
  if (!(await isMember(options.organizationId, options.userId))) return err("forbidden" as const);
  const invites = await db
    .select({
      id: organizationInvites.id,
      createdBy: users.username,
      createdAt: organizationInvites.createdAt,
      expiresAt: organizationInvites.expiresAt,
      acceptedAt: organizationInvites.acceptedAt,
      revokedAt: organizationInvites.revokedAt,
    })
    .from(organizationInvites)
    .leftJoin(users, eq(users.id, organizationInvites.createdByUserId))
    .where(eq(organizationInvites.organizationId, options.organizationId))
    .orderBy(desc(organizationInvites.createdAt), desc(organizationInvites.id));
  return ok(invites);
}

export async function previewInvite(options: { token: string; userId?: string }) {
  const token = parseInviteToken(options.token);
  if (!token) return err("invalid" as const);
  const [row] = await db
    .select({
      invite: organizationInvites,
      organization: { name: organizations.name, slug: organizations.slug },
    })
    .from(organizationInvites)
    .innerJoin(organizations, eq(organizations.id, organizationInvites.organizationId))
    .where(eq(organizationInvites.id, token.id));
  if (!row || !(await secretMatches(token.secret, row.invite.secretHash)))
    return err("invalid" as const);
  const status = inviteStatus(row.invite);
  const alreadyMember = options.userId
    ? await isMember(row.invite.organizationId, options.userId)
    : false;
  if (status === "accepted" && row.invite.acceptedByUserId === options.userId && alreadyMember) {
    return ok({ ...row.organization, alreadyMember: true });
  }
  if (status !== "pending") return err(status);
  return ok({ ...row.organization, alreadyMember });
}

/** Lock the invite through membership insertion so acceptance and revocation have one winner. */
export async function acceptInvite(options: { token: string; userId: string }) {
  const token = parseInviteToken(options.token);
  if (!token) return err("invalid" as const);
  return db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(organizationInvites)
      .where(eq(organizationInvites.id, token.id))
      .for("update");
    if (!invite || !(await secretMatches(token.secret, invite.secretHash)))
      return err("invalid" as const);
    const now = new Date();
    const status = inviteStatus(invite, now);
    const [membership] = await tx
      .select()
      .from(memberships)
      .where(membershipWhere(invite.organizationId, options.userId));
    if (
      status !== "pending" &&
      !(status === "accepted" && invite.acceptedByUserId === options.userId && membership)
    ) {
      return err(status);
    }
    const [organization] = await tx
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, invite.organizationId));
    if (!organization) return err("invalid" as const);
    if (membership) return ok({ slug: organization.slug, alreadyMember: true });
    const [inserted] = await tx
      .insert(memberships)
      .values({ organizationId: invite.organizationId, userId: options.userId })
      .onConflictDoNothing()
      .returning();
    if (!inserted) return ok({ slug: organization.slug, alreadyMember: true });
    await tx
      .update(organizationInvites)
      .set({ acceptedAt: now, acceptedByUserId: options.userId })
      .where(eq(organizationInvites.id, invite.id));
    return ok({ slug: organization.slug, alreadyMember: false });
  });
}

export async function revokeInvite(options: {
  organizationId: string;
  inviteId: string;
  userId: string;
}) {
  if (!(await isMember(options.organizationId, options.userId))) return err("forbidden" as const);
  return db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(organizationInvites)
      .where(
        and(
          eq(organizationInvites.id, options.inviteId),
          eq(organizationInvites.organizationId, options.organizationId),
        ),
      )
      .for("update");
    if (!invite) return err("invalid" as const);
    const now = new Date();
    const status = inviteStatus(invite, now);
    if (status === "revoked") return ok(undefined);
    if (status !== "pending") return err(status);
    await tx
      .update(organizationInvites)
      .set({ revokedAt: now })
      .where(eq(organizationInvites.id, invite.id));
    return ok(undefined);
  });
}
