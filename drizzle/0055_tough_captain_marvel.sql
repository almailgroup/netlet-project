CREATE TYPE "public"."payout_run_status" AS ENUM('prepared', 'sent', 'cancelled');--> statement-breakpoint
CREATE TABLE "payout_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payout_runs" ALTER COLUMN "bank_reference" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_runs" ALTER COLUMN "paid_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "payout_runs" ALTER COLUMN "paid_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_runs" ADD COLUMN "status" "payout_run_status" DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_runs" ADD COLUMN "file_id" integer;--> statement-breakpoint
ALTER TABLE "payout_runs" ADD COLUMN "prepared_by" integer;--> statement-breakpoint
ALTER TABLE "payout_runs" ADD COLUMN "prepared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payout_files" ADD CONSTRAINT "payout_files_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_runs" ADD CONSTRAINT "payout_runs_file_id_payout_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."payout_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_runs" ADD CONSTRAINT "payout_runs_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payout_runs_status_idx" ON "payout_runs" USING btree ("status","file_id");