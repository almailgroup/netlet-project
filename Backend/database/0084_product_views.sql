CREATE TABLE "product_views" (
	"product_id" integer NOT NULL,
	"day" date NOT NULL,
	"channel" varchar(16) NOT NULL,
	"source" varchar(16) NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"visitors" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_views_product_id_day_channel_source_pk" PRIMARY KEY("product_id","day","channel","source")
);
--> statement-breakpoint
ALTER TABLE "product_views" ADD CONSTRAINT "product_views_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_views_day_idx" ON "product_views" USING btree ("day");