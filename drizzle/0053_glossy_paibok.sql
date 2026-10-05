CREATE TABLE "membership_terms" (
	"id" integer PRIMARY KEY NOT NULL,
	"free_delivery_over" numeric(12, 3),
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"source" varchar(12) DEFAULT 'granted' NOT NULL,
	"granted_by" integer,
	"note" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "member" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_waived" numeric(12, 3) DEFAULT '0.000' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "member_price" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "membership_terms" ADD CONSTRAINT "membership_terms_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id","ends_at");