CREATE TABLE "feature_switches" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feature_switches" ADD CONSTRAINT "feature_switches_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;