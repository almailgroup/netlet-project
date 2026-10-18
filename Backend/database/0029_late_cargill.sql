CREATE TABLE "vendor_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"store_name" varchar(160) NOT NULL,
	"store_name_ar" varchar(160),
	"contact_email" varchar(320),
	"contact_phone" varchar(32),
	"governorate" varchar(32),
	"address_line" varchar(300),
	"licence_number" varchar(64),
	"licence_expires_at" timestamp with time zone,
	"licence_doc_url" varchar(2000),
	"identity_doc_url" varchar(2000),
	"payout_iban" varchar(42),
	"under_platform_licence" boolean DEFAULT false NOT NULL,
	"agreement_version" varchar(20),
	"agreed_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"rejection_reason" varchar(400),
	"reviewed_by" integer,
	"reviewed_at" timestamp with time zone,
	"vendor_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "licence_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vendor_applications" ADD CONSTRAINT "vendor_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_applications" ADD CONSTRAINT "vendor_applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_applications" ADD CONSTRAINT "vendor_applications_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_applications_open_unique" ON "vendor_applications" USING btree ("user_id") WHERE "vendor_applications"."status" in ('draft', 'submitted');--> statement-breakpoint
CREATE INDEX "vendor_applications_status_idx" ON "vendor_applications" USING btree ("status","created_at");