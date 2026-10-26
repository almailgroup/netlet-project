ALTER TABLE "order_items" ADD COLUMN "affiliate_vendor_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "affiliate_percent" numeric(5, 2);--> statement-breakpoint
CREATE INDEX "products_affiliate_idx" ON "products" USING btree ("affiliate_percent") WHERE "products"."affiliate_percent" is not null;