CREATE TABLE "cart_item_addons" (
	"id" serial PRIMARY KEY NOT NULL,
	"cart_item_id" integer NOT NULL,
	"addon_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_item_addons" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_item_id" integer NOT NULL,
	"addon_id" integer,
	"kind" varchar(20) NOT NULL,
	"label" varchar(160) NOT NULL,
	"price" numeric(12, 3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_addons" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"kind" varchar(20) DEFAULT 'other' NOT NULL,
	"label" varchar(160) NOT NULL,
	"label_ar" varchar(160),
	"price" numeric(12, 3) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cart_item_addons" ADD CONSTRAINT "cart_item_addons_cart_item_id_cart_items_id_fk" FOREIGN KEY ("cart_item_id") REFERENCES "public"."cart_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_item_addons" ADD CONSTRAINT "cart_item_addons_addon_id_product_addons_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."product_addons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_addons" ADD CONSTRAINT "order_item_addons_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_addons" ADD CONSTRAINT "order_item_addons_addon_id_product_addons_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."product_addons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_addons" ADD CONSTRAINT "product_addons_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_item_addons_unique" ON "cart_item_addons" USING btree ("cart_item_id","addon_id");--> statement-breakpoint
CREATE INDEX "order_item_addons_line_idx" ON "order_item_addons" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "product_addons_product_idx" ON "product_addons" USING btree ("product_id","position");