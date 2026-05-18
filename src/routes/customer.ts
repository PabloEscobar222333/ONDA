import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, gte, inArray, lte, ne } from 'drizzle-orm';

import { db } from '../db/client.js';
import { creditEvents, payments } from '../db/schema.js';
import { fail, ok } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';

export const customerRoutes = new Hono();
customerRoutes.use('*', requireAuth);

const eventsQuery = z.object({ status: z.enum(['active', 'closed']).default('active') });

customerRoutes.get('/credit-events', zValidator('query', eventsQuery), async (c) => {
  const customerId = c.get('userId');
  const { status } = c.req.valid('query');
  const rows = await db
    .select()
    .from(creditEvents)
    .where(
      and(
        eq(creditEvents.customerId, customerId),
        status === 'closed' ? eq(creditEvents.status, 'closed') : ne(creditEvents.status, 'closed')
      )
    )
    .orderBy(desc(creditEvents.createdAt));
  return ok(c, rows);
});

const paymentsQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  merchantId: z.string().optional(),
});

customerRoutes.get('/payments', zValidator('query', paymentsQuery), async (c) => {
  const customerId = c.get('userId');
  const { from, to, merchantId } = c.req.valid('query');
  const eventFilters = [eq(creditEvents.customerId, customerId)];
  if (merchantId) eventFilters.push(eq(creditEvents.merchantId, merchantId));
  const events = await db
    .select({ id: creditEvents.id })
    .from(creditEvents)
    .where(and(...eventFilters));
  if (!events.length) return ok(c, []);

  const filters = [inArray(payments.creditEventId, events.map((e) => e.id))];
  if (from) filters.push(gte(payments.createdAt, new Date(from)));
  if (to) filters.push(lte(payments.createdAt, new Date(to)));

  const rows = await db
    .select()
    .from(payments)
    .where(and(...filters))
    .orderBy(desc(payments.createdAt));
  return ok(c, rows);
});
