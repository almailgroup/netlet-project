CREATE TABLE "courier_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"courier_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "couriers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"name_ar" varchar(160),
	"contact_phone" varchar(40),
	"contact_email" varchar(320),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "courier_id" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "size_class" varchar(20);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "weight_grams" integer;--> statement-breakpoint
ALTER TABLE "courier_members" ADD CONSTRAINT "courier_members_courier_id_couriers_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."couriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_members" ADD CONSTRAINT "courier_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "courier_members_unique" ON "courier_members" USING btree ("courier_id","user_id");--> statement-breakpoint
CREATE INDEX "courier_members_user_idx" ON "courier_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "couriers_status_idx" ON "couriers" USING btree ("status");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_courier_id_couriers_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."couriers"("id") ON DELETE set null ON UPDATE no action;