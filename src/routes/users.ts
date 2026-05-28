import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, eq, inArray, not, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { customerProfiles, userRoles, users } from '../db/schema.js';
import { fail, ok } from '../lib/response.js';
import { logger } from '../lib/logger.js';
import { normalizeGhanaPhone } from '../lib/phone.js';
import { requireAuth } from '../middleware/auth.js';
import { getUserProfile } from '../services/userProfile.js';

export const userRoutes = new Hono();

userRoutes.use('*', requireAuth);

userRoutes.get('/me', async (c) => {
  const profile = await getUserProfile(c.get('userId'));
  if (!profile) return fail(c, 404, 'User not found');
  return ok(c, profile);
});

const rolesSchema = z.object({
  roles: z.array(z.enum(['merchant', 'customer'])).min(1).max(2),
});

userRoutes.patch('/role', zValidator('json', rolesSchema), async (c) => {
  const { roles } = c.req.valid('json');
  const userId = c.get('userId');

  await db.transaction(async (tx) => {
    await tx.delete(userRoles).where(eq(userRoles.userId, userId));
    await tx.insert(userRoles).values(roles.map((role) => ({ userId, role })));
    const primary = roles[0];
    await tx.update(users).set({ activeRole: primary, updatedAt: new Date() }).where(eq(users.id, userId));
  });

  const profile = await getUserProfile(userId);
  return ok(c, profile);
});

const profileSchema = z.object({ fullName: z.string().min(1).max(120) });
userRoutes.patch('/profile', zValidator('json', profileSchema), async (c) => {
  const { fullName } = c.req.valid('json');
  const userId = c.get('userId');

  const [existing] = await db
    .select()
    .from(customerProfiles)
    .where(eq(customerProfiles.userId, userId))
    .limit(1);

  if (existing) {
    await db
      .update(customerProfiles)
      .set({ fullName, updatedAt: new Date() })
      .where(eq(customerProfiles.userId, userId));
  } else {
    await db.insert(customerProfiles).values({ userId, fullName });
  }

  await db.update(users).set({ displayName: fullName, updatedAt: new Date() }).where(eq(users.id, userId));
  return ok(c, { fullName });
});

/**
 * PATCH /users/phone
 *
 * Customer attaches their phone number to their Firebase-authed account.
 * If a "stub" user row already exists with this phone — created by a merchant
 * when they added the customer to a credit event before the customer signed
 * up — every row that referenced the stub is repointed to the caller and the
 * stub is deleted. From the customer's perspective, any credit events that
 * were waiting for them now appear in their app.
 *
 * A "stub" is identified as any users row sharing this phone whose providers
 * array is empty (created server-side, never went through /auth/sync). If a
 * row with this phone exists and has at least one provider, that's a real
 * other account and the request is rejected with 409.
 */
const phoneSchema = z.object({ phoneNumber: z.string().min(9) });

userRoutes.patch('/phone', zValidator('json', phoneSchema), async (c) => {
  const userId = c.get('userId');
  const { phoneNumber } = c.req.valid('json');
  const normalized = normalizeGhanaPhone(phoneNumber);
  if (!normalized) return fail(c, 422, 'Invalid Ghana phone number');

  const [other] = await db
    .select()
    .from(users)
    .where(and(eq(users.phoneNumber, normalized), not(eq(users.id, userId))))
    .limit(1);

  if (!other) {
    await db
      .update(users)
      .set({ phoneNumber: normalized, updatedAt: new Date() })
      .where(eq(users.id, userId));
    return ok(c, { merged: false, claimedEventCount: 0 });
  }

  if (other.providers.length > 0) {
    return fail(c, 409, 'That phone number is already linked to another ONDA account.');
  }

  // Stub merge — repoint every FK that targets users.id, then delete the stub.
  // Conflicts on composite/PK columns (userRoles, customerProfiles,
  // merchantProfiles, trustScoreHistory.period) are pre-resolved by deleting
  // the stub-side row when the caller already has the corresponding entry.
  const stubId = other.id;
  let claimedEventCount = 0;

  await db.transaction(async (tx) => {
    // userRoles (composite PK on userId + role)
    await tx.execute(sql`
      INSERT INTO user_roles ("user_id", "role")
        SELECT ${userId}, "role" FROM user_roles WHERE "user_id" = ${stubId}
      ON CONFLICT ("user_id", "role") DO NOTHING
    `);
    await tx.execute(sql`DELETE FROM user_roles WHERE "user_id" = ${stubId}`);

    // customerProfiles (PK on userId): keep caller's if present, else move stub's
    await tx.execute(sql`
      DELETE FROM customer_profiles
      WHERE "user_id" = ${stubId}
        AND EXISTS (SELECT 1 FROM customer_profiles WHERE "user_id" = ${userId})
    `);
    await tx.execute(sql`UPDATE customer_profiles SET "user_id" = ${userId} WHERE "user_id" = ${stubId}`);

    // merchantProfiles: same pattern (rare for a stub but safe)
    await tx.execute(sql`
      DELETE FROM merchant_profiles
      WHERE "user_id" = ${stubId}
        AND EXISTS (SELECT 1 FROM merchant_profiles WHERE "user_id" = ${userId})
    `);
    await tx.execute(sql`UPDATE merchant_profiles SET "user_id" = ${userId} WHERE "user_id" = ${stubId}`);

    // creditEvents — both sides could reference the stub
    const countRes = await tx.execute(sql`
      SELECT count(*)::int AS n FROM credit_events
      WHERE "customer_id" = ${stubId} OR "merchant_id" = ${stubId}
    `);
    claimedEventCount = Number((countRes.rows?.[0] as { n?: number } | undefined)?.n ?? 0);

    await tx.execute(sql`UPDATE credit_events SET "customer_id" = ${userId} WHERE "customer_id" = ${stubId}`);
    await tx.execute(sql`UPDATE credit_events SET "merchant_id" = ${userId} WHERE "merchant_id" = ${stubId}`);

    // disputes
    await tx.execute(sql`UPDATE disputes SET "raised_by_user_id" = ${userId} WHERE "raised_by_user_id" = ${stubId}`);

    // notifications
    await tx.execute(sql`UPDATE notifications SET "user_id" = ${userId} WHERE "user_id" = ${stubId}`);

    // reminderLog
    await tx.execute(sql`UPDATE reminder_log SET "sent_by_user_id" = ${userId} WHERE "sent_by_user_id" = ${stubId}`);

    // trustScoreHistory (unique on userId + period)
    await tx.execute(sql`
      DELETE FROM trust_score_history
      WHERE "user_id" = ${stubId}
        AND "period" IN (SELECT "period" FROM trust_score_history WHERE "user_id" = ${userId})
    `);
    await tx.execute(sql`UPDATE trust_score_history SET "user_id" = ${userId} WHERE "user_id" = ${stubId}`);

    // Finally: stamp the phone on the real user, then delete the stub.
    await tx
      .update(users)
      .set({ phoneNumber: normalized, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await tx.execute(sql`DELETE FROM users WHERE "id" = ${stubId}`);
  });

  logger.info({ userId, stubId, claimedEventCount }, 'Merged stub user on phone claim');
  return ok(c, { merged: true, claimedEventCount });
});

const lookupSchema = z.object({ phone: z.string().min(9) });
userRoutes.get('/lookup', zValidator('query', lookupSchema), async (c) => {
  const { phone } = c.req.valid('query');
  const normalized = normalizeGhanaPhone(phone);
  if (!normalized) return fail(c, 422, 'Invalid phone number');

  const [user] = await db.select().from(users).where(eq(users.phoneNumber, normalized)).limit(1);
  if (!user) {
    return ok(c, { exists: false, phoneNumber: normalized });
  }
  const [cust] = await db
    .select({ trustScore: customerProfiles.trustScore, fullName: customerProfiles.fullName })
    .from(customerProfiles)
    .where(eq(customerProfiles.userId, user.id))
    .limit(1);
  return ok(c, {
    exists: true,
    userId: user.id,
    name: cust?.fullName ?? user.displayName ?? null,
    phoneNumber: user.phoneNumber,
    trustScore: cust?.trustScore ?? null,
  });
});

const prefsSchema = z.object({
  pushEnabled: z.boolean().optional(),
  reminderEnabled: z.boolean().optional(),
  marketingEnabled: z.boolean().optional(),
});
userRoutes.patch('/notification-preferences', zValidator('json', prefsSchema), async (c) => {
  const prefs = c.req.valid('json');
  const userId = c.get('userId');
  await db.update(users).set({ ...prefs, updatedAt: new Date() }).where(eq(users.id, userId));
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return ok(c, {
    pushEnabled: u!.pushEnabled,
    reminderEnabled: u!.reminderEnabled,
    marketingEnabled: u!.marketingEnabled,
  });
});

const privacySchema = z.object({ privacyVisible: z.boolean() });
userRoutes.patch('/privacy', zValidator('json', privacySchema), async (c) => {
  const { privacyVisible } = c.req.valid('json');
  const userId = c.get('userId');
  await db.update(users).set({ privacyVisible, updatedAt: new Date() }).where(eq(users.id, userId));
  return ok(c, { privacyVisible });
});

const fcmSchema = z.object({ fcmToken: z.string().min(10) });
userRoutes.post('/fcm-token', zValidator('json', fcmSchema), async (c) => {
  const { fcmToken } = c.req.valid('json');
  const userId = c.get('userId');
  await db.update(users).set({ fcmToken, updatedAt: new Date() }).where(eq(users.id, userId));
  return ok(c, { success: true });
});

const customerProfileForMerchantSchema = z.object({ customerId: z.string().min(1) });
userRoutes.get(
  '/:customerId/profile',
  zValidator('param', customerProfileForMerchantSchema),
  async (c) => {
    const { customerId } = c.req.valid('param');
    const merchantId = c.get('userId');

    const [customer] = await db.select().from(users).where(eq(users.id, customerId)).limit(1);
    if (!customer) return fail(c, 404, 'Customer not found');
    const [cust] = await db
      .select()
      .from(customerProfiles)
      .where(eq(customerProfiles.userId, customerId))
      .limit(1);

    const { creditEvents, payments } = await import('../db/schema.js');
    const events = await db
      .select()
      .from(creditEvents)
      .where(and(eq(creditEvents.merchantId, merchantId), eq(creditEvents.customerId, customerId)));

    const eventIds = events.map((e) => e.id);
    const pays = eventIds.length
      ? await db.select().from(payments).where(inArray(payments.creditEventId, eventIds))
      : [];

    return ok(c, {
      customer: {
        userId: customer.id,
        name: cust?.fullName ?? customer.displayName,
        phoneNumber: customer.phoneNumber,
        trustScore: cust?.trustScore ?? null,
        trustRating: cust?.trustRating ?? null,
      },
      creditEvents: events,
      payments: pays,
    });
  }
);
