ALTER TABLE "files" ADD COLUMN "thumbnail_storage_key" text;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_thumbnail_storage_key_key" UNIQUE("thumbnail_storage_key");