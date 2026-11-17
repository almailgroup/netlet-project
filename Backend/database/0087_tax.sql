CREATE TABLE "order_item_taxes" (
	"order_item_id" integer PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"rate" numeric(5, 2) NOT NULL,
	"amount" numeric(12, 3) NOT NULL,
	"included" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_tax" (
	"product_id" integer PRIMARY KEY NOT NULL,
	"rate" numeric(5, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_tax_rate_check" CHECK ("product_tax"."rate" >= 0 AND "product_tax"."rate" <= 100)
);
--> statement-breakpoint
ALTER TABLE "order_item_taxes" ADD CONSTRAINT "order_item_taxes_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_taxes" ADD CONSTRAINT "order_item_taxes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_tax" ADD CONSTRAINT "product_tax_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_item_taxes_order_idx" ON "order_item_taxes" USING btree ("order_id");