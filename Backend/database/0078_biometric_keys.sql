CREATE TABLE "biometric_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"key_id" varchar(64) NOT NULL,
	"public_key" text NOT NULL,
	"device_name" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "biometric_keys" ADD CONSTRAINT "biometric_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "biometric_keys_key_id_unique" ON "biometric_keys" USING btree ("key_id");--> statement-breakpoint
CREATE INDEX "biometric_keys_user_idx" ON "biometric_keys" USING btree ("user_id");