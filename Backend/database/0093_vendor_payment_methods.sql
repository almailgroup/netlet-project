CREATE TABLE "vendor_payment_methods" (
	"vendor_id" integer PRIMARY KEY NOT NULL,
	"online_methods" text[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_payment_methods_known" CHECK ("vendor_payment_methods"."online_methods" <@ ARRAY['knet','card','apple_pay']::text[])
);
--> statement-breakpoint
ALTER TABLE "vendor_payment_methods" ADD CONSTRAINT "vendor_payment_methods_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;