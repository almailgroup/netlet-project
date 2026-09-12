ALTER TABLE "products" ADD COLUMN "commission_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "commission_fixed" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "badges" text[] DEFAULT '{}' NOT NULL;