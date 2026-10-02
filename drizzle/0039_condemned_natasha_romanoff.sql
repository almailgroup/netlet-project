CREATE TABLE "return_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"order_item_id" integer NOT NULL,
	"user_id" integer,
	"vendor_id" integer,
	"kind" varchar(10) NOT NULL,
	"reason" varchar(20) NOT NULL,
	"note" text,
	"status" varchar(12) DEFAULT 'requested' NOT NULL,
	"decided_by" varchar(10),
	"decided_at" timestamp with time zone,
	"decline_reason" varchar(400),
	"collected_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"restocked" boolean DEFAULT false NOT NULL,
	"refund_amount" numeric(12, 3),
	"refund_paid_at" timestamp with time zone,
	"replacement_order_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_replacement_order_id_orders_id_fk" FOREIGN KEY ("replacement_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "return_requests_open_unique" ON "return_requests" USING btree ("order_item_id") WHERE "return_requests"."status" in ('requested', 'approved', 'collected');--> statement-breakpoint
CREATE INDEX "return_requests_vendor_idx" ON "return_requests" USING btree ("vendor_id","status");--> statement-breakpoint
CREATE INDEX "return_requests_user_idx" ON "return_requests" USING btree ("user_id");