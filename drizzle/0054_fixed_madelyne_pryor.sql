CREATE TABLE "fulfilment_charges" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"order_item_id" integer,
	"centre_id" integer NOT NULL,
	"order_reference" varchar(24) NOT NULL,
	"units" integer NOT NULL,
	"rate_per_unit" numeric(12, 3) NOT NULL,
	"amount" numeric(12, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fulfilment_centres" ADD COLUMN "pack_fee_per_unit" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "payout_run_items" ADD COLUMN "charge_id" integer;--> statement-breakpoint
ALTER TABLE "fulfilment_charges" ADD CONSTRAINT "fulfilment_charges_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfilment_charges" ADD CONSTRAINT "fulfilment_charges_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfilment_charges" ADD CONSTRAINT "fulfilment_charges_centre_id_fulfilment_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."fulfilment_centres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fulfilment_charges_line_unique" ON "fulfilment_charges" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "fulfilment_charges_vendor_idx" ON "fulfilment_charges" USING btree ("vendor_id","id");--> statement-breakpoint
ALTER TABLE "payout_run_items" ADD CONSTRAINT "payout_run_items_charge_id_fulfilment_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."fulfilment_charges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payout_run_items_run_charge_unique" ON "payout_run_items" USING btree ("run_id","charge_id");