CREATE TYPE "media_batch_state" AS ENUM('draft', 'queued', 'cancelled');--> statement-breakpoint
CREATE TYPE "media_item_state" AS ENUM('draft', 'queued', 'running', 'ready', 'failed', 'needs_selection', 'cancelled');--> statement-breakpoint
CREATE TYPE "media_task_kind" AS ENUM('discover', 'inspect', 'download');--> statement-breakpoint
CREATE TYPE "media_task_state" AS ENUM('queued', 'running', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "media_batches" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"urls" jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"state" "media_batch_state" DEFAULT 'draft'::"media_batch_state" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "media_batches_organization_id_request_id_unique" UNIQUE("organization_id","request_id"),
	CONSTRAINT "media_batches_organization_id_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "media_items" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"entry_key" text NOT NULL,
	"position" integer NOT NULL,
	"url" text,
	"title" text NOT NULL,
	"state" "media_item_state" DEFAULT 'draft'::"media_item_state" NOT NULL,
	"selection" jsonb,
	"metadata" jsonb,
	"inspected_at" timestamp with time zone,
	"output_file_id" uuid,
	"output_description" text,
	"output_size_bytes" bigint,
	"error" text,
	CONSTRAINT "media_items_source_id_entry_key_unique" UNIQUE("source_id","entry_key")
);
--> statement-breakpoint
CREATE TABLE "media_sources" (
	"id" uuid PRIMARY KEY,
	"batch_id" uuid NOT NULL,
	"url" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "media_sources_batch_id_position_unique" UNIQUE("batch_id","position"),
	CONSTRAINT "media_sources_batch_id_id_unique" UNIQUE("batch_id","id")
);
--> statement-breakpoint
CREATE TABLE "media_tasks" (
	"id" uuid PRIMARY KEY,
	"batch_id" uuid NOT NULL,
	"source_id" uuid,
	"item_id" uuid,
	"kind" "media_task_kind" NOT NULL,
	"state" "media_task_state" DEFAULT 'queued'::"media_task_state" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"progress" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_tasks_kind_source_id_unique" UNIQUE("kind","source_id"),
	CONSTRAINT "media_tasks_kind_item_id_unique" UNIQUE("kind","item_id"),
	CONSTRAINT "media_task_target" CHECK (("kind" = 'discover' AND "source_id" IS NOT NULL AND "item_id" IS NULL) OR ("kind" <> 'discover' AND "item_id" IS NOT NULL AND "source_id" IS NULL)),
	CONSTRAINT "media_task_lease" CHECK ("state" <> 'running' OR ("lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "expected_size_bytes" SET DATA TYPE bigint USING "expected_size_bytes"::bigint;--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "size_bytes" SET DATA TYPE bigint USING "size_bytes"::bigint;--> statement-breakpoint
CREATE INDEX "media_batches_organization_id_created_at_index" ON "media_batches" ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "media_items_batch_id_source_id_position_index" ON "media_items" ("batch_id","source_id","position");--> statement-breakpoint
CREATE INDEX "media_tasks_kind_state_available_at_index" ON "media_tasks" ("kind","state","available_at");--> statement-breakpoint
ALTER TABLE "media_batches" ADD CONSTRAINT "media_batches_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_items" ADD CONSTRAINT "media_items_AdLxYmn2Tm0s_fkey" FOREIGN KEY ("organization_id","batch_id") REFERENCES "media_batches"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_items" ADD CONSTRAINT "media_items_batch_id_source_id_media_sources_batch_id_id_fkey" FOREIGN KEY ("batch_id","source_id") REFERENCES "media_sources"("batch_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_items" ADD CONSTRAINT "media_items_tosUsbha2g6I_fkey" FOREIGN KEY ("organization_id","output_file_id") REFERENCES "files"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_sources" ADD CONSTRAINT "media_sources_batch_id_media_batches_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "media_batches"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_tasks" ADD CONSTRAINT "media_tasks_batch_id_media_batches_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "media_batches"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_tasks" ADD CONSTRAINT "media_tasks_source_id_media_sources_id_fkey" FOREIGN KEY ("source_id") REFERENCES "media_sources"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_tasks" ADD CONSTRAINT "media_tasks_item_id_media_items_id_fkey" FOREIGN KEY ("item_id") REFERENCES "media_items"("id") ON DELETE CASCADE;