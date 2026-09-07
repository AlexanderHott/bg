import { describe, expect, test } from "vite-plus/test";

import { inviteStatus } from "./inviteStatus";
import { destinationAfterAuth, inviteTokenFromHash, parseInviteToken } from "./inviteToken";

const token = `01994fd4-c3ef-7f5a-a0cb-768f7f6d3be6.${"A".repeat(43)}`;

describe("invite links", () => {
  test("accepts a canonical token from a URL fragment", () => {
    const link = new URL(`https://bg.example/invite/accept#${token}`);
    expect(inviteTokenFromHash(link.hash)).toBe(token);
    expect(inviteTokenFromHash(token)).toBe(token);
    expect(parseInviteToken(token)).toEqual({ id: token.slice(0, 36), secret: "A".repeat(43) });
    expect(link.pathname + link.search).not.toContain(token);
    expect(destinationAfterAuth(inviteTokenFromHash(link.hash))).toEqual({
      to: "/invite/accept",
      hash: token,
    });
  });

  test.each([
    "",
    "https://evil.example",
    "//evil.example",
    `${token}=`,
    `${token}extra`,
    token.slice(1),
    token.slice(0, -1) + "B",
    `%23${token}`,
  ])("rejects malformed token %s", (value) => {
    expect(parseInviteToken(value)).toBeUndefined();
    expect(inviteTokenFromHash(value)).toBeUndefined();
    expect(destinationAfterAuth(value)).toEqual({ to: "/" });
  });

  test("expires at the boundary and preserves terminal states", () => {
    const expiresAt = new Date("2026-09-13T12:00:00Z");
    const invite = { expiresAt, acceptedAt: null, revokedAt: null };
    expect(inviteStatus(invite, new Date(expiresAt.getTime() - 1))).toBe("pending");
    expect(inviteStatus(invite, expiresAt)).toBe("expired");
    expect(inviteStatus({ ...invite, acceptedAt: new Date(0) }, expiresAt)).toBe("accepted");
    expect(inviteStatus({ ...invite, revokedAt: new Date(0) }, expiresAt)).toBe("revoked");
  });
});
