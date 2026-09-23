ALTER TABLE "orders" ADD COLUMN "payment_method" varchar(20);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_collected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "accepts_cod" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "cod_ceiling" numeric(12, 3);