ALTER TABLE "audit_log" ADD COLUMN "authorised_by_id" integer;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "authorised_by_email" varchar(320);--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_authorised_by_id_users_id_fk" FOREIGN KEY ("authorised_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;