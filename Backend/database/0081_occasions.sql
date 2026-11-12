CREATE TABLE "occasion_products" (
	"occasion_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "occasion_products_occasion_id_product_id_pk" PRIMARY KEY("occasion_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "occasions" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(40) NOT NULL,
	"title" varchar(80) NOT NULL,
	"title_ar" varchar(80) NOT NULL,
	"image_url" varchar(200),
	"starts_on" date,
	"ends_on" date,
	"include_tagged" boolean DEFAULT true NOT NULL,
	"status" varchar(12) DEFAULT 'draft' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "occasion_products" ADD CONSTRAINT "occasion_products_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occasion_products" ADD CONSTRAINT "occasion_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occasions" ADD CONSTRAINT "occasions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "occasion_products_product_idx" ON "occasion_products" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "occasions_slug_unique" ON "occasions" USING btree ("slug");