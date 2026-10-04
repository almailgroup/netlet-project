CREATE TYPE "public"."support_status" AS ENUM('open', 'waiting', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."support_topic" AS ENUM('order', 'delivery', 'return', 'payment', 'account', 'other');--> statement-breakpoint
CREATE TABLE "support_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"topic" "support_topic" NOT NULL,
	"order_id" integer,
	"order_reference" varchar(24),
	"status" "support_status" DEFAULT 'open' NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"shopper_read_at" timestamp with time zone,
	"staff_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"author" varchar(12) NOT NULL,
	"author_id" integer,
	"body" text,
	"answer" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_conversation_id_support_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."support_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_conversations_user_idx" ON "support_conversations" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "support_conversations_status_idx" ON "support_conversations" USING btree ("status","last_message_at");--> statement-breakpoint
CREATE INDEX "support_messages_conversation_idx" ON "support_messages" USING btree ("conversation_id","id");