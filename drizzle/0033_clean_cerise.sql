DROP INDEX "product_variants_sku_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_product_sku_unique" ON "product_variants" USING btree ("product_id","sku");