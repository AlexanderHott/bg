import { defineRelations } from "drizzle-orm";

import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  users: {
    sessions: r.many.sessions(),
    passkeys: r.many.passkeys(),
    webauthnRegistrationChallenges: r.many.webauthnRegistrationChallenges(),
    organizations: r.many.organizations({
      from: r.users.id.through(r.memberships.userId),
      to: r.organizations.id.through(r.memberships.organizationId),
    }),
  },
  sessions: {
    user: r.one.users({
      from: r.sessions.userId,
      to: r.users.id,
    }),
  },
  passkeys: {
    user: r.one.users({
      from: r.passkeys.userId,
      to: r.users.id,
    }),
  },
  webauthnRegistrationChallenges: {
    user: r.one.users({
      from: r.webauthnRegistrationChallenges.userId,
      to: r.users.id,
    }),
  },

  organizations: {
    users: r.many.users({
      from: r.organizations.id.through(r.memberships.organizationId),
      to: r.users.id.through(r.memberships.userId),
    }),
  },
}));
