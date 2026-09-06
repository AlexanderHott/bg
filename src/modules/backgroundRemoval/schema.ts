import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  type PgTimestampConfig,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import * as fileSchema from "@/modules/files/schema.ts";
import * as organizationSchema from "@/modules/organizations/schema.ts";

const timestampConfig = { withTimezone: true } as const satisfies PgTimestampConfig;

export const backgroundRemovalAttemptStatus = pgEnum("background_removal_attempt_status", [
  "queued",
  "processing",
  "ready",
  "failed",
]);

export const backgroundRemovalFailureCode = pgEnum("background_removal_failure_code", [
  "invalid_image",
  "unsupported_image",
  "image_too_large",
  "decode_failed",
  "inference_failed",
  "storage_failed",
  "worker_lost",
]);

export const backgroundRemovals = pgTable(
  "background_removals",
  {
    id: uuid("id").notNull().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationSchema.organizations.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    inputFileId: uuid("input_file_id").notNull(),
    modelId: text("model_id").notNull(),
    createdAt: timestamp("created_at", timestampConfig).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", timestampConfig),
  },
  (table) => [
    unique("unique_background_removals_organization_id_request_id").on(
      table.organizationId,
      table.requestId,
    ),
    unique("unique_background_removals_organization_id_id").on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.inputFileId],
      foreignColumns: [fileSchema.files.organizationId, fileSchema.files.id],
      name: "background_removals_organization_id_input_file_id_files_fkey",
    }),
    index("idx_background_removals_organization_created").on(
      table.organizationId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const backgroundRemovalAttempts = pgTable(
  "background_removal_attempts",
  {
    id: uuid("id").notNull().primaryKey(),
    backgroundRemovalId: uuid("background_removal_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    seriesId: uuid("series_id").notNull(),
    sequence: integer("sequence").notNull(),
    status: backgroundRemovalAttemptStatus("status").notNull().default("queued"),
    nextEligibleAt: timestamp("next_eligible_at", timestampConfig).notNull().defaultNow(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", timestampConfig),
    outputFileId: uuid("output_file_id"),
    failureCode: backgroundRemovalFailureCode("failure_code"),
    createdAt: timestamp("created_at", timestampConfig).notNull().defaultNow(),
    startedAt: timestamp("started_at", timestampConfig),
    completedAt: timestamp("completed_at", timestampConfig),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.backgroundRemovalId],
      foreignColumns: [backgroundRemovals.organizationId, backgroundRemovals.id],
      name: "background_removal_attempts_organization_id_removal_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.outputFileId],
      foreignColumns: [fileSchema.files.organizationId, fileSchema.files.id],
      name: "background_removal_attempts_organization_id_output_file_id_files_fkey",
    }),
    unique("unique_background_removal_attempts_series_sequence").on(
      table.backgroundRemovalId,
      table.seriesId,
      table.sequence,
    ),
    uniqueIndex("unique_background_removal_attempts_active_request")
      .on(table.backgroundRemovalId)
      .where(sql`${table.status} in ('queued', 'processing')`),
    index("idx_background_removal_attempts_claim").on(
      table.status,
      table.nextEligibleAt,
      table.createdAt,
      table.id,
    ),
    index("idx_background_removal_attempts_latest").on(
      table.backgroundRemovalId,
      table.createdAt,
      table.id,
    ),
    check("background_removal_attempts_sequence_positive", sql`${table.sequence} > 0`),
    check(
      "background_removal_attempts_state_consistent",
      sql`(
        (${table.status} = 'queued'
          AND ${table.leaseToken} IS NULL
          AND ${table.leaseExpiresAt} IS NULL
          AND ${table.outputFileId} IS NULL
          AND ${table.failureCode} IS NULL
          AND ${table.startedAt} IS NULL
          AND ${table.completedAt} IS NULL)
        OR
        (${table.status} = 'processing'
          AND ${table.leaseToken} IS NOT NULL
          AND ${table.leaseExpiresAt} IS NOT NULL
          AND ${table.outputFileId} IS NULL
          AND ${table.failureCode} IS NULL
          AND ${table.startedAt} IS NOT NULL
          AND ${table.completedAt} IS NULL)
        OR
        (${table.status} = 'ready'
          AND ${table.leaseToken} IS NOT NULL
          AND ${table.leaseExpiresAt} IS NOT NULL
          AND ${table.outputFileId} IS NOT NULL
          AND ${table.failureCode} IS NULL
          AND ${table.startedAt} IS NOT NULL
          AND ${table.completedAt} IS NOT NULL)
        OR
        (${table.status} = 'failed'
          AND ${table.leaseToken} IS NOT NULL
          AND ${table.leaseExpiresAt} IS NOT NULL
          AND ${table.outputFileId} IS NULL
          AND ${table.failureCode} IS NOT NULL
          AND ${table.startedAt} IS NOT NULL
          AND ${table.completedAt} IS NOT NULL)
      )`,
    ),
  ],
);

export type BackgroundRemoval = typeof backgroundRemovals.$inferSelect;
export type BackgroundRemovalAttempt = typeof backgroundRemovalAttempts.$inferSelect;
export type BackgroundRemovalFailureCode = (typeof backgroundRemovalFailureCode.enumValues)[number];
