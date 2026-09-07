CREATE TABLE "organization_invites" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"secret_hash" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "organization_invites_terminal_state" CHECK ("accepted_at" IS NULL OR "revoked_at" IS NULL),
	CONSTRAINT "organization_invites_acceptance" CHECK ("accepted_by_user_id" IS NULL OR "accepted_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX "idx_organization_invites_organization_created" ON "organization_invites" ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_created_by_user_id_users_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_accepted_by_user_id_users_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;