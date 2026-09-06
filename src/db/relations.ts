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
    files: r.many.files(),
    backgroundRemovals: r.many.backgroundRemovals(),
    backgroundRemovalAttempts: r.many.backgroundRemovalAttempts(),
  },
  files: {
    organization: r.one.organizations({
      from: r.files.organizationId,
      to: r.organizations.id,
    }),
    inputForBackgroundRemovals: r.many.backgroundRemovals({
      from: r.files.id,
      to: r.backgroundRemovals.inputFileId,
      alias: "backgroundRemovalInput",
    }),
    backgroundRemovalAttempts: r.many.backgroundRemovalAttempts({
      from: r.files.id,
      to: r.backgroundRemovalAttempts.outputFileId,
      alias: "backgroundRemovalOutput",
    }),
  },
  backgroundRemovals: {
    organization: r.one.organizations({
      from: r.backgroundRemovals.organizationId,
      to: r.organizations.id,
    }),
    inputFile: r.one.files({
      from: r.backgroundRemovals.inputFileId,
      to: r.files.id,
      alias: "backgroundRemovalInput",
    }),
    attempts: r.many.backgroundRemovalAttempts(),
  },
  backgroundRemovalAttempts: {
    organization: r.one.organizations({
      from: r.backgroundRemovalAttempts.organizationId,
      to: r.organizations.id,
    }),
    backgroundRemoval: r.one.backgroundRemovals({
      from: r.backgroundRemovalAttempts.backgroundRemovalId,
      to: r.backgroundRemovals.id,
    }),
    outputFile: r.one.files({
      from: r.backgroundRemovalAttempts.outputFileId,
      to: r.files.id,
      alias: "backgroundRemovalOutput",
    }),
  },
}));
