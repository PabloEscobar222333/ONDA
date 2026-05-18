import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),

  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(1),
  OTP_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(5),
  OTP_DEV_LOG_ONLY: z
    .string()
    .optional()
    .transform((v) => v === 'true'),

  SMS_PROVIDER: z.enum(['hubtel', 'arkesel', 'none']).default('none'),
  SMS_SENDER_ID: z.string().default('ONDA'),
  HUBTEL_CLIENT_ID: z.string().optional(),
  HUBTEL_CLIENT_SECRET: z.string().optional(),
  ARKESEL_API_KEY: z.string().optional(),

  EXPO_PUSH_ACCESS_TOKEN: z.string().optional(),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_IMAGES: z.string().default('onda-images'),
  R2_BUCKET_PDFS: z.string().default('onda-pdfs'),
  R2_PUBLIC_BASE_URL: z.string().optional(),

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
