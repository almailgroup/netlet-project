CREATE TYPE "public"."warranty_status" AS ENUM('open', 'accepted', 'declined', 'completed', 'withdrawn');--> statement-breakpoint
CREATE TABLE "warranty_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"order_item_id" integer NOT NULL,
	"user_id" integer,
	"vendor_id" integer,
	"status" "warranty_status" DEFAULT 'open' NOT NULL,
	"problem" text NOT NULL,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remedy" varchar(10),
	"response" text,
	"return_request_id" integer,
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_return_request_id_return_requests_id_fk" FOREIGN KEY ("return_request_id") REFERENCES "public"."return_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "warranty_claims_open_unique" ON "warranty_claims" USING btree ("order_item_id") WHERE "warranty_claims"."status" in ('open', 'accepted');--> statement-breakpoint
CREATE INDEX "warranty_claims_vendor_idx" ON "warranty_claims" USING btree ("vendor_id","status");--> statement-breakpoint
CREATE INDEX "warranty_claims_user_idx" ON "warranty_claims" USING btree ("user_id");