ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "firebase_uid" varchar(128);--> statement-breakpoint
CREATE UNIQUE INDEX "users_firebase_uid_unique" ON "users" USING btree ("firebase_uid") WHERE "users"."firebase_uid" is not null;