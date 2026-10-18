CREATE TYPE "public"."fulfilment_status" AS ENUM('pending', 'preparing', 'shipped', 'delivered', 'cancelled', 'returned');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending_payment', 'paid', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"vendor_id" integer,
	"product_id" integer,
	"variant_id" integer,
	"vendor_name" varchar(160),
	"product_title" varchar(255) NOT NULL,
	"variant_title" varchar(255),
	"sku" varchar(120),
	"unit_price" numeric(12, 3) NOT NULL,
	"quantity" integer NOT NULL,
	"line_total" numeric(12, 3) NOT NULL,
	"commission_percent" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"commission_fixed" numeric(12, 3) DEFAULT '0.000' NOT NULL,
	"commission_amount" numeric(12, 3) DEFAULT '0.000' NOT NULL,
	"vendor_net" numeric(12, 3) DEFAULT '0.000' NOT NULL,
	"fulfilment" "fulfilment_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" varchar(24) NOT NULL,
	"user_id" integer,
	"email" varchar(320) NOT NULL,
	"status" "order_status" DEFAULT 'pending_payment' NOT NULL,
	"currency" varchar(3) DEFAULT 'KWD' NOT NULL,
	"items_total" numeric(12, 3) NOT NULL,
	"delivery_total" numeric(12, 3) DEFAULT '0.000' NOT NULL,
	"grand_total" numeric(12, 3) NOT NULL,
	"commission_total" numeric(12, 3) DEFAULT '0.000' NOT NULL,
	"contact_name" varchar(160),
	"contact_phone" varchar(32),
	"delivery_zone_id" varchar(32),
	"address_line" text,
	"address_notes" text,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_vendor_id_idx" ON "order_items" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "order_items_fulfilment_idx" ON "order_items" USING btree ("fulfilment");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_reference_unique" ON "orders" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "orders_user_id_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_placed_idx" ON "orders" USING btree ("placed_at");