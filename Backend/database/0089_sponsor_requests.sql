CREATE TABLE "sponsor_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"product_id" integer,
	"product_title" varchar(255) NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"daily_rate" numeric(12, 3) NOT NULL,
	"total" numeric(12, 3) NOT NULL,
	"status" varchar(12) DEFAULT 'review' NOT NULL,
	"note" varchar(400),
	"reply" varchar(400),
	"pay_by" date,
	"paid_with" varchar(12),
	"payment_reference" varchar(80),
	"booking_id" integer,
	"requested_by" integer,
	"reviewed_by" integer,
	"confirmed_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	CONSTRAINT "sponsor_requests_status_check" CHECK ("sponsor_requests"."status" in ('review', 'payment', 'sent', 'paid', 'declined', 'withdrawn')),
	CONSTRAINT "sponsor_requests_paid_with_check" CHECK ("sponsor_requests"."paid_with" is null or "sponsor_requests"."paid_with" in ('earnings', 'transfer'))
);
--> statement-breakpoint
ALTER TABLE "sponsor_requests" ADD CONSTRAINT "sponsor_requests_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_requests" ADD CONSTRAINT "sponsor_requests_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_requests" ADD CONSTRAINT "sponsor_requests_booking_id_ad_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."ad_bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_requests" ADD CONSTRAINT "sponsor_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_requests" ADD CONSTRAINT "sponsor_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_requests" ADD CONSTRAINT "sponsor_requests_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sponsor_requests_vendor_idx" ON "sponsor_requests" USING btree ("vendor_id","id");--> statement-breakpoint
CREATE INDEX "sponsor_requests_open_idx" ON "sponsor_requests" USING btree ("status","starts_on","ends_on");--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_requests_booking_idx" ON "sponsor_requests" USING btree ("booking_id") WHERE "sponsor_requests"."booking_id" is not null;