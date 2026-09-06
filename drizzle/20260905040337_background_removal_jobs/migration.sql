CREATE TYPE "background_removal_attempt_status" AS ENUM('queued', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "background_removal_failure_code" AS ENUM('invalid_image', 'unsupported_image', 'image_too_large', 'decode_failed', 'inference_failed', 'storage_failed', 'worker_lost');--> statement-breakpoint
CREATE TABLE "background_removal_attempts" (
	"id" uuid PRIMARY KEY,
	"background_removal_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"status" "background_removal_attempt_status" DEFAULT 'queued'::"background_removal_attempt_status" NOT NULL,
	"next_eligible_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"output_file_id" uuid,
	"failure_code" "background_removal_failure_code",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "unique_background_removal_attempts_series_sequence" UNIQUE("background_removal_id","series_id","sequence"),
	CONSTRAINT "background_removal_attempts_sequence_positive" CHECK ("sequence" > 0),
	CONSTRAINT "background_removal_attempts_state_consistent" CHECK ((
        ("status" = 'queued'
          AND "lease_token" IS NULL
          AND "lease_expires_at" IS NULL
          AND "output_file_id" IS NULL
          AND "failure_code" IS NULL
          AND "started_at" IS NULL
          AND "completed_at" IS NULL)
        OR
        ("status" = 'processing'
          AND "lease_token" IS NOT NULL
          AND "lease_expires_at" IS NOT NULL
          AND "output_file_id" IS NULL
          AND "failure_code" IS NULL
          AND "started_at" IS NOT NULL
          AND "completed_at" IS NULL)
        OR
        ("status" = 'ready'
          AND "lease_token" IS NOT NULL
          AND "lease_expires_at" IS NOT NULL
          AND "output_file_id" IS NOT NULL
          AND "failure_code" IS NULL
          AND "started_at" IS NOT NULL
          AND "completed_at" IS NOT NULL)
        OR
        ("status" = 'failed'
          AND "lease_token" IS NOT NULL
          AND "lease_expires_at" IS NOT NULL
          AND "output_file_id" IS NULL
          AND "failure_code" IS NOT NULL
          AND "started_at" IS NOT NULL
          AND "completed_at" IS NOT NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "background_removals" DROP CONSTRAINT "background_removals_input_file_id_files_id_fkey";--> statement-breakpoint
ALTER TABLE "background_removals" DROP CONSTRAINT "background_removals_output_file_id_files_id_fkey";--> statement-breakpoint
ALTER TABLE "background_removals" ADD COLUMN "model_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "background_removals" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "background_removals" DROP COLUMN "output_file_id";--> statement-breakpoint
ALTER TABLE "background_removals" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "unique_files_organization_id_id" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "background_removals" ADD CONSTRAINT "unique_background_removals_organization_id_id" UNIQUE("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_background_removal_attempts_active_request" ON "background_removal_attempts" ("background_removal_id") WHERE "status" in ('queued', 'processing');--> statement-breakpoint
CREATE INDEX "idx_background_removal_attempts_claim" ON "background_removal_attempts" ("status","next_eligible_at","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_background_removal_attempts_latest" ON "background_removal_attempts" ("background_removal_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_background_removals_organization_created" ON "background_removals" ("organization_id","created_at","id");--> statement-breakpoint
ALTER TABLE "background_removal_attempts" ADD CONSTRAINT "background_removal_attempts_organization_id_removal_id_fkey" FOREIGN KEY ("organization_id","background_removal_id") REFERENCES "background_removals"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "background_removal_attempts" ADD CONSTRAINT "background_removal_attempts_organization_id_output_file_id_files_fkey" FOREIGN KEY ("organization_id","output_file_id") REFERENCES "files"("organization_id","id");--> statement-breakpoint
ALTER TABLE "background_removals" ADD CONSTRAINT "background_removals_organization_id_input_file_id_files_fkey" FOREIGN KEY ("organization_id","input_file_id") REFERENCES "files"("organization_id","id");--> statement-breakpoint
ALTER TABLE "background_removals" DROP CONSTRAINT "background_removals_organization_id_organizations_id_fkey", ADD CONSTRAINT "background_removals_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
DROP TYPE "background_removal_status";