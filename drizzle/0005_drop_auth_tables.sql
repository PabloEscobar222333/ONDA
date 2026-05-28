-- Firebase Auth replaces in-app OTP + refresh-token bookkeeping.
-- These tables are no longer written or read by the application.

DROP TABLE IF EXISTS "refresh_tokens";
DROP TABLE IF EXISTS "phone_otps";
