import { randomUUIDv7 } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

import { db } from "@/db";
import { users } from "@/modules/auth/schema";

import { acceptInvite, createInvite, listInvites, previewInvite, revokeInvite } from "./invites";
import { memberships, organizationInvites, organizations } from "./schema";

const owner = randomUUIDv7();
const colleague = randomUUIDv7();
const recipient = randomUUIDv7();
const otherRecipient = randomUUIDv7();
const organizationIds: string[] = [];

async function setup() {
  const organizationId = randomUUIDv7();
  organizationIds.push(organizationId);
  await db
    .insert(organizations)
    .values({ id: organizationId, name: "Invite test", slug: `invite-${organizationId}` });
  await db.insert(memberships).values([
    { organizationId, userId: owner },
    { organizationId, userId: colleague },
  ]);
  const result = await createInvite({ organizationId, userId: owner });
  if (!result.ok) throw new Error("Could not create test invite");
  return { organizationId, invite: result.value };
}

async function storedInvite(id: string) {
  const [invite] = await db
    .select()
    .from(organizationInvites)
    .where(eq(organizationInvites.id, id));
  return invite;
}

describe.runIf(process.env.RUN_DB_INTEGRATION === "1")("organization invites", () => {
  beforeAll(async () => {
    await db.insert(users).values(
      [owner, colleague, recipient, otherRecipient].map((id) => ({
        id,
        username: `invite-${id}`,
        passwordHash: "unused",
      })),
    );
  });

  afterAll(async () => {
    if (organizationIds.length)
      await db.delete(organizations).where(inArray(organizations.id, organizationIds));
    await db.delete(users).where(inArray(users.id, [owner, colleague, recipient, otherRecipient]));
  });

  test("any member can create, list, and revoke; outsiders cannot", async () => {
    const { organizationId, invite } = await setup();
    expect((await createInvite({ organizationId, userId: colleague })).ok).toBe(true);
    expect(await createInvite({ organizationId, userId: recipient })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await listInvites({ organizationId, userId: recipient })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await revokeInvite({ organizationId, inviteId: invite.id, userId: recipient })).toEqual({
      ok: false,
      error: "forbidden",
    });
    const list = await listInvites({ organizationId, userId: colleague });
    expect(list.ok && list.value).toHaveLength(2);
    expect(JSON.stringify(list)).not.toContain("secret");
    expect(JSON.stringify(list)).not.toContain(invite.token);
    expect(
      (await revokeInvite({ organizationId, inviteId: invite.id, userId: colleague })).ok,
    ).toBe(true);
  });

  test("stores only a hash, expires in seven days, and previews without consuming", async () => {
    const { invite } = await setup();
    const stored = await storedInvite(invite.id);
    expect(stored.secretHash).not.toBe(invite.token.split(".")[1]);
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBeCloseTo(7 * 86400_000, -3);
    expect(await previewInvite({ token: invite.token })).toMatchObject({
      ok: true,
      value: { name: "Invite test", alreadyMember: false },
    });
    expect((await storedInvite(invite.id)).acceptedAt).toBeNull();
    expect(await previewInvite({ token: "bad" })).toEqual({ ok: false, error: "invalid" });
    const forged = `${invite.id}.${"A".repeat(43)}`;
    expect(await previewInvite({ token: forged })).toEqual({ ok: false, error: "invalid" });
    expect(await acceptInvite({ token: forged, userId: recipient })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(
      await previewInvite({ token: `${randomUUIDv7()}.${invite.token.split(".")[1]}` }),
    ).toEqual({ ok: false, error: "invalid" });
  });

  test("revocation is scoped to the organization and prevents acceptance", async () => {
    const { organizationId, invite } = await setup();
    const other = await setup();
    expect(
      await revokeInvite({
        organizationId: other.organizationId,
        inviteId: invite.id,
        userId: owner,
      }),
    ).toEqual({ ok: false, error: "invalid" });
    expect((await revokeInvite({ organizationId, inviteId: invite.id, userId: owner })).ok).toBe(
      true,
    );
    expect(
      (await revokeInvite({ organizationId, inviteId: invite.id, userId: colleague })).ok,
    ).toBe(true);
    expect(await acceptInvite({ token: invite.token, userId: recipient })).toEqual({
      ok: false,
      error: "revoked",
    });
    expect(await previewInvite({ token: invite.token })).toEqual({ ok: false, error: "revoked" });
  });

  test("expired invites cannot be accepted or revoked", async () => {
    const { organizationId, invite } = await setup();
    await db
      .update(organizationInvites)
      .set({ expiresAt: new Date(0) })
      .where(eq(organizationInvites.id, invite.id));
    expect(await previewInvite({ token: invite.token })).toEqual({ ok: false, error: "expired" });
    expect(await acceptInvite({ token: invite.token, userId: recipient })).toEqual({
      ok: false,
      error: "expired",
    });
    expect(await revokeInvite({ organizationId, inviteId: invite.id, userId: owner })).toEqual({
      ok: false,
      error: "expired",
    });
  });

  test("existing members leave a pending invite usable", async () => {
    const { invite } = await setup();
    expect(await acceptInvite({ token: invite.token, userId: owner })).toMatchObject({
      ok: true,
      value: { alreadyMember: true },
    });
    expect((await storedInvite(invite.id)).acceptedAt).toBeNull();
    expect((await acceptInvite({ token: invite.token, userId: recipient })).ok).toBe(true);
  });

  test("acceptance is retryable, but cannot restore a removed membership", async () => {
    const { organizationId, invite } = await setup();
    expect(await acceptInvite({ token: invite.token, userId: recipient })).toMatchObject({
      ok: true,
      value: { alreadyMember: false },
    });
    await db
      .update(organizationInvites)
      .set({ expiresAt: new Date(0) })
      .where(eq(organizationInvites.id, invite.id));
    expect(await acceptInvite({ token: invite.token, userId: recipient })).toMatchObject({
      ok: true,
      value: { alreadyMember: true },
    });
    expect(await previewInvite({ token: invite.token, userId: recipient })).toMatchObject({
      ok: true,
      value: { alreadyMember: true },
    });
    expect(await acceptInvite({ token: invite.token, userId: otherRecipient })).toEqual({
      ok: false,
      error: "accepted",
    });
    await db
      .delete(memberships)
      .where(
        and(eq(memberships.organizationId, organizationId), eq(memberships.userId, recipient)),
      );
    expect(await acceptInvite({ token: invite.token, userId: recipient })).toEqual({
      ok: false,
      error: "accepted",
    });
    expect(await previewInvite({ token: invite.token, userId: recipient })).toEqual({
      ok: false,
      error: "accepted",
    });
  });

  test("a failed membership insert rolls back consumption", async () => {
    const { invite } = await setup();
    await expect(acceptInvite({ token: invite.token, userId: randomUUIDv7() })).rejects.toThrow();
    expect((await storedInvite(invite.id)).acceptedAt).toBeNull();
    expect((await acceptInvite({ token: invite.token, userId: recipient })).ok).toBe(true);
  });

  test("two recipients racing for one invite produce one membership", async () => {
    const { organizationId, invite } = await setup();
    const results = await Promise.all(
      [recipient, otherRecipient].map((userId) => acceptInvite({ token: invite.token, userId })),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "accepted" }]);
    const joined = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          inArray(memberships.userId, [recipient, otherRecipient]),
        ),
      );
    expect(joined).toHaveLength(1);
    expect((await storedInvite(invite.id)).acceptedByUserId).toBe(joined[0].userId);
  });

  test("one recipient racing through two invites consumes only one", async () => {
    const { organizationId, invite } = await setup();
    const second = await createInvite({ organizationId, userId: colleague });
    if (!second.ok) throw new Error("Could not create second invite");
    const results = await Promise.all(
      [invite, second.value].map(({ token }) => acceptInvite({ token, userId: recipient })),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    const stored = await Promise.all([invite, second.value].map(({ id }) => storedInvite(id)));
    expect(stored.filter((row) => row.acceptedAt)).toHaveLength(1);
  });

  test("acceptance and revocation have one winner", async () => {
    const { organizationId, invite } = await setup();
    const results = await Promise.all([
      acceptInvite({ token: invite.token, userId: recipient }),
      revokeInvite({ organizationId, inviteId: invite.id, userId: colleague }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const stored = await storedInvite(invite.id);
    expect(Boolean(stored.acceptedAt)).not.toBe(Boolean(stored.revokedAt));
    const joined = await db
      .select()
      .from(memberships)
      .where(
        and(eq(memberships.organizationId, organizationId), eq(memberships.userId, recipient)),
      );
    expect(joined).toHaveLength(stored.acceptedAt ? 1 : 0);
  });

  test("deleting a recipient preserves consumption; deleting the organization invalidates the link", async () => {
    const { organizationId, invite } = await setup();
    const temporaryUser = randomUUIDv7();
    await db
      .insert(users)
      .values({ id: temporaryUser, username: `invite-${temporaryUser}`, passwordHash: "unused" });
    expect((await acceptInvite({ token: invite.token, userId: temporaryUser })).ok).toBe(true);
    await db.delete(users).where(eq(users.id, temporaryUser));
    expect((await storedInvite(invite.id)).acceptedByUserId).toBeNull();
    expect(await acceptInvite({ token: invite.token, userId: recipient })).toEqual({
      ok: false,
      error: "accepted",
    });
    await db.delete(organizations).where(eq(organizations.id, organizationId));
    expect(await previewInvite({ token: invite.token })).toEqual({ ok: false, error: "invalid" });
  });
});
