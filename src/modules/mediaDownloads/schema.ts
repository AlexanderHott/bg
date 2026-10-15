import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { files } from "@/modules/files/schema";
import { organizations } from "@/modules/organizations/schema";

import type { DownloadSettings, FormatSelection, MediaMetadata, MediaProgress } from "./policy";

const timestamps = { withTimezone: true } as const;
export const mediaBatchState = pgEnum("media_batch_state", ["draft", "queued", "cancelled"]);
export const mediaItemState = pgEnum("media_item_state", [
  "draft",
  "queued",
  "running",
  "ready",
  "failed",
  "needs_selection",
  "cancelled",
]);
export const mediaTaskKind = pgEnum("media_task_kind", ["discover", "inspect", "download"]);
export const mediaTaskState = pgEnum("media_task_state", [
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
]);

export const mediaBatches = pgTable(
  "media_batches",
  {
    id: uuid().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    urls: jsonb().$type<string[]>().notNull(),
    settings: jsonb().$type<DownloadSettings>().notNull(),
    state: mediaBatchState().notNull().default("draft"),
    createdAt: timestamp("created_at", timestamps).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", timestamps),
  },
  (t) => [
    unique().on(t.organizationId, t.requestId),
    unique().on(t.organizationId, t.id),
    index().on(t.organizationId, t.createdAt),
  ],
);

export const mediaSources = pgTable(
  "media_sources",
  {
    id: uuid().primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => mediaBatches.id, { onDelete: "cascade" }),
    url: text().notNull(),
    position: integer().notNull(),
  },
  (t) => [unique().on(t.batchId, t.position), unique().on(t.batchId, t.id)],
);

export const mediaItems = pgTable(
  "media_items",
  {
    id: uuid().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    sourceId: uuid("source_id").notNull(),
    entryKey: text("entry_key").notNull(),
    position: integer().notNull(),
    url: text(),
    title: text().notNull(),
    state: mediaItemState().notNull().default("draft"),
    selection: jsonb().$type<FormatSelection>(),
    metadata: jsonb().$type<MediaMetadata>(),
    inspectedAt: timestamp("inspected_at", timestamps),
    outputFileId: uuid("output_file_id"),
    outputDescription: text("output_description"),
    outputSizeBytes: bigint("output_size_bytes", { mode: "number" }),
    error: text(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.batchId],
      foreignColumns: [mediaBatches.organizationId, mediaBatches.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.batchId, t.sourceId],
      foreignColumns: [mediaSources.batchId, mediaSources.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.outputFileId],
      foreignColumns: [files.organizationId, files.id],
    }).onDelete("cascade"),
    unique().on(t.sourceId, t.entryKey),
    index().on(t.batchId, t.sourceId, t.position),
  ],
);

// These jobs belong to the downloader. Other tools keep their own worker models.
export const mediaTasks = pgTable(
  "media_tasks",
  {
    id: uuid().primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => mediaBatches.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => mediaSources.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").references(() => mediaItems.id, { onDelete: "cascade" }),
    kind: mediaTaskKind().notNull(),
    state: mediaTaskState().notNull().default("queued"),
    attempts: integer().notNull().default(0),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", timestamps),
    availableAt: timestamp("available_at", timestamps).notNull().defaultNow(),
    progress: jsonb().$type<MediaProgress>(),
    error: text(),
    createdAt: timestamp("created_at", timestamps).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.kind, t.sourceId),
    unique().on(t.kind, t.itemId),
    index().on(t.kind, t.state, t.availableAt),
    check(
      "media_task_target",
      sql`(${t.kind} = 'discover' AND ${t.sourceId} IS NOT NULL AND ${t.itemId} IS NULL) OR (${t.kind} <> 'discover' AND ${t.itemId} IS NOT NULL AND ${t.sourceId} IS NULL)`,
    ),
    check(
      "media_task_lease",
      sql`${t.state} <> 'running' OR (${t.leaseToken} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL)`,
    ),
  ],
);
