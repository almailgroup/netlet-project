ALTER TABLE "audit_log" ADD COLUMN "actor_role" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "audit_seen_at" timestamp with time zone;