export function inviteStatus(
  invite: {
    acceptedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date;
  },
  now = new Date(),
) {
  if (invite.acceptedAt) return "accepted" as const;
  if (invite.revokedAt) return "revoked" as const;
  if (invite.expiresAt <= now) return "expired" as const;
  return "pending" as const;
}

export const inviteErrorMessages = {
  forbidden: "You must be a member of this organization to manage invites.",
  invalid: "This invite link is invalid.",
  expired: "This invite has expired. Ask a member for a new link.",
  revoked: "This invite was revoked. Ask a member for a new link.",
  accepted: "This invite has already been used.",
} as const;
