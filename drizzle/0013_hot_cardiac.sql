CREATE TYPE "public"."sell_unit" AS ENUM('each', 'g', 'kg', 'ml', 'l');--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "unit" "sell_unit" DEFAULT 'each' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "step_amount" numeric(12, 3) DEFAULT '1' NOT NULL;