import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, eq, gt, isNull } from 'drizzle-orm';

import { db } from '../db/client.js';
import { refreshTokens, users } from '../db/schema.js';
import { newId } from '../lib/id.js';
import { env } from '../lib/env.js';
import { generateRefreshToken, hashToken, signAccessToken } from '../lib/jwt.js';
import { normalizeGhanaPhone } from '../lib/phone.js';
import { fail, ok } from '../lib/response.js';
import { RateLimitError, requestOtp, verifyOtp } from '../services/otp.js';
import { getUserProfile } from '../services/userProfile.js';

export const authRoutes = new Hono();

const phoneSchema = z.object({ phoneNumber: z.string().min(9) });
const verifySchema = z.object({ phoneNumber: z.string().min(9), code: z.string().length(6) });
const refreshSchema = z.object({ refreshToken: z.string().min(20) });

authRoutes.post('/request-otp', zValidator('json', phoneSchema), async (c) => {
  const { phoneNumber } = c.req.valid('json');
  const normalized = normalizeGhanaPhone(phoneNumber);
  if (!normalized) return fail(c, 422, 'Invalid Ghanaian phone number');
  try {
    const { expiresIn } = await requestOtp(normalized);
    return ok(c, { message: 'OTP sent', expiresIn });
  } catch (err) {
    if (err instanceof RateLimitError) return fail(c, 429, err.message);
    throw err;
  }
});

authRoutes.post('/verify-otp', zValidator('json', verifySchema), async (c) => {
  const { phoneNumber, code } = c.req.valid('json');
  const normalized = normalizeGhanaPhone(phoneNumber);
  if (!normalized) return fail(c, 422, 'Invalid Ghanaian phone number');

  const valid = await verifyOtp(normalized, code);
  if (!valid) return fail(c, 401, 'Invalid or expired code');

  const [existing] = await db.select().from(users).where(eq(users.phoneNumber, normalized)).limit(1);
  const isNewUser = !existing;
  const userId = existing?.id ?? newId('u');

  if (!existing) {
    await db.insert(users).values({ id: userId, phoneNumber: normalized });
  }

  const tokens = await issueTokens(userId, existing?.activeRole ?? undefined);
  const profile = await getUserProfile(userId);

  return ok(c, { ...tokens, user: profile, isNewUser });
});

authRoutes.post('/refresh', zValidator('json', refreshSchema), async (c) => {
  const { refreshToken } = c.req.valid('json');
  const tokenHash = hashToken(refreshToken);
  const now = new Date();
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(and(eq(refreshTokens.tokenHash, tokenHash), gt(refreshTokens.expiresAt, now), isNull(refreshTokens.revokedAt)))
    .limit(1);

  if (!row) return fail(c, 401, 'Invalid or expired refresh token');

  await db.update(refreshTokens).set({ revokedAt: now }).where(eq(refreshTokens.id, row.id));

  const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
  if (!user) return fail(c, 401, 'User not found');

  const tokens = await issueTokens(user.id, user.activeRole ?? undefined);
  return ok(c, tokens);
});

async function issueTokens(userId: string, role?: 'merchant' | 'customer') {
  const access = await signAccessToken({ sub: userId, role });
  const { token: refresh, hash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000);
  await db.insert(refreshTokens).values({ id: newId('rt'), userId, tokenHash: hash, expiresAt });
  return { token: access, refreshToken: refresh };
}
