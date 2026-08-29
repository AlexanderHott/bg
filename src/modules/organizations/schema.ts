import { index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
