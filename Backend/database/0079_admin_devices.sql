CREATE TABLE "admin_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"name" varchar(80),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"requested_ip" varchar(64),
	"approved_by" integer,
	"approved_how" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"last_sign_in_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"last_ip" varchar(64),
	CONSTRAINT "admin_devices_status_check" CHECK ("admin_devices"."status" in ('pending', 'approved', 'denied', 'revoked'))
);
--> statement-breakpoint
ALTER TABLE "admin_devices" ADD CONSTRAINT "admin_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_devices" ADD CONSTRAINT "admin_devices_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_devices_user_token_unique" ON "admin_devices" USING btree ("user_id","token_hash");