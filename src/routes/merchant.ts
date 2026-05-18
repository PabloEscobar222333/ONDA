import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, gte, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  creditEvents,
  customerProfiles,
  merchantProfiles,
  payments,
  userRoles,
  users,
} from '../db/schema.js';
import { env } from '../lib/env.js';
import { fail, ok } from '../lib/response.js';
import { normalizeGhanaPhone } from '../lib/phone.js';
import { requireAuth } from '../middleware/auth.js';
import { buildTransactionPdf } from '../services/pdf.js';
import { decodeBase64, putObject } from '../services/storage.js';
import { newId } from '../lib/id.js';

export const merchantRoutes = new Hono();
merchantRoutes.use('*', requireAuth);

merchantRoutes.get('/dashboard', async (c) => {
  const merchantId = c.get('userId');
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const events = await db
    .select()
    .from(creditEvents)
    .where(eq(creditEvents.merchantId, merchantId));

  const totalOutstanding = events.reduce((s, e) => s + Number(e.outstandingBalance), 0);
  const activeCount = events.filter((e) => e.status === 'active').length;
  const overdueCount = events.filter((e) => e.status === 'overdue').length;

  const recentPayments = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      method: payments.method,
      status: payments.status,
      createdAt: payments.createdAt,
      creditEventId: payments.creditEventId,
    })
    .from(payments)
    .innerJoin(creditEvents, eq(payments.creditEventId, creditEvents.id))
    .where(and(eq(creditEvents.merchantId, merchantId), gte(payments.createdAt, weekAgo)))
    .orderBy(desc(payments.createdAt))
    .limit(20);

  const overdueCustomers = events
    .filter((e) => e.status === 'overdue')
    .slice(0, 10)
    .map((e) => ({
      creditEventId: e.id,
      customerName: e.customerName,
      outstanding: Number(e.outstandingBalance),
    }));

  return ok(c, {
    totals: {
      outstanding: totalOutstanding,
      activeCreditEvents: activeCount,
      overdue: overdueCount,
    },
    overdueCustomers,
    dueSoon: [],
    recentPayments,
  });
});

const customersQuery = z.object({
  search: z.string().optional(),
  filter: z.enum(['all', 'active', 'overdue', 'cleared']).optional(),
});

merchantRoutes.get('/customers', zValidator('query', customersQuery), async (c) => {
  const merchantId = c.get('userId');
  const { filter } = c.req.valid('query');

  const rows = await db
    .select({
      customerId: creditEvents.customerId,
      customerName: creditEvents.customerName,
      status: creditEvents.status,
      outstanding: sql<number>`sum(${creditEvents.outstandingBalance})::float`,
      activeEvents: sql<number>`count(*)::int`,
    })
    .from(creditEvents)
    .where(eq(creditEvents.merchantId, merchantId))
    .groupBy(creditEvents.customerId, creditEvents.customerName, creditEvents.status);

  const grouped = new Map<string, { customerId: string; name: string; outstanding: number; events: number; status: string }>();
  for (const r of rows) {
    const existing = grouped.get(r.customerId);
    if (existing) {
      existing.outstanding += Number(r.outstanding);
      existing.events += Number(r.activeEvents);
      if (r.status === 'overdue') existing.status = 'overdue';
    } else {
      grouped.set(r.customerId, {
        customerId: r.customerId,
        name: r.customerName,
        outstanding: Number(r.outstanding),
        events: Number(r.activeEvents),
        status: r.status,
      });
    }
  }

  let list = Array.from(grouped.values());
  if (filter === 'active') list = list.filter((g) => g.status === 'active');
  if (filter === 'overdue') list = list.filter((g) => g.status === 'overdue');
  if (filter === 'cleared') list = list.filter((g) => g.outstanding === 0);

  return ok(c, list);
});

const txnQuery = z.object({
  period: z.enum(['week', 'month', 'all']).optional(),
  method: z.enum(['all', 'paystack', 'cash', 'pending']).optional(),
});

merchantRoutes.get('/transactions', zValidator('query', txnQuery), async (c) => {
  const merchantId = c.get('userId');
  const { period } = c.req.valid('query');
  const now = new Date();
  const since =
    period === 'week' ? new Date(now.getTime() - 7 * 86400_000)
    : period === 'month' ? new Date(now.getTime() - 30 * 86400_000)
    : new Date(0);

  const rows = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      method: payments.method,
      status: payments.status,
      isInitialDeposit: payments.isInitialDeposit,
      createdAt: payments.createdAt,
      creditEventId: payments.creditEventId,
      customerName: creditEvents.customerName,
    })
    .from(payments)
    .innerJoin(creditEvents, eq(payments.creditEventId, creditEvents.id))
    .where(and(eq(creditEvents.merchantId, merchantId), gte(payments.createdAt, since)))
    .orderBy(desc(payments.createdAt));

  return ok(c, rows);
});

merchantRoutes.get('/export/pdf', async (c) => {
  const merchantId = c.get('userId');
  const [profile] = await db.select().from(merchantProfiles).where(eq(merchantProfiles.userId, merchantId)).limit(1);
  const rows = await db
    .select({
      id: payments.id,
      creditEventId: payments.creditEventId,
      amount: payments.amount,
      method: payments.method,
      status: payments.status,
      initiator: payments.initiator,
      isInitialDeposit: payments.isInitialDeposit,
      confirmedByCustomer: payments.confirmedByCustomer,
      confirmedAt: payments.confirmedAt,
      expiresAt: payments.expiresAt,
      clientNonce: payments.clientNonce,
      note: payments.note,
      paystackReference: payments.paystackReference,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .innerJoin(creditEvents, eq(payments.creditEventId, creditEvents.id))
    .where(eq(creditEvents.merchantId, merchantId))
    .orderBy(desc(payments.createdAt));
  const url = await buildTransactionPdf(profile?.businessName ?? 'ONDA Merchant', rows);
  return ok(c, { url });
});

const verifyMomoSchema = z.object({
  number: z.string().min(9),
  network: z.enum(['MTN MoMo', 'Telecel Cash', 'AirtelTigo Money']),
});
merchantRoutes.post('/verify-momo', zValidator('json', verifyMomoSchema), async (c) => {
  const { number } = c.req.valid('json');
  const normalized = normalizeGhanaPhone(number);
  if (!normalized) return fail(c, 422, 'Invalid Ghanaian mobile number');
  return ok(c, { accountName: 'Pending verification', verified: false });
});

const verifyBankSchema = z.object({
  bankName: z.string().min(1),
  accountNumber: z.string().min(5),
});
merchantRoutes.post('/verify-bank', zValidator('json', verifyBankSchema), async (c) => {
  return ok(c, { accountName: 'Pending verification', verified: false });
});

const settlementSchema = z.object({
  settlementType: z.enum(['momo', 'bank']),
  settlementDetails: z.record(z.unknown()),
});
merchantRoutes.patch('/settlement', zValidator('json', settlementSchema), async (c) => {
  const merchantId = c.get('userId');
  const data = c.req.valid('json');
  await db
    .update(merchantProfiles)
    .set({
      settlementType: data.settlementType,
      settlementDetails: data.settlementDetails,
      settlementVerified: false,
      updatedAt: new Date(),
    })
    .where(eq(merchantProfiles.userId, merchantId));
  return ok(c, { success: true });
});

const onboardingSchema = z.object({
  businessName: z.string().min(1),
  businessType: z.string().optional(),
  ownerName: z.string().min(1),
  location: z.string().optional(),
});
merchantRoutes.post('/onboarding/business-info', zValidator('json', onboardingSchema), async (c) => {
  const merchantId = c.get('userId');
  const data = c.req.valid('json');
  const [existing] = await db
    .select()
    .from(merchantProfiles)
    .where(eq(merchantProfiles.userId, merchantId))
    .limit(1);
  if (existing) {
    await db
      .update(merchantProfiles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(merchantProfiles.userId, merchantId));
  } else {
    await db.insert(merchantProfiles).values({ userId: merchantId, ...data });
    const has = await db
      .select()
      .from(userRoles)
      .where(and(eq(userRoles.userId, merchantId), eq(userRoles.role, 'merchant')))
      .limit(1);
    if (!has.length) await db.insert(userRoles).values({ userId: merchantId, role: 'merchant' });
  }
  await db
    .update(users)
    .set({ displayName: data.ownerName, activeRole: 'merchant', updatedAt: new Date() })
    .where(eq(users.id, merchantId));
  return ok(c, { success: true });
});

const kycSchema = z.object({
  ghanaCardNumber: z.string().min(8),
  selfieBase64: z.string().min(20),
});
merchantRoutes.post('/onboarding/kyc', zValidator('json', kycSchema), async (c) => {
  const merchantId = c.get('userId');
  const { ghanaCardNumber, selfieBase64 } = c.req.valid('json');
  const { buffer, mime } = decodeBase64(selfieBase64);
  const ext = mime.includes('png') ? 'png' : 'jpg';
  const key = `kyc/${merchantId}/${newId('sf')}.${ext}`;
  const url = await putObject(env.R2_BUCKET_IMAGES, key, buffer, mime);
  await db
    .update(merchantProfiles)
    .set({
      kycGhanaCardNumber: ghanaCardNumber,
      kycSelfieUrl: url,
      kycSubmittedAt: new Date(),
      kycVerified: true,
      updatedAt: new Date(),
    })
    .where(eq(merchantProfiles.userId, merchantId));
  return ok(c, { success: true, kycVerified: true });
});

merchantRoutes.post('/onboarding/activate', async (c) => {
  const merchantId = c.get('userId');
  await db
    .update(merchantProfiles)
    .set({ activated: true, activatedAt: new Date(), updatedAt: new Date() })
    .where(eq(merchantProfiles.userId, merchantId));
  return ok(c, { success: true });
});
