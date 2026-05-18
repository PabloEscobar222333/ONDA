import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, gt, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  creditEvents,
  customerProfiles,
  merchantProfiles,
  payments,
  reminderLog,
  userRoles,
  users,
} from '../db/schema.js';
import type { ScheduleItem } from '../db/schema.js';
import { fail, ok } from '../lib/response.js';
import { newId } from '../lib/id.js';
import { env } from '../lib/env.js';
import { normalizeGhanaPhone } from '../lib/phone.js';
import { requireAuth } from '../middleware/auth.js';
import { notify } from '../services/push.js';
import { decodeBase64, putObject } from '../services/storage.js';

export const creditEventRoutes = new Hono();
creditEventRoutes.use('*', requireAuth);

const scheduleItem = z.object({
  id: z.string(),
  dueDate: z.string(),
  amount: z.number().positive(),
  status: z.enum(['upcoming', 'due', 'paid', 'overdue']).default('upcoming'),
});

const createSchema = z
  .object({
    customerPhone: z.string().min(9),
    customerName: z.string().min(1),
    customerGhanaCard: z.string().optional(),
    customerGhanaCardPhotoBase64: z.string().min(20).optional(),
    itemDescription: z.string().min(1),
    totalAmount: z.number().positive(),
    paymentStructure: z.enum(['deposit_daily', 'deposit_weekly', 'deposit_monthly']),
    schedule: z.array(scheduleItem).min(1),
    reminderFrequency: z.enum(['daily', 'every_3_days', 'weekly', 'none']).default('weekly'),
  })
  .refine(
    (d) => !!d.customerGhanaCard === !!d.customerGhanaCardPhotoBase64,
    { message: 'Ghana Card number and photo must be provided together' }
  );

creditEventRoutes.post('/', zValidator('json', createSchema), async (c) => {
  const merchantId = c.get('userId');
  const data = c.req.valid('json');

  const [merchantProfile] = await db
    .select()
    .from(merchantProfiles)
    .where(eq(merchantProfiles.userId, merchantId))
    .limit(1);
  if (!merchantProfile) return fail(c, 403, 'Complete merchant onboarding first');
  if (!merchantProfile.activated) return fail(c, 403, 'Merchant not activated');

  const phone = normalizeGhanaPhone(data.customerPhone);
  if (!phone) return fail(c, 422, 'Invalid customer phone');

  let [customerUser] = await db.select().from(users).where(eq(users.phoneNumber, phone)).limit(1);
  if (!customerUser) {
    const newCustomerId = newId('u');
    await db.insert(users).values({ id: newCustomerId, phoneNumber: phone, displayName: data.customerName });
    await db.insert(userRoles).values({ userId: newCustomerId, role: 'customer' });
    await db.insert(customerProfiles).values({ userId: newCustomerId, fullName: data.customerName });
    customerUser = (await db.select().from(users).where(eq(users.id, newCustomerId)).limit(1))[0]!;
  } else {
    const existing = await db
      .select()
      .from(customerProfiles)
      .where(eq(customerProfiles.userId, customerUser.id))
      .limit(1);
    if (!existing.length) {
      await db.insert(customerProfiles).values({ userId: customerUser.id, fullName: data.customerName });
      await db.insert(userRoles).values({ userId: customerUser.id, role: 'customer' }).onConflictDoNothing();
    }
  }

  const id = newId('ce');

  let ghanaCardPhotoUrl: string | null = null;
  if (data.customerGhanaCardPhotoBase64) {
    const { buffer, mime } = decodeBase64(data.customerGhanaCardPhotoBase64);
    const ext = mime.includes('png') ? 'png' : 'jpg';
    const key = `credit-events/${id}/ghana-card.${ext}`;
    ghanaCardPhotoUrl = await putObject(env.R2_BUCKET_IMAGES, key, buffer, mime);
  }

  const [created] = await db
    .insert(creditEvents)
    .values({
      id,
      merchantId,
      customerId: customerUser.id,
      merchantName: merchantProfile.businessName,
      customerName: data.customerName,
      customerGhanaCard: data.customerGhanaCard ?? null,
      customerGhanaCardPhotoUrl: ghanaCardPhotoUrl,
      itemDescription: data.itemDescription,
      totalAmount: String(data.totalAmount),
      outstandingBalance: String(data.totalAmount),
      paymentStructure: data.paymentStructure,
      schedule: data.schedule as ScheduleItem[],
      reminderFrequency: data.reminderFrequency,
    })
    .returning();

  await notify(
    customerUser.id,
    'new_credit_event',
    `New credit from ${merchantProfile.businessName}`,
    `GHS ${data.totalAmount.toFixed(2)} for ${data.itemDescription}. Tap to review.`,
    { creditEventId: id, deepLink: `onda://credit-event/${id}` }
  );

  return ok(c, created);
});

const listQuery = z.object({
  status: z.enum(['active', 'overdue', 'disputed', 'closed']).optional(),
  customerId: z.string().optional(),
});

creditEventRoutes.get('/', zValidator('query', listQuery), async (c) => {
  const merchantId = c.get('userId');
  const { status, customerId } = c.req.valid('query');
  const filters = [eq(creditEvents.merchantId, merchantId)];
  if (status) filters.push(eq(creditEvents.status, status));
  if (customerId) filters.push(eq(creditEvents.customerId, customerId));
  const rows = await db
    .select()
    .from(creditEvents)
    .where(and(...filters))
    .orderBy(desc(creditEvents.createdAt));
  return ok(c, rows);
});

creditEventRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const [event] = await db.select().from(creditEvents).where(eq(creditEvents.id, id)).limit(1);
  if (!event) return fail(c, 404, 'Credit event not found');
  if (event.merchantId !== userId && event.customerId !== userId) return fail(c, 403, 'Not your credit event');
  const pays = await db
    .select()
    .from(payments)
    .where(eq(payments.creditEventId, id))
    .orderBy(desc(payments.createdAt));
  return ok(c, { event, payments: pays });
});

creditEventRoutes.post('/:id/remind', async (c) => {
  const id = c.req.param('id');
  const merchantId = c.get('userId');
  const [event] = await db.select().from(creditEvents).where(eq(creditEvents.id, id)).limit(1);
  if (!event) return fail(c, 404, 'Credit event not found');
  if (event.merchantId !== merchantId) return fail(c, 403, 'Only the merchant can remind');
  if (event.status === 'disputed') return fail(c, 409, 'Cannot remind while dispute is open');

  const since = new Date(Date.now() - env.REMINDER_COOLDOWN_HOURS * 60 * 60 * 1000);
  const recent = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reminderLog)
    .where(and(eq(reminderLog.creditEventId, id), gt(reminderLog.sentAt, since)));
  if ((recent[0]?.n ?? 0) > 0) {
    return fail(c, 429, `Reminder already sent in the last ${env.REMINDER_COOLDOWN_HOURS}h`);
  }

  await db.insert(reminderLog).values({ id: newId('rm'), creditEventId: id, sentByUserId: merchantId });
  await db.update(creditEvents).set({ lastReminderAt: new Date() }).where(eq(creditEvents.id, id));

  await notify(
    event.customerId,
    'payment_reminder',
    `Reminder from ${event.merchantName}`,
    `GHS ${Number(event.outstandingBalance).toFixed(2)} outstanding for ${event.itemDescription}.`,
    { creditEventId: id, deepLink: `onda://credit-event/${id}` }
  );

  return ok(c, { sent: true });
});

creditEventRoutes.post('/:id/accept', async (c) => {
  const id = c.req.param('id');
  const customerId = c.get('userId');
  const [event] = await db.select().from(creditEvents).where(eq(creditEvents.id, id)).limit(1);
  if (!event) return fail(c, 404, 'Credit event not found');
  if (event.customerId !== customerId) return fail(c, 403, 'Not your credit event');
  if (event.acceptanceStatus === 'accepted') return ok(c, event);

  const [updated] = await db
    .update(creditEvents)
    .set({ acceptanceStatus: 'accepted', acceptedAt: new Date(), updatedAt: new Date() })
    .where(eq(creditEvents.id, id))
    .returning();
  return ok(c, updated);
});
