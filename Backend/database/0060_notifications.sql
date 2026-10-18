CREATE TYPE "public"."notification_channel" AS ENUM('email', 'whatsapp', 'sms');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_status" AS ENUM('pending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"notification_id" integer NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"address" varchar(320) NOT NULL,
	"status" "notification_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" varchar(48) NOT NULL,
	"message_key" varchar(120) NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"link" varchar(500),
	"dedupe_key" varchar(191) NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_preferences" ADD COLUMN "notify_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_once_idx" ON "notification_deliveries" USING btree ("notification_id","channel");--> statement-breakpoint
CREATE INDEX "notification_deliveries_due_idx" ON "notification_deliveries" USING btree ("next_attempt_at") WHERE "notification_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_dedupe_idx" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" is null;