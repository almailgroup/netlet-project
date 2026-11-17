CREATE TABLE "order_handovers" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"parcel_key" varchar(200) NOT NULL,
	"scanned_by" integer,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_online" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"provider" varchar(16) NOT NULL,
	"method" varchar(16) NOT NULL,
	"amount" numeric(12, 3) NOT NULL,
	"status" varchar(16) DEFAULT 'started' NOT NULL,
	"provider_ref" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "order_payments_provider_check" CHECK ("order_payments"."provider" in ('test', 'myfatoorah', 'tap')),
	CONSTRAINT "order_payments_method_check" CHECK ("order_payments"."method" in ('knet', 'card', 'apple_pay')),
	CONSTRAINT "order_payments_status_check" CHECK ("order_payments"."status" in ('started', 'paid', 'failed', 'refunded'))
);
--> statement-breakpoint
ALTER TABLE "order_handovers" ADD CONSTRAINT "order_handovers_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_handovers" ADD CONSTRAINT "order_handovers_scanned_by_users_id_fk" FOREIGN KEY ("scanned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_handovers_order_idx" ON "order_handovers" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_payments_order_idx" ON "order_payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_payments_one_paid_key" ON "order_payments" USING btree ("order_id") WHERE "order_payments"."status" = 'paid';