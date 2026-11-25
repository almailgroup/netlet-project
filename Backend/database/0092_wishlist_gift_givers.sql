CREATE TABLE "wishlist_gift_givers" (
	"item_id" integer PRIMARY KEY NOT NULL,
	"giver_name" varchar(60),
	"order_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wishlist_gift_givers" ADD CONSTRAINT "wishlist_gift_givers_item_id_wishlist_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."wishlist_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_gift_givers" ADD CONSTRAINT "wishlist_gift_givers_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wishlist_gift_givers_order_idx" ON "wishlist_gift_givers" USING btree ("order_id");