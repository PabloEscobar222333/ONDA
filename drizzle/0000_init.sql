CREATE TYPE "public"."acceptance_status" AS ENUM('pending_acceptance', 'accepted');--> statement-breakpoint
CREATE TYPE "public"."credit_event_status" AS ENUM('active', 'overdue', 'disputed', 'closed');--> statement-breakpoint
CREATE TYPE "public"."dispute_raised_by" AS ENUM('merchant', 'customer');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'resolved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."dispute_type" AS ENUM('incorrect_amount', 'already_paid', 'wrong_item', 'other');--> statement-breakpoint
CREATE TYPE "public"."merchant_tier" AS ENUM('tier1', 'tier2');--> statement-breakpoint
CREATE TYPE "public"."momo_network" AS ENUM('MTN', 'Telecel', 'AirtelTigo');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('new_credit_event', 'payment_reminder', 'payment_confirmed_customer', 'payment_confirmed_merchant', 'cash_payment_awaiting', 'dispute_opened', 'credit_fully_paid');--> statement-breakpoint
CREATE TYPE "public"."payment_initiator" AS ENUM('merchant', 'customer');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('mtn_momo', 'telecel_cash', 'airteltigo', 'card', 'bank_transfer', 'cash');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_structure" AS ENUM('full_by_date', 'deposit_balance', 'weekly', 'monthly', 'custom');--> statement-breakpoint
CREATE TYPE "public"."reminder_frequency" AS ENUM('daily', 'every_3_days', 'weekly', 'none');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('merchant', 'customer');--> statement-breakpoint
CREATE TYPE "public"."settlement_type" AS ENUM('momo', 'bank');--> statement-breakpoint
CREATE TYPE "public"."subscription_plan" AS ENUM('free', 'pro');--> statement-breakpoint
CREATE TYPE "public"."trust_rating" AS ENUM('Building', 'Fair', 'Good', 'Excellent');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"merchant_name" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_ghana_card" text,
	"item_description" text NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"paid_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"outstanding_balance" numeric(12, 2) NOT NULL,
	"payment_structure" "payment_structure" NOT NULL,
	"schedule" jsonb NOT NULL,
	"reminder_frequency" "reminder_frequency" DEFAULT 'weekly' NOT NULL,
	"status" "credit_event_status" DEFAULT 'active' NOT NULL,
	"acceptance_status" "acceptance_status" DEFAULT 'pending_acceptance' NOT NULL,
	"accepted_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"last_reminder_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"trust_score" integer DEFAULT 20 NOT NULL,
	"trust_rating" "trust_rating" DEFAULT 'Building' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "disputes" (
	"id" text PRIMARY KEY NOT NULL,
	"credit_event_id" text NOT NULL,
	"raised_by" "dispute_raised_by" NOT NULL,
	"raised_by_user_id" text NOT NULL,
	"type" "dispute_type" NOT NULL,
	"description" text NOT NULL,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"business_name" text NOT NULL,
	"business_type" text,
	"owner_name" text NOT NULL,
	"location" text,
	"tier" "merchant_tier" DEFAULT 'tier1' NOT NULL,
	"subscription_plan" "subscription_plan" DEFAULT 'free' NOT NULL,
	"settlement_type" "settlement_type",
	"settlement_details" jsonb,
	"settlement_verified" boolean DEFAULT false NOT NULL,
	"kyc_ghana_card_number" text,
	"kyc_selfie_url" text,
	"kyc_submitted_at" timestamp with time zone,
	"activated" boolean DEFAULT false NOT NULL,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"credit_event_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"initiator" "payment_initiator" NOT NULL,
	"is_initial_deposit" boolean DEFAULT false NOT NULL,
	"confirmed_by_customer" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"client_nonce" text,
	"note" text,
	"paystack_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "phone_otps" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_number" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reminder_log" (
	"id" text PRIMARY KEY NOT NULL,
	"credit_event_id" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_by_user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trust_score_history" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"period" text NOT NULL,
	"score" integer NOT NULL,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_roles" (
	"user_id" text NOT NULL,
	"role" "role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_number" text NOT NULL,
	"display_name" text,
	"active_role" "role",
	"fcm_token" text,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"reminder_enabled" boolean DEFAULT true NOT NULL,
	"marketing_enabled" boolean DEFAULT false NOT NULL,
	"privacy_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_events" ADD CONSTRAINT "credit_events_merchant_id_users_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_events" ADD CONSTRAINT "credit_events_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disputes" ADD CONSTRAINT "disputes_credit_event_id_credit_events_id_fk" FOREIGN KEY ("credit_event_id") REFERENCES "public"."credit_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disputes" ADD CONSTRAINT "disputes_raised_by_user_id_users_id_fk" FOREIGN KEY ("raised_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_profiles" ADD CONSTRAINT "merchant_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_credit_event_id_credit_events_id_fk" FOREIGN KEY ("credit_event_id") REFERENCES "public"."credit_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reminder_log" ADD CONSTRAINT "reminder_log_credit_event_id_credit_events_id_fk" FOREIGN KEY ("credit_event_id") REFERENCES "public"."credit_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reminder_log" ADD CONSTRAINT "reminder_log_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trust_score_history" ADD CONSTRAINT "trust_score_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_events_merchant_idx" ON "credit_events" USING btree ("merchant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_events_customer_idx" ON "credit_events" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "disputes_event_idx" ON "disputes" USING btree ("credit_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_idx" ON "notifications" USING btree ("user_id","is_read","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_event_idx" ON "payments" USING btree ("credit_event_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_nonce_idx" ON "payments" USING btree ("credit_event_id","client_nonce");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phone_otps_phone_idx" ON "phone_otps" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_token_idx" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reminder_log_event_time_idx" ON "reminder_log" USING btree ("credit_event_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trust_score_history_user_period_idx" ON "trust_score_history" USING btree ("user_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_idx" ON "users" USING btree ("phone_number");