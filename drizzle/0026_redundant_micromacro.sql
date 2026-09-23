CREATE TABLE "point_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"points" integer NOT NULL,
	"reason" varchar(32) NOT NULL,
	"order_id" integer,
	"referral_id" integer,
	"note" varchar(200),
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" serial PRIMARY KEY NOT NULL,
	"referrer_id" integer NOT NULL,
	"referred_id" integer NOT NULL,
	"qualified_order_id" integer,
	"qualified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "points_spent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "points_value" numeric(12, 3) DEFAULT '0.000' NOT NULL;--> statement-breakpoint
ALTER TABLE "point_entries" ADD CONSTRAINT "point_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_entries" ADD CONSTRAINT "point_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_entries" ADD CONSTRAINT "point_entries_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_id_users_id_fk" FOREIGN KEY ("referred_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_qualified_order_id_orders_id_fk" FOREIGN KEY ("qualified_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "point_entries_user_idx" ON "point_entries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "point_entries_referral_reason_unique" ON "point_entries" USING btree ("referral_id","reason") WHERE "point_entries"."referral_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_referred_unique" ON "referrals" USING btree ("referred_id");--> statement-breakpoint
CREATE INDEX "referrals_referrer_idx" ON "referrals" USING btree ("referrer_id","created_at");