CREATE TABLE "affiliates" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"channel" varchar(300),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"rate_percent" numeric(5, 2) DEFAULT '3.00' NOT NULL,
	"disclosure_accepted_at" timestamp with time zone NOT NULL,
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "affiliate_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "affiliate_rate" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "point_entries" ADD COLUMN "pot" varchar(16) DEFAULT 'points' NOT NULL;--> statement-breakpoint
ALTER TABLE "point_entries" ADD COLUMN "order_item_id" integer;--> statement-breakpoint
ALTER TABLE "affiliates" ADD CONSTRAINT "affiliates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliates" ADD CONSTRAINT "affiliates_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "affiliates_user_unique" ON "affiliates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "affiliates_status_idx" ON "affiliates" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_affiliate_id_affiliates_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "public"."affiliates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_entries" ADD CONSTRAINT "point_entries_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "point_entries_affiliate_order_unique" ON "point_entries" USING btree ("order_id") WHERE "point_entries"."reason" = 'affiliate_commission';--> statement-breakpoint
CREATE UNIQUE INDEX "point_entries_affiliate_line_unique" ON "point_entries" USING btree ("order_item_id") WHERE "point_entries"."reason" = 'affiliate_reversal';--> statement-breakpoint
CREATE INDEX "point_entries_pot_idx" ON "point_entries" USING btree ("user_id","pot");