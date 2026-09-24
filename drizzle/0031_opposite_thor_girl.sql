CREATE TABLE "customer_addresses" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"label" varchar(40) NOT NULL,
	"contact_name" varchar(160),
	"contact_phone" varchar(40),
	"governorate" varchar(32),
	"address_line" varchar(300) NOT NULL,
	"address_notes" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "address_id" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "destination" jsonb;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_addresses_user_idx" ON "customer_addresses" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_address_id_customer_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."customer_addresses"("id") ON DELETE set null ON UPDATE no action;