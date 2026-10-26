DROP INDEX "return_requests_open_unique";--> statement-breakpoint
ALTER TABLE "return_requests" ADD COLUMN "ai_summary" varchar(600);--> statement-breakpoint
ALTER TABLE "return_requests" ADD COLUMN "ai_suggestion" varchar(12);--> statement-breakpoint
ALTER TABLE "return_requests" ADD COLUMN "vendor_response" varchar(400);--> statement-breakpoint
ALTER TABLE "return_requests" ADD COLUMN "vendor_responded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "return_requests" ADD COLUMN "confirmed_by" integer;--> statement-breakpoint
ALTER TABLE "return_requests" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "return_requests_open_unique" ON "return_requests" USING btree ("order_item_id") WHERE "return_requests"."status" in ('requested', 'review', 'approved', 'collected');