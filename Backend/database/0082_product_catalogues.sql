CREATE TABLE "product_catalogues" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"title" varchar(120),
	"title_ar" varchar(120),
	"file_name" varchar(160) NOT NULL,
	"content_type" varchar(60) NOT NULL,
	"size_bytes" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'live' NOT NULL,
	"review_note" varchar(500),
	"uploaded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_catalogues" ADD CONSTRAINT "product_catalogues_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_catalogues" ADD CONSTRAINT "product_catalogues_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_catalogues_product_idx" ON "product_catalogues" USING btree ("product_id","position","id");