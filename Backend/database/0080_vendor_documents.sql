CREATE TABLE "vendor_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"kind" varchar(24) NOT NULL,
	"title" varchar(120),
	"file_name" varchar(200) NOT NULL,
	"content_type" varchar(40) NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" char(64) NOT NULL,
	"bytes" "bytea" NOT NULL,
	"expires_on" date,
	"netlet_only" boolean DEFAULT false NOT NULL,
	"uploaded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendor_documents" ADD CONSTRAINT "vendor_documents_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_documents" ADD CONSTRAINT "vendor_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vendor_documents_vendor_idx" ON "vendor_documents" USING btree ("vendor_id","created_at");