import {
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

export const webauthnChallenges = pgTable("webauthn_challenges", {
  id: uuid("id").notNull().primaryKey(),
  challengeHash: text("challenge_hash").notNull(),
  expiresAt: timestamp("expires_at", timestampConfig).notNull(),
  createdAt: timestamp("created_at", timestampConfig).notNull().defaultNow(),
});
export type WebauthnChallenge = typeof webauthnChallenges.$inferSelect;
export type WebauthnChallengeInsert = typeof webauthnChallenges.$inferInsert;

export const passkeys = pgTable(
  "passkeys",
  {
    id: text("id").notNull().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    publicKey: text("public_key").notNull(),
    counter: integer().notNull(),
    transports: jsonb().$type<string[]>().notNull(),
    deviceType: text("device_type").notNull(),
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
    expiresAt: timestamp("expires_at", timestampConfig).notNull(),
    createdAt: timestamp("created_at", timestampConfig).notNull().defaultNow(),
  },
  (table) => [index("idx_sessions_user_id").on(table.userId)],
);
export type Session = typeof sessions.$inferSelect;
export type SessionInsert = typeof sessions.$inferInsert;
