CREATE TYPE "public"."locale_code" AS ENUM('en', 'ar');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('price_drop', 'bag_reminder', 'new_arrival', 'delivery_update');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "customer_notification_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"locale" "locale_code" DEFAULT 'en' NOT NULL,
	"delivery_zone_id" varchar(64),
	"shopify_cart_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_tracking_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"order_reference" varchar(191) NOT NULL,
	"status" varchar(64) NOT NULL,
	"message" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"product_id" varchar(191) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"name" varchar(255),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"last_signed_in" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_notification_preferences" ADD CONSTRAINT "customer_notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_preferences" ADD CONSTRAINT "customer_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_tracking_events" ADD CONSTRAINT "order_tracking_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_products" ADD CONSTRAINT "saved_products_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_notification_user_kind_unique" ON "customer_notification_preferences" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "customer_notification_user_id_idx" ON "customer_notification_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_preferences_user_id_unique" ON "customer_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "order_tracking_user_id_idx" ON "order_tracking_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "order_tracking_user_occurred_idx" ON "order_tracking_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_products_user_product_unique" ON "saved_products" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE INDEX "saved_products_user_id_idx" ON "saved_products" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");