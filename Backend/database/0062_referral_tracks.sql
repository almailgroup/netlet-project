CREATE TABLE "platform_settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" varchar(200) NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "referrer_id" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "referral_rate" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "point_entries" ADD COLUMN "available_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "point_entries_product_referral_unique" ON "point_entries" USING btree ("order_item_id") WHERE "point_entries"."reason" = 'product_referral';--> statement-breakpoint
CREATE UNIQUE INDEX "point_entries_invite_commission_unique" ON "point_entries" USING btree ("order_item_id") WHERE "point_entries"."reason" = 'invite_commission';--> statement-breakpoint
CREATE UNIQUE INDEX "point_entries_referral_reversal_unique" ON "point_entries" USING btree ("order_item_id","reason") WHERE "point_entries"."reason" in ('product_referral_reversal', 'invite_commission_reversal');