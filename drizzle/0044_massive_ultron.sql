CREATE TABLE "payout_run_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"order_id" integer,
	"order_reference" varchar(24) NOT NULL,
	"vendor_id" integer,
	"amount" numeric(12, 3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer,
	"vendor_name" varchar(255) NOT NULL,
	"total" numeric(12, 3) NOT NULL,
	"bank_reference" varchar(80) NOT NULL,
	"iban_used" varchar(34),
	"paid_by" integer,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payout_run_items" ADD CONSTRAINT "payout_run_items_run_id_payout_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payout_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_run_items" ADD CONSTRAINT "payout_run_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_run_items" ADD CONSTRAINT "payout_run_items_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_runs" ADD CONSTRAINT "payout_runs_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_runs" ADD CONSTRAINT "payout_runs_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payout_run_items_order_idx" ON "payout_run_items" USING btree ("order_id","vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_run_items_run_order_unique" ON "payout_run_items" USING btree ("run_id","order_id");--> statement-breakpoint
CREATE INDEX "payout_runs_vendor_idx" ON "payout_runs" USING btree ("vendor_id","paid_at");