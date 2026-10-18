CREATE TYPE "public"."media_kind" AS ENUM('image', 'video');--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "kind" "media_kind" DEFAULT 'image' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "poster_url" text;