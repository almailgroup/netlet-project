CREATE TABLE "followed_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"product_id" varchar(191) NOT NULL,
	"price_drop" boolean DEFAULT true NOT NULL,
	"back_in_stock" boolean DEFAULT true NOT NULL,
	"last_notified_price" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "followed_products" ADD CONSTRAINT "followed_products_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "followed_products_user_product_unique" ON "followed_products" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE INDEX "followed_products_user_id_idx" ON "followed_products" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "followed_products_product_id_idx" ON "followed_products" USING btree ("product_id");