CREATE TABLE "price_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"variant_id" integer NOT NULL,
	"product_id" integer,
	"vendor_id" integer,
	"product_title" varchar(255) NOT NULL,
	"list_price" numeric(12, 3) NOT NULL,
	"asked_price" numeric(12, 3) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"shopper_note" text,
	"vendor_note" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"offered_price" numeric(12, 3),
	"expires_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"answered_by" integer,
	"used_on_order_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "accepts_offers" boolean;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "accepts_offers" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "price_offers" ADD CONSTRAINT "price_offers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_offers" ADD CONSTRAINT "price_offers_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_offers" ADD CONSTRAINT "price_offers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_offers" ADD CONSTRAINT "price_offers_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_offers" ADD CONSTRAINT "price_offers_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_offers" ADD CONSTRAINT "price_offers_used_on_order_id_orders_id_fk" FOREIGN KEY ("used_on_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "price_offers_open_unique" ON "price_offers" USING btree ("user_id","variant_id") WHERE "price_offers"."status" in ('pending', 'offered') and "price_offers"."used_on_order_id" is null;--> statement-breakpoint
CREATE INDEX "price_offers_vendor_idx" ON "price_offers" USING btree ("vendor_id","status","created_at");--> statement-breakpoint
CREATE INDEX "price_offers_user_idx" ON "price_offers" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "price_offers_variant_idx" ON "price_offers" USING btree ("variant_id");