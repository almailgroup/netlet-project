CREATE TABLE "invoice_counters" (
	"series" varchar(16) PRIMARY KEY NOT NULL,
	"last" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" varchar(32) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"order_id" integer NOT NULL,
	"credits_invoice_id" integer,
	"return_request_id" integer,
	"total" numeric(12, 3) NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"document" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_credits_invoice_id_invoices_id_fk" FOREIGN KEY ("credits_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_return_request_id_return_requests_id_fk" FOREIGN KEY ("return_request_id") REFERENCES "public"."return_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_unique" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_one_per_order" ON "invoices" USING btree ("order_id") WHERE "invoices"."kind" = 'invoice';--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_one_per_return" ON "invoices" USING btree ("return_request_id") WHERE "invoices"."return_request_id" is not null;--> statement-breakpoint
CREATE INDEX "invoices_issued_idx" ON "invoices" USING btree ("issued_at");