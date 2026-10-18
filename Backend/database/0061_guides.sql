CREATE TABLE "guides" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(120) NOT NULL,
	"audience" varchar(12) DEFAULT 'shopper' NOT NULL,
	"title" varchar(140) NOT NULL,
	"title_ar" varchar(140) NOT NULL,
	"summary" varchar(400),
	"summary_ar" varchar(400),
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(12) DEFAULT 'draft' NOT NULL,
	"created_by" integer,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guides" ADD CONSTRAINT "guides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guides_slug_unique" ON "guides" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "guides_published_idx" ON "guides" USING btree ("status","audience","published_at","id");