CREATE TYPE "file_state" AS ENUM('pending', 'ready');--> statement-breakpoint
CREATE TABLE "file_uploads" (
	"file_id" uuid PRIMARY KEY,
	"bucket_upload_id" text NOT NULL,
	"part_size_bytes" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"state" "file_state" NOT NULL,
	"name" text NOT NULL,
	"media_type" text NOT NULL,
	"expected_size_bytes" integer NOT NULL,
	"size_bytes" integer,
	"storage_key" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	CONSTRAINT "unique_files_organization_id_request_id" UNIQUE("organization_id","request_id"),
	CONSTRAINT "files_expected_size_positive" CHECK ("expected_size_bytes" > 0),
	CONSTRAINT "files_state_metadata_consistent" CHECK ((
        ("state" = 'pending' AND "size_bytes" IS NULL AND "ready_at" IS NULL)
        OR
        ("state" = 'ready' AND "size_bytes" = "expected_size_bytes" AND "ready_at" IS NOT NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_file_id_files_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;