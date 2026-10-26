ALTER TABLE "cart_items" ADD COLUMN "delivery_choice" varchar(8) DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "delivery_choice" varchar(8) DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "fast_delivery_fee" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "fast_delivery_speed" varchar(20);--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "delivery_mode" varchar(10) DEFAULT 'netlet' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "delivery_courier_id" integer;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_delivery_courier_id_couriers_id_fk" FOREIGN KEY ("delivery_courier_id") REFERENCES "public"."couriers"("id") ON DELETE set null ON UPDATE no action;