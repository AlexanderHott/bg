import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  type PgTimestampConfig,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import * as organizationSchema from "@/modules/organizations/schema.ts";

const timestampConfig = { withTimezone: true } as const satisfies PgTimestampConfig;

export const fileState = pgEnum("file_state", ["pending", "ready"]);

export const files = pgTable(
  "files",
  {
    id: uuid("id").notNull().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationSchema.organizations.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    state: fileState("state").notNull(),
    name: text("name").notNull(),
    mediaType: text("media_type").notNull(),
    expectedSizeBytes: integer("expected_size_bytes").notNull(),
    sizeBytes: integer("size_bytes"),
    storageKey: text("storage_key").notNull().unique(),
    createdAt: timestamp("created_at", timestampConfig).notNull().defaultNow(),
    readyAt: timestamp("ready_at", timestampConfig),
  },
  (table) => [
    unique("unique_files_organization_id_request_id").on(table.organizationId, table.requestId),
    check("files_expected_size_positive", sql`${table.expectedSizeBytes} > 0`),
    check(
      "files_state_metadata_consistent",
      sql`(
        (${table.state} = 'pending' AND ${table.sizeBytes} IS NULL AND ${table.readyAt} IS NULL)
        OR
        (${table.state} = 'ready' AND ${table.sizeBytes} = ${table.expectedSizeBytes} AND ${table.readyAt} IS NOT NULL)
      )`,
    ),
  ],
);
export type File = typeof files.$inferSelect;

export const fileUploads = pgTable("file_uploads", {
  fileId: uuid("file_id")
    .primaryKey()
    .references(() => files.id, { onDelete: "cascade" }),
  bucketUploadId: text("bucket_upload_id").notNull(),
  partSizeBytes: integer("part_size_bytes").notNull(),
  expiresAt: timestamp("expires_at", timestampConfig).notNull(),
  completedAt: timestamp("completed_at", timestampConfig),
});
export type FileUpload = typeof fileUploads.$inferSelect;
