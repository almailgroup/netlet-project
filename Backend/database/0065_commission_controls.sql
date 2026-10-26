CREATE TABLE "commission_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"product_id" integer,
	"percent" numeric(5, 2),
	"fixed" numeric(12, 3),
	"reason" varchar(500),
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"decision_note" varchar(400),
	"created_by" integer,
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_proposals_one_figure" CHECK (("commission_proposals"."percent" is null) <> ("commission_proposals"."fixed" is null))
);
--> statement-breakpoint
CREATE TABLE "staff_grants" (
	"user_id" integer NOT NULL,
	"capability" varchar(48) NOT NULL,
	"granted_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_grants_user_id_capability_pk" PRIMARY KEY("user_id","capability")
);
--> statement-breakpoint
ALTER TABLE "vendor_applications" ADD COLUMN "proposed_commission_fixed" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "commission_proposals" ADD CONSTRAINT "commission_proposals_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_proposals" ADD CONSTRAINT "commission_proposals_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_proposals" ADD CONSTRAINT "commission_proposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_proposals" ADD CONSTRAINT "commission_proposals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_grants" ADD CONSTRAINT "staff_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_grants" ADD CONSTRAINT "staff_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_proposals_open_unique" ON "commission_proposals" USING btree ("vendor_id",coalesce("product_id", 0)) WHERE "commission_proposals"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "commission_proposals_status_idx" ON "commission_proposals" USING btree ("status","created_at");