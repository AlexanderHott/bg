import { defineRelations } from "drizzle-orm";

import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  users: {
    sessions: r.many.sessions(),
    passkeys: r.many.passkeys(),
    webauthnRegistrationChallenges: r.many.webauthnRegistrationChallenges(),
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
}));
