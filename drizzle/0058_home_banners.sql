ALTER TYPE "public"."ad_slot" ADD VALUE 'home_banner';--> statement-breakpoint
ALTER TABLE "ad_bookings" ADD COLUMN "banner_media_id" varchar(64);--> statement-breakpoint
ALTER TABLE "ad_bookings" ADD COLUMN "banner_headline" varchar(80);--> statement-breakpoint
ALTER TABLE "ad_bookings" ADD COLUMN "banner_headline_ar" varchar(80);--> statement-breakpoint
ALTER TABLE "ad_bookings" ADD COLUMN "banner_status" varchar(12);--> statement-breakpoint
ALTER TABLE "ad_bookings" ADD COLUMN "banner_note" varchar(400);--> statement-breakpoint
ALTER TABLE "ad_bookings" ADD COLUMN "banner_reviewed_by" integer;--> statement-breakpoint
ALTER TABLE "ad_bookings" ADD COLUMN "banner_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_bookings" ADD CONSTRAINT "ad_bookings_banner_media_id_media_files_id_fk" FOREIGN KEY ("banner_media_id") REFERENCES "public"."media_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_bookings" ADD CONSTRAINT "ad_bookings_banner_reviewed_by_users_id_fk" FOREIGN KEY ("banner_reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;