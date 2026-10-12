ALTER TABLE "customer_addresses" ADD COLUMN "area" varchar(60);--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD COLUMN "block" varchar(10);--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD COLUMN "street" varchar(120);--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD COLUMN "avenue" varchar(60);--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD COLUMN "building" varchar(60);--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD COLUMN "floor" varchar(10);--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD COLUMN "apartment" varchar(20);--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD COLUMN "paci_number" varchar(12);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_address_parts" jsonb;