CREATE TABLE "driver_positions" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"courier_id" integer NOT NULL,
	"position" jsonb NOT NULL,
	"accuracy_m" integer,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "carried_by" integer;--> statement-breakpoint
ALTER TABLE "driver_positions" ADD CONSTRAINT "driver_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_positions" ADD CONSTRAINT "driver_positions_courier_id_couriers_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."couriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_carried_by_users_id_fk" FOREIGN KEY ("carried_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;