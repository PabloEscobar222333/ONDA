import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../db/client.js';
import { customerProfiles, userRoles, users } from '../db/schema.js';
import { fail, ok } from '../lib/response.js';
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
