CREATE TABLE "auth_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"bucket" varchar(340) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_attempts_bucket_idx" ON "auth_attempts" USING btree ("bucket","kind","created_at");--> statement-breakpoint
CREATE INDEX "auth_attempts_created_idx" ON "auth_attempts" USING btree ("created_at");