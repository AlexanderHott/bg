import {
  pgTable,
  timestamp,
  type PgTimestampConfig,
  uuid,
  unique,
  pgEnum,
} from "drizzle-orm/pg-core";

import * as fileSchema from "@/modules/files/schema.ts";
import * as organizationSchema from "@/modules/organizations/schema.ts";

const timestampConfig = { withTimezone: true } as const satisfies PgTimestampConfig;

export const backgroundRemovalStatus = pgEnum("background_removal_status", [
  "queued",
  "processing",
  "succeeded",
  "failed",
]);

export const backgroundRemovals = pgTable(
  "background_removals",
  {
    id: uuid("id").notNull().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationSchema.organizations.id),
    requestId: uuid("request_id").notNull(),
    inputFileId: uuid("input_file_id")
      .notNull()
      .references(() => fileSchema.files.id),
    outputFileId: uuid("output_file_id").references(() => fileSchema.files.id),
    status: backgroundRemovalStatus("status").notNull().default("queued"),
    createdAt: timestamp("created_at", timestampConfig).notNull().defaultNow(),
  },
  (table) => [
    unique("unique_background_removals_organization_id_request_id").on(
      table.organizationId,
      table.requestId,
    ),
  ],
);
