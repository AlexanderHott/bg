import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  type PgTimestampConfig,
} from "drizzle-orm/pg-core";

const timestampConfig = { withTimezone: true } as const satisfies PgTimestampConfig;

export const users = pgTable(
  "users",
  {
    id: uuid("id").notNull().primaryKey(),
    username: text("username").unique().notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", timestampConfig).notNull().defaultNow(),
  },
  (table) => [index("idx_users_username").on(table.username)],
);

export type User = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;

export const webauthnRegistrationChallenges = pgTable("webauthn_registration_challenges", {
  id: uuid("id").notNull().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  challenge: text("challenge").notNull(),
  expiresAt: timestamp("expires_at", timestampConfig).notNull(),
  createdAt: timestamp("created_at", timestampConfig).notNull().defaultNow(),
});
export type WebauthnRegistrationChallenge = typeof webauthnRegistrationChallenges.$inferSelect;
export type WebauthnRegistrationChallengeInsert =
  typeof webauthnRegistrationChallenges.$inferInsert;

export const webauthnAuthenticationChallenges = pgTable("webauthn_authentication_challenges", {
  id: uuid("id").notNull().primaryKey(),
  challenge: text("challenge").notNull(),
  expiresAt: timestamp("expires_at", timestampConfig).notNull(),
  createdAt: timestamp("created_at", timestampConfig).notNull().defaultNow(),
});
export type WebauthnAuthenticationChallenge = typeof webauthnAuthenticationChallenges.$inferSelect;
export type WebauthnAuthenticationChallengeInsert =
  typeof webauthnAuthenticationChallenges.$inferInsert;

export const passkeys = pgTable(
  "passkeys",
  {
    id: text("id").notNull().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    publicKeySpki: text("public_key_spki").notNull(),
    algorithm: integer("algorithm").notNull(),
    signCount: bigint("sign_count", { mode: "number" }).notNull(),
    transports: jsonb().$type<string[]>().notNull(),
    backupEligible: boolean("backup_eligible").notNull(),
    backedUp: boolean("backed_up").notNull(),
    createdAt: timestamp("created_at", timestampConfig).notNull().defaultNow(),
  },
  (table) => [index("idx_passkeys_user_id").on(table.userId)],
);
export type Passkey = typeof passkeys.$inferSelect;
export type PasskeyInsert = typeof passkeys.$inferInsert;

export const sessions = pgTable(
  "sessions",
  {
    id: uuid().notNull().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    secretHash: text("secret_hash").notNull(),

    ip: text("ip"),
    userAgent: text("user_agent"),

    expiresAt: timestamp("expires_at", timestampConfig).notNull(),
    lastActiveAt: timestamp("last_active_at", timestampConfig).notNull().defaultNow(),
    createdAt: timestamp("created_at", timestampConfig).notNull().defaultNow(),
  },
  (table) => [index("idx_sessions_user_id").on(table.userId)],
);
export type Session = typeof sessions.$inferSelect;
export type SessionInsert = typeof sessions.$inferInsert;
