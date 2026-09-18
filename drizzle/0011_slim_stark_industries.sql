CREATE TYPE "public"."wishlist_visibility" AS ENUM('private', 'public');--> statement-breakpoint
CREATE TABLE "wishlist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"wishlist_id" integer NOT NULL,
	"product_id" varchar(191) NOT NULL,
	"note" varchar(280),
	"quantity" integer DEFAULT 1 NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_by" integer,
	"bought_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wishlists" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" varchar(120) NOT NULL,
	"visibility" "wishlist_visibility" DEFAULT 'private' NOT NULL,
	"owner_name" varchar(120),
	"share_token" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_preferences" ADD COLUMN "wishlist_phone" varchar(24);--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_wishlist_id_wishlists_id_fk" FOREIGN KEY ("wishlist_id") REFERENCES "public"."wishlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_claimed_by_users_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wishlist_items_list_product_unique" ON "wishlist_items" USING btree ("wishlist_id","product_id");--> statement-breakpoint
CREATE INDEX "wishlist_items_list_id_idx" ON "wishlist_items" USING btree ("wishlist_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wishlists_share_token_unique" ON "wishlists" USING btree ("share_token");--> statement-breakpoint
CREATE INDEX "wishlists_user_id_idx" ON "wishlists" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_preferences_wishlist_phone_unique" ON "customer_preferences" USING btree ("wishlist_phone") WHERE "customer_preferences"."wishlist_phone" is not null;