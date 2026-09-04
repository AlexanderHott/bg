CREATE TYPE "background_removal_status" AS ENUM('queued', 'processing', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "background_removals" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"input_file_id" uuid NOT NULL,
	"output_file_id" uuid,
	"status" "background_removal_status" DEFAULT 'queued'::"background_removal_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_background_removals_organization_id_request_id" UNIQUE("organization_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "background_removals" ADD CONSTRAINT "background_removals_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");--> statement-breakpoint
ALTER TABLE "background_removals" ADD CONSTRAINT "background_removals_input_file_id_files_id_fkey" FOREIGN KEY ("input_file_id") REFERENCES "files"("id");--> statement-breakpoint
ALTER TABLE "background_removals" ADD CONSTRAINT "background_removals_output_file_id_files_id_fkey" FOREIGN KEY ("output_file_id") REFERENCES "files"("id");