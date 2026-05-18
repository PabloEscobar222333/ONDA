import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { creditEvents, payments } from '../db/schema.js';
import { env } from '../lib/env.js';
import { fail, ok } from '../lib/response.js';
import { newId } from '../lib/id.js';
import { requireAuth } from '../middleware/auth.js';
import { notify } from '../services/push.js';
import { recalcAndStoreTrustScore } from '../services/trustScore.js';
import { logger } from '../lib/logger.js';

export const paymentRoutes = new Hono();
paymentRoutes.use('*', requireAuth);

const manualSchema = z.object({
  creditEventId: z.string().min(1),
  amount: z.number().positive(),
  method: z.enum(['mtn_momo', 'telecel_cash', 'airteltigo', 'bank_transfer']),
  note: z.string().max(500).optional(),
  clientNonce: z.string().min(1),
});

paymentRoutes.post('/manual', zValidator('json', manualSchema), async (c) => {
  const customerId = c.get('userId');
  const data = c.req.valid('json');
  const [event] = await db.select().from(creditEvents).where(eq(creditEvents.id, data.creditEventId)).limit(1);
  if (!event) return fail(c, 404, 'Credit event not found');
  if (event.customerId !== customerId) return fail(c, 403, 'Not your credit event');
  if (event.status === 'closed') return fail(c, 409, 'Credit event is closed');

  try {
    const [created] = await db
      .insert(payments)
      .values({
        id: newId('p'),
        creditEventId: data.creditEventId,
        amount: String(data.amount),
        method: data.method,
        status: 'pending',
        initiator: 'customer',
        clientNonce: data.clientNonce,
        note: data.note ?? null,
        expiresAt: new Date(Date.now() + env.CASH_CONFIRMATION_WINDOW_HOURS * 60 * 60 * 1000),
      })
      .returning();

    await notify(
      event.merchantId,
      'cash_payment_awaiting',
      `${event.customerName} reported a payment`,
      `GHS ${data.amount.toFixed(2)} via ${data.method.replace('_', ' ')}. Confirm receipt to clear.`,
      { creditEventId: event.id, paymentId: created!.id }
    );

    return ok(c, created);
  } catch (err: any) {
    if (err?.code === '23505') {
      const [existing] = await db
        .select()
        .from(payments)
        .where(and(eq(payments.creditEventId, data.creditEventId), eq(payments.clientNonce, data.clientNonce)))
        .limit(1);
      return ok(c, existing);
    }
    throw err;
  }
});

const cashSchema = z.object({
  creditEventId: z.string().min(1),
  amount: z.number().positive(),
  clientNonce: z.string().min(1),
});

paymentRoutes.post('/cash', zValidator('json', cashSchema), async (c) => {
  const merchantId = c.get('userId');
  const data = c.req.valid('json');
  const [event] = await db.select().from(creditEvents).where(eq(creditEvents.id, data.creditEventId)).limit(1);
  if (!event) return fail(c, 404, 'Credit event not found');
  if (event.merchantId !== merchantId) return fail(c, 403, 'Only the merchant can record cash');

  const existingPays = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(payments)
    .where(eq(payments.creditEventId, data.creditEventId));
  const isInitial = (existingPays[0]?.n ?? 0) === 0;
  if (!isInitial) return fail(c, 409, 'Cash deposits are only allowed before any other payment');

  try {
    const [created] = await db
      .insert(payments)
      .values({
        id: newId('p'),
        creditEventId: data.creditEventId,
        amount: String(data.amount),
        method: 'cash',
        status: 'pending',
        initiator: 'merchant',
        isInitialDeposit: true,
        clientNonce: data.clientNonce,
        expiresAt: new Date(Date.now() + env.CASH_CONFIRMATION_WINDOW_HOURS * 60 * 60 * 1000),
      })
      .returning();

    await notify(
      event.customerId,
      'cash_payment_awaiting',
      `Cash deposit awaiting your confirmation`,
      `${event.merchantName} recorded GHS ${data.amount.toFixed(2)}. Confirm within ${env.CASH_CONFIRMATION_WINDOW_HOURS}h.`,
      { creditEventId: event.id, paymentId: created!.id }
    );

    return ok(c, created);
  } catch (err: any) {
    if (err?.code === '23505') {
      const [existing] = await db
        .select()
        .from(payments)
        .where(and(eq(payments.creditEventId, data.creditEventId), eq(payments.clientNonce, data.clientNonce)))
        .limit(1);
      return ok(c, existing);
    }
    throw err;
  }
});

paymentRoutes.post('/:paymentId/confirm', async (c) => {
  const paymentId = c.req.param('paymentId');
  const userId = c.get('userId');
  const [pay] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!pay) return fail(c, 404, 'Payment not found');
  if (pay.status !== 'pending') return fail(c, 409, `Payment is already ${pay.status}`);

  const [event] = await db.select().from(creditEvents).where(eq(creditEvents.id, pay.creditEventId)).limit(1);
  if (!event) return fail(c, 404, 'Credit event not found');

  // Cash initial deposits require customer confirmation; manual payments require merchant confirmation
  if (pay.method === 'cash' && pay.isInitialDeposit) {
    if (event.customerId !== userId) return fail(c, 403, 'Only the customer can confirm this deposit');
  } else {
    if (event.merchantId !== userId) return fail(c, 403, 'Only the merchant can confirm this payment');
  }

  await db.transaction(async (tx) => {
    await tx
      .update(payments)
      .set({
        status: 'confirmed',
        confirmedByCustomer: pay.method === 'cash' && pay.isInitialDeposit ? true : pay.confirmedByCustomer,
        confirmedAt: new Date(),
      })
      .where(eq(payments.id, paymentId));

    const newPaid = Number(event.paidAmount) + Number(pay.amount);
    const newOutstanding = Math.max(0, Number(event.totalAmount) - newPaid);
    const fullyPaid = newOutstanding === 0;
    await tx
      .update(creditEvents)
      .set({
        paidAmount: String(newPaid),
        outstandingBalance: String(newOutstanding),
        status: fullyPaid ? 'closed' : event.status,
        closedAt: fullyPaid ? new Date() : event.closedAt,
        updatedAt: new Date(),
      })
      .where(eq(creditEvents.id, event.id));
  });

  await recalcAndStoreTrustScore(event.customerId).catch((err) => logger.warn({ err }, 'trust recalc failed'));

  await notify(
    event.customerId,
    'payment_confirmed_customer',
    'Payment confirmed',
    `Your GHS ${Number(pay.amount).toFixed(2)} payment was confirmed.`,
    { creditEventId: event.id, paymentId }
  );
  await notify(
    event.merchantId,
    'payment_confirmed_merchant',
    'Payment confirmed',
    `${event.customerName}'s GHS ${Number(pay.amount).toFixed(2)} payment cleared.`,
    { creditEventId: event.id, paymentId }
  );

  if (Number(event.outstandingBalance) - Number(pay.amount) <= 0) {
    await notify(event.customerId, 'credit_fully_paid', 'Credit fully paid', `Your credit with ${event.merchantName} is cleared.`, { creditEventId: event.id });
    await notify(event.merchantId, 'credit_fully_paid', 'Credit fully paid', `${event.customerName}'s credit is cleared.`, { creditEventId: event.id });
  }

  return ok(c, { success: true });
});

paymentRoutes.get('/:paymentId/status', async (c) => {
  const paymentId = c.req.param('paymentId');
  const userId = c.get('userId');
  const [pay] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!pay) return fail(c, 404, 'Payment not found');
  const [event] = await db.select().from(creditEvents).where(eq(creditEvents.id, pay.creditEventId)).limit(1);
  if (!event || (event.merchantId !== userId && event.customerId !== userId)) return fail(c, 403, 'Not your payment');
  return ok(c, {
    paymentId: pay.id,
    state: pay.status === 'confirmed' ? 'success' : pay.status === 'failed' ? 'failed' : 'processing',
    payment: pay,
  });
});
