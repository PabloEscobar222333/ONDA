import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { customerProfiles, users } from '../db/schema.js';
import { ok, fail } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { computeTrustScore, getHistory } from '../services/trustScore.js';

export const trustRoutes = new Hono();
trustRoutes.use('*', requireAuth);

trustRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const [cust] = await db.select().from(customerProfiles).where(eq(customerProfiles.userId, userId)).limit(1);
  if (!cust) return fail(c, 404, 'Customer profile not found');
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const { score, rating, breakdown } = await computeTrustScore(userId);
  const history = await getHistory(userId, 6);

  return ok(c, {
    score,
    rating,
    tier: rating,
    breakdown,
    history,
    privacyVisible: user?.privacyVisible ?? true,
  });
});
