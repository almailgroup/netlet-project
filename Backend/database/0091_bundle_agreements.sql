CREATE TABLE "bundle_agreements" (
	"id" serial PRIMARY KEY NOT NULL,
	"bundle_id" integer NOT NULL,
	"vendor_id" integer NOT NULL,
	"state" varchar(10) NOT NULL,
	"note" text,
	"decided_by" integer,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bundle_agreements_state_check" CHECK ("bundle_agreements"."state" in ('agreed', 'declined'))
);
--> statement-breakpoint
ALTER TABLE "bundle_agreements" ADD CONSTRAINT "bundle_agreements_bundle_id_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundle_agreements" ADD CONSTRAINT "bundle_agreements_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundle_agreements" ADD CONSTRAINT "bundle_agreements_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bundle_agreements_unique" ON "bundle_agreements" USING btree ("bundle_id","vendor_id");--> statement-breakpoint
CREATE INDEX "bundle_agreements_vendor_idx" ON "bundle_agreements" USING btree ("vendor_id");