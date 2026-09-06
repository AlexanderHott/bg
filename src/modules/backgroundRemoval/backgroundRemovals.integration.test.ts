import { randomUUIDv7 } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

import { db } from "@/db";
import * as fileSchema from "@/modules/files/schema";
import * as organizationSchema from "@/modules/organizations/schema";

import {
  claimNextBackgroundRemoval,
  cleanDeletedBackgroundRemoval,
  completeBackgroundRemovalAttempt,
  createBackgroundRemoval,
  deleteBackgroundRemoval,
  getBackgroundRemoval,
  listBackgroundRemovals,
  recoverExpiredBackgroundRemovalAttempt,
} from "./backgroundRemovals";

const runIntegrationTests = process.env.RUN_DB_INTEGRATION === "1";
const organizationId = randomUUIDv7();
const inputFileId = randomUUIDv7();
const requestId = randomUUIDv7();

describe.runIf(runIntegrationTests)("background-removal queue", () => {
  beforeAll(async () => {
    await db.insert(organizationSchema.organizations).values({
      id: organizationId,
      name: "Background removal integration test",
      slug: `background-removal-${organizationId}`,
    });
    await db.insert(fileSchema.files).values({
      id: inputFileId,
      organizationId,
      requestId: randomUUIDv7(),
      state: "ready",
      name: "input.png",
      mediaType: "image/png",
      expectedSizeBytes: 100,
      sizeBytes: 100,
      storageKey: `tests/${organizationId}/input.png`,
      readyAt: new Date(),
    });
  });

  afterAll(async () => {
    await db
      .delete(organizationSchema.organizations)
      .where(eq(organizationSchema.organizations.id, organizationId));
  });

  test("creates idempotently, claims once, and rejects stale completion", async () => {
    const first = await createBackgroundRemoval({ organizationId, requestId, inputFileId });
    const second = await createBackgroundRemoval({ organizationId, requestId, inputFileId });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("Background removal was not created");
    expect(second.value.id).toBe(first.value.id);
    expect(second.value.requestId).toBe(first.value.requestId);

    const claimAt = new Date(Date.now() + 60_000);
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => claimNextBackgroundRemoval({ now: claimAt, organizationId })),
    );
    const [claim] = claims.filter((value) => value !== undefined);
    expect(claims.filter((value) => value !== undefined)).toHaveLength(1);
    expect(claim).toBeDefined();
    if (!claim?.attempt.leaseToken) throw new Error("Claim did not receive a lease token");

    const recoveredAt = new Date(claimAt.getTime() + 60_001);
    const recovered = await recoverExpiredBackgroundRemovalAttempt({
      now: recoveredAt,
      random: () => 0,
      organizationId,
    });
    expect(recovered?.id).toBe(claim.attempt.id);

    const staleCompletion = await completeBackgroundRemovalAttempt({
      attemptId: claim.attempt.id,
      leaseToken: claim.attempt.leaseToken,
      outputFileId: randomUUIDv7(),
      now: recoveredAt,
    });
    expect(staleCompletion).toEqual({ ok: false, error: { kind: "LEASE_LOST" } });

    const page = await listBackgroundRemovals({ organizationId });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.status).toBe("retrying");

    await expect(
      claimNextBackgroundRemoval({
        now: new Date(recoveredAt.getTime() + 3_999),
        organizationId,
      }),
    ).resolves.toBeUndefined();
    await expect(
      claimNextBackgroundRemoval({
        now: new Date(recoveredAt.getTime() + 4_000),
        organizationId,
      }),
    ).resolves.toBeDefined();
  });

  test("hides a deleted request before cleaning its durable rows", async () => {
    const created = await createBackgroundRemoval({
      organizationId,
      requestId: randomUUIDv7(),
      inputFileId,
    });
    if (!created.ok) throw new Error("Background removal was not created");

    await expect(
      deleteBackgroundRemoval({
        organizationId,
        backgroundRemovalId: created.value.id,
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(
      getBackgroundRemoval({
        organizationId,
        backgroundRemovalId: created.value.id,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { kind: "BACKGROUND_REMOVAL_NOT_FOUND" },
    });
    await expect(
      cleanDeletedBackgroundRemoval({ backgroundRemovalId: created.value.id }),
    ).resolves.toBe(true);
  });
});
