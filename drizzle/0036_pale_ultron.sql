CREATE TABLE "damage_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"parcel_key" varchar(600) NOT NULL,
	"vendor_id" integer,
	"vendor_name" varchar(255),
	"courier_id" integer,
	"filed_by" integer,
	"filed_as" varchar(20) NOT NULL,
	"line_ids" jsonb NOT NULL,
	"claimed_amount" numeric(12, 3) NOT NULL,
	"description" text NOT NULL,
	"evidence_url" varchar(2000),
	"courier_response" text,
	"courier_responded_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"awarded_amount" numeric(12, 3),
	"decision_note" varchar(500),
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_ratings" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"parcel_key" varchar(600) NOT NULL,
	"vendor_id" integer,
	"vendor_name" varchar(255),
	"courier_id" integer,
	"rating" integer NOT NULL,
	"comment" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "damage_claims" ADD CONSTRAINT "damage_claims_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_claims" ADD CONSTRAINT "damage_claims_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_claims" ADD CONSTRAINT "damage_claims_courier_id_couriers_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."couriers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_claims" ADD CONSTRAINT "damage_claims_filed_by_users_id_fk" FOREIGN KEY ("filed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_claims" ADD CONSTRAINT "damage_claims_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_ratings" ADD CONSTRAINT "delivery_ratings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_ratings" ADD CONSTRAINT "delivery_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_ratings" ADD CONSTRAINT "delivery_ratings_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_ratings" ADD CONSTRAINT "delivery_ratings_courier_id_couriers_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."couriers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "damage_claims_open_unique" ON "damage_claims" USING btree ("order_id","parcel_key") WHERE "damage_claims"."status" = 'open';--> statement-breakpoint
CREATE INDEX "damage_claims_courier_idx" ON "damage_claims" USING btree ("courier_id","status");--> statement-breakpoint
CREATE INDEX "damage_claims_order_idx" ON "damage_claims" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_ratings_parcel_unique" ON "delivery_ratings" USING btree ("order_id","parcel_key");--> statement-breakpoint
CREATE INDEX "delivery_ratings_courier_idx" ON "delivery_ratings" USING btree ("courier_id","created_at");--> statement-breakpoint
CREATE INDEX "delivery_ratings_vendor_idx" ON "delivery_ratings" USING btree ("vendor_id","created_at");