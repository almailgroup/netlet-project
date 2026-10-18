CREATE TYPE "public"."ad_slot" AS ENUM('home', 'department');--> statement-breakpoint
CREATE TABLE "ad_bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"product_id" integer,
	"product_title" varchar(255) NOT NULL,
	"slot" "ad_slot" NOT NULL,
	"category_id" integer,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"daily_rate" numeric(12, 3) NOT NULL,
	"total" numeric(12, 3) NOT NULL,
	"cancelled_on" date,
	"cancelled_by" integer,
	"booked_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payout_run_items" ADD COLUMN "booking_id" integer;--> statement-breakpoint
ALTER TABLE "ad_bookings" ADD CONSTRAINT "ad_bookings_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_bookings" ADD CONSTRAINT "ad_bookings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_bookings" ADD CONSTRAINT "ad_bookings_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_bookings" ADD CONSTRAINT "ad_bookings_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_bookings" ADD CONSTRAINT "ad_bookings_booked_by_users_id_fk" FOREIGN KEY ("booked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_bookings_slot_idx" ON "ad_bookings" USING btree ("slot","starts_on","ends_on");--> statement-breakpoint
CREATE INDEX "ad_bookings_vendor_idx" ON "ad_bookings" USING btree ("vendor_id","id");--> statement-breakpoint
ALTER TABLE "payout_run_items" ADD CONSTRAINT "payout_run_items_booking_id_ad_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."ad_bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payout_run_items_run_booking_unique" ON "payout_run_items" USING btree ("run_id","booking_id");