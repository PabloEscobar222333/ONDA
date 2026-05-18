import { createHash, randomInt } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { phoneOtps } from '../db/schema.js';
import { env } from '../lib/env.js';
import { newId } from '../lib/id.js';
import { logger } from '../lib/logger.js';
import { sendSms } from './sms.js';

const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');

export async function requestOtp(phoneNumber: string): Promise<{ expiresIn: number }> {
  const now = new Date();
  const oneMinAgo = new Date(now.getTime() - 60_000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60_000);

  const [minuteCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(phoneOtps)
    .where(and(eq(phoneOtps.phoneNumber, phoneNumber), gt(phoneOtps.createdAt, oneMinAgo)));
  if ((minuteCount?.n ?? 0) >= env.OTP_RATE_LIMIT_PER_MINUTE) {
    throw new RateLimitError('Please wait before requesting another code.');
  }

  const [hourCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(phoneOtps)
    .where(and(eq(phoneOtps.phoneNumber, phoneNumber), gt(phoneOtps.createdAt, oneHourAgo)));
  if ((hourCount?.n ?? 0) >= env.OTP_RATE_LIMIT_PER_HOUR) {
    throw new RateLimitError('Too many requests. Try again later.');
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(now.getTime() + env.OTP_TTL_SECONDS * 1000);

  await db.insert(phoneOtps).values({
    id: newId('otp'),
    phoneNumber,
    codeHash: hashCode(code),
    expiresAt,
  });

  if (env.OTP_DEV_LOG_ONLY) {
    logger.info({ phoneNumber, code }, '[OTP dev log]');
  } else {
    await sendSms(phoneNumber, `Your ONDA code is ${code}. Expires in ${Math.floor(env.OTP_TTL_SECONDS / 60)} min.`);
  }

  return { expiresIn: env.OTP_TTL_SECONDS };
}

export async function verifyOtp(phoneNumber: string, code: string): Promise<boolean> {
  const now = new Date();
  const [latest] = await db
    .select()
    .from(phoneOtps)
    .where(
      and(
        eq(phoneOtps.phoneNumber, phoneNumber),
        isNull(phoneOtps.consumedAt),
        gt(phoneOtps.expiresAt, now)
      )
    )
    .orderBy(desc(phoneOtps.createdAt))
    .limit(1);

  if (!latest) return false;
  if (latest.attempts >= 5) return false;

  const matches = latest.codeHash === hashCode(code);
  if (!matches) {
    await db
      .update(phoneOtps)
      .set({ attempts: latest.attempts + 1 })
      .where(eq(phoneOtps.id, latest.id));
    return false;
  }

  await db.update(phoneOtps).set({ consumedAt: now }).where(eq(phoneOtps.id, latest.id));
  return true;
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}
