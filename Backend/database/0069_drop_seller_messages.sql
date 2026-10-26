DELETE FROM "notifications" WHERE "kind" IN ('seller_message', 'seller_shopper_message');--> statement-breakpoint
DROP TABLE "conversation_messages" CASCADE;--> statement-breakpoint
DROP TABLE "conversations" CASCADE;