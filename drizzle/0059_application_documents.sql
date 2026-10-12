CREATE TABLE "application_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"kind" varchar(24) NOT NULL,
	"file_name" varchar(200) NOT NULL,
	"content_type" varchar(40) NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" char(64) NOT NULL,
	"bytes" "bytea" NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"review_note" varchar(400),
	"reviewed_by" integer,
	"reviewed_at" timestamp with time zone,
	"uploaded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_application_id_vendor_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."vendor_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_documents_application_idx" ON "application_documents" USING btree ("application_id","kind","created_at");