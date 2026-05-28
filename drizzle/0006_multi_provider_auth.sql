-- Replace phone-based auth with Firebase multi-provider auth (Google, Apple, Email/Password).
--
-- The PK `users.id` now stores the Firebase UID directly (it already did under the old
-- code path; we're just making that the canonical contract). All providers for one user
-- share a single Firebase account via account linking, so one UID identifies one human
-- across all sign-in methods.
--
-- Phone is kept as an optional contact field used by merchant credit-event flows
-- (customer lookup by phone), but is no longer required and is not the auth identity.

ALTER TABLE "users" ALTER COLUMN "phone_number" DROP NOT NULL;

ALTER TABLE "users" ADD COLUMN "email" text;
ALTER TABLE "users" ADD COLUMN "full_name" text;
ALTER TABLE "users" ADD COLUMN "photo_url" text;
ALTER TABLE "users" ADD COLUMN "providers" text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX "users_email_idx" ON "users" ("email");
