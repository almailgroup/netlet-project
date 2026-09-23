CREATE TABLE "discount_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(40) NOT NULL,
	"kind" varchar(10) DEFAULT 'percent' NOT NULL,
	"value" numeric(12, 3) NOT NULL,
	"min_spend" numeric(12, 3),
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"max_redemptions" integer,
	"per_shopper" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discount_redemptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code_id" integer NOT NULL,
	"user_id" integer,
	"order_id" integer,
	"amount" numeric(12, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_card_uses" (
	"id" serial PRIMARY KEY NOT NULL,
	"gift_card_id" integer NOT NULL,
	"order_id" integer,
	"amount" numeric(12, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(40) NOT NULL,
	"initial_balance" numeric(12, 3) NOT NULL,
	"remaining" numeric(12, 3) NOT NULL,
	"expires_at" timestamp with time zone,
	"note" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_code" varchar(40);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_value" numeric(12, 3) DEFAULT '0.000' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gift_card_code" varchar(40);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gift_card_value" numeric(12, 3) DEFAULT '0.000' NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_code_id_discount_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."discount_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_uses" ADD CONSTRAINT "gift_card_uses_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_uses" ADD CONSTRAINT "gift_card_uses_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discount_codes_code_unique" ON "discount_codes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_redemptions_order_unique" ON "discount_redemptions" USING btree ("code_id","order_id");--> statement-breakpoint
CREATE INDEX "discount_redemptions_user_idx" ON "discount_redemptions" USING btree ("code_id","user_id");--> statement-breakpoint
CREATE INDEX "gift_card_uses_card_idx" ON "gift_card_uses" USING btree ("gift_card_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_cards_code_unique" ON "gift_cards" USING btree ("code");