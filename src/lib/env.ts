import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1),

  // Firebase Auth is the single source of identity (Google / Apple / Email-Password
  // via the client SDK; verified on the backend via Firebase Admin). Both vars are
  // required — startup fails fast if either is missing.
  FIREBASE_PROJECT_ID: z.string().min(1, 'FIREBASE_PROJECT_ID is required'),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().min(1, 'FIREBASE_SERVICE_ACCOUNT_JSON is required'),

  SUPABASE_URL: z.string().optional().transform((v) => v || undefined),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().transform((v) => v || undefined),
  SUPABASE_BUCKET_KYC: z.string().default('onda-kyc'),
  SUPABASE_BUCKET_CREDIT_EVENTS: z.string().default('onda-credit-events'),
  SUPABASE_BUCKET_REPORTS: z.string().default('onda-reports'),
  SUPABASE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  SMS_PROVIDER: z.enum(['hubtel', 'arkesel', 'none']).default('none'),
  SMS_SENDER_ID: z.string().default('ONDA'),
  HUBTEL_CLIENT_ID: z.string().optional(),
  HUBTEL_CLIENT_SECRET: z.string().optional(),
  ARKESEL_API_KEY: z.string().optional(),

  EXPO_PUSH_ACCESS_TOKEN: z.string().optional(),

  CASH_CONFIRMATION_WINDOW_HOURS: z.coerce.number().int().positive().default(48),
  REMINDER_COOLDOWN_HOURS: z.coerce.number().int().positive().default(24),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
