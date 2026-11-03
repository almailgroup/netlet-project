CREATE TABLE "discount_code_products" (
	"code_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	CONSTRAINT "discount_code_products_code_id_product_id_pk" PRIMARY KEY("code_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "discount_code_id" integer;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD COLUMN "scope" varchar(10) DEFAULT 'order' NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD COLUMN "vendor_id" integer;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD COLUMN "funded_by" varchar(10) DEFAULT 'netlet' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "discount_code_id" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "discount_code" varchar(40);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "discount_amount" numeric(12, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_code_products" ADD CONSTRAINT "discount_code_products_code_id_discount_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."discount_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_code_products" ADD CONSTRAINT "discount_code_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_discount_code_id_discount_codes_id_fk" FOREIGN KEY ("discount_code_id") REFERENCES "public"."discount_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_discount_code_id_discount_codes_id_fk" FOREIGN KEY ("discount_code_id") REFERENCES "public"."discount_codes"("id") ON DELETE set null ON UPDATE no action;