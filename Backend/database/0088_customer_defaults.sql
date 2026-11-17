CREATE TABLE "customer_defaults" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"address_id" integer,
	"payment_method" varchar(16) DEFAULT 'cod' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_defaults_payment_check" CHECK ("customer_defaults"."payment_method" in ('cod', 'knet', 'card', 'apple_pay'))
);
--> statement-breakpoint
ALTER TABLE "customer_defaults" ADD CONSTRAINT "customer_defaults_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_defaults" ADD CONSTRAINT "customer_defaults_address_id_customer_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."customer_addresses"("id") ON DELETE set null ON UPDATE no action;