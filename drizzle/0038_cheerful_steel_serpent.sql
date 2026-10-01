ALTER TABLE "vendor_applications" ADD COLUMN "proposed_commission_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "vendor_applications" ADD COLUMN "commission_note" varchar(500);