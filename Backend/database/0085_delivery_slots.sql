CREATE TABLE "cart_delivery_slots" (
	"cart_id" varchar(64) NOT NULL,
	"vendor_id" integer NOT NULL,
	"delivery_date" date NOT NULL,
	"time_window" varchar(16) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_delivery_slots_cart_id_vendor_id_pk" PRIMARY KEY("cart_id","vendor_id"),
	CONSTRAINT "cart_delivery_slots_window_check" CHECK ("cart_delivery_slots"."time_window" in ('morning', 'afternoon', 'evening'))
);
--> statement-breakpoint
CREATE TABLE "order_delivery_slots" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"vendor_id" integer,
	"delivery_date" date NOT NULL,
	"time_window" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_delivery_slots_window_check" CHECK ("order_delivery_slots"."time_window" in ('morning', 'afternoon', 'evening'))
);
--> statement-breakpoint
ALTER TABLE "cart_delivery_slots" ADD CONSTRAINT "cart_delivery_slots_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_delivery_slots" ADD CONSTRAINT "cart_delivery_slots_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_delivery_slots" ADD CONSTRAINT "order_delivery_slots_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_delivery_slots" ADD CONSTRAINT "order_delivery_slots_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_delivery_slots_order_vendor_key" ON "order_delivery_slots" USING btree ("order_id","vendor_id");