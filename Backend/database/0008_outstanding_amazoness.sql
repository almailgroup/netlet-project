ALTER TABLE "customer_preferences" ALTER COLUMN "locale" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "customer_preferences" ALTER COLUMN "locale" DROP NOT NULL;