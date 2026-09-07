const inviteTokenPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

export function parseInviteToken(token: string) {
  if (!inviteTokenPattern.test(token)) return undefined;
  return { id: token.slice(0, 36), secret: token.slice(37) };
}

/** Invite secrets travel in URL fragments, including through the auth forms. */
export function inviteTokenFromHash(hash: string) {
  const token = hash.startsWith("#") ? hash.slice(1) : hash;
  return parseInviteToken(token) ? token : undefined;
}

export function destinationAfterAuth(invite?: string) {
  return invite && parseInviteToken(invite)
    ? { to: "/invite/accept" as const, hash: invite }
    : { to: "/" as const };
}
