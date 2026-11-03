CREATE TABLE "frequent_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"variant_id" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "frequent_items_quantity_range" CHECK ("frequent_items"."quantity" between 1 and 99)
);
--> statement-breakpoint
ALTER TABLE "frequent_items" ADD CONSTRAINT "frequent_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frequent_items" ADD CONSTRAINT "frequent_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frequent_items" ADD CONSTRAINT "frequent_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "frequent_items_user_product_variant_unique" ON "frequent_items" USING btree ("user_id","product_id","variant_id");--> statement-breakpoint
CREATE INDEX "frequent_items_user_idx" ON "frequent_items" USING btree ("user_id");