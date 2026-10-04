CREATE TYPE "public"."inbound_status" AS ENUM('announced', 'received', 'cancelled');--> statement-breakpoint
CREATE TABLE "fulfilment_centres" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"governorate" varchar(40) NOT NULL,
	"address_line" varchar(300) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"variant_id" integer,
	"product_title" varchar(255) NOT NULL,
	"variant_title" varchar(255) NOT NULL,
	"sku" varchar(120),
	"expected" integer NOT NULL,
	"received" integer
);
--> statement-breakpoint
CREATE TABLE "inbound_shipments" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" varchar(24) NOT NULL,
	"vendor_id" integer NOT NULL,
	"centre_id" integer NOT NULL,
	"status" "inbound_status" DEFAULT 'announced' NOT NULL,
	"note" text,
	"announced_by" integer,
	"received_by" integer,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_shipments_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "centre_id" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "centre_id" integer;--> statement-breakpoint
ALTER TABLE "inbound_lines" ADD CONSTRAINT "inbound_lines_shipment_id_inbound_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."inbound_shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_lines" ADD CONSTRAINT "inbound_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_centre_id_fulfilment_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."fulfilment_centres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_announced_by_users_id_fk" FOREIGN KEY ("announced_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbound_lines_shipment_idx" ON "inbound_lines" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "inbound_shipments_vendor_idx" ON "inbound_shipments" USING btree ("vendor_id","id");--> statement-breakpoint
CREATE INDEX "inbound_shipments_status_idx" ON "inbound_shipments" USING btree ("status","id");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_centre_id_fulfilment_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."fulfilment_centres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_centre_id_fulfilment_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."fulfilment_centres"("id") ON DELETE restrict ON UPDATE no action;