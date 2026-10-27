CREATE TYPE "public"."gender" AS ENUM('male', 'female');--> statement-breakpoint
CREATE TABLE "customer_profiles" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"first_name" varchar(60),
	"last_name" varchar(60),
	"phone" varchar(16),
	"gender" "gender",
	"birthday" date,
	"nationality" char(2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_profiles_nationality_code" CHECK ("customer_profiles"."nationality" is null or "customer_profiles"."nationality" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;