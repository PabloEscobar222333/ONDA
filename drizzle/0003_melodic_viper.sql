ALTER TABLE "merchant_profiles" ADD COLUMN "kyc_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_profiles" DROP COLUMN IF EXISTS "tier";--> statement-breakpoint
DROP TYPE "public"."merchant_tier";