ALTER TABLE "customer_addresses" ADD COLUMN "pin" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_pin" jsonb;