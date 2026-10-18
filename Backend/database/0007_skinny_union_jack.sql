ALTER TABLE "vendors" ADD COLUMN "contact_email" varchar(320);--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "contact_phone" varchar(40);--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "description_ar" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "governorate" varchar(40);--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "address_line" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "licence_number" varchar(60);--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "payout_iban" varchar(34);