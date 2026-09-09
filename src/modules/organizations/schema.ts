import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  type PgTimestampConfig,
  uuid,
} from "drizzle-orm/pg-core";

import * as authSchema from "@/modules/auth/schema.ts";

const timestampConfig = { withTimezone: true } as const satisfies PgTimestampConfig;

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").notNull().primaryKey(),
    slug: text("slug").unique().notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", timestampConfig).notNull().defaultNow(),
  },
  (table) => [index("idx_organizations_slug").on(table.slug)],
);

export const memberships = pgTable(
  "memberships",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authSchema.users.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    index("idx_memberships_user_id").on(table.userId),
  ],
);

export const organizationInvites = pgTable(
  "organization_invites",
  {
    id: uuid("id").notNull().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    secretHash: text("secret_hash").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => authSchema.users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", timestampConfig).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", timestampConfig).notNull(),
    acceptedAt: timestamp("accepted_at", timestampConfig),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => authSchema.users.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", timestampConfig),
  },
  (table) => [
    index("idx_organization_invites_organization_created").on(
      table.organizationId,
      table.createdAt,
    ),
    check(
      "organization_invites_terminal_state",
      sql`${table.acceptedAt} IS NULL OR ${table.revokedAt} IS NULL`,
    ),
    check(
      "organization_invites_acceptance",
      sql`${table.acceptedByUserId} IS NULL OR ${table.acceptedAt} IS NOT NULL`,
    ),
  ],
);
