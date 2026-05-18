ALTER TABLE "public"."credit_events" ALTER COLUMN "payment_structure" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."payment_structure";--> statement-breakpoint
CREATE TYPE "public"."payment_structure" AS ENUM('deposit_daily', 'deposit_weekly', 'deposit_monthly');--> statement-breakpoint
ALTER TABLE "public"."credit_events" ALTER COLUMN "payment_structure" SET DATA TYPE "public"."payment_structure" USING "payment_structure"::"public"."payment_structure";