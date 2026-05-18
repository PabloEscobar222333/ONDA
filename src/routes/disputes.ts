import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { creditEvents, disputes } from '../db/schema.js';
import { fail, ok } from '../lib/response.js';
import { newId } from '../lib/id.js';
import { requireAuth } from '../middleware/auth.js';
import { notify } from '../services/push.js';

export const disputeRoutes = new Hono();
disputeRoutes.use('*', requireAuth);

const schema = z.object({
  creditEventId: z.string().min(1),
  type: z.enum(['incorrect_amount', 'already_paid', 'wrong_item', 'other']),
  description: z.string().min(1).max(2000),
  raisedBy: z.enum(['merchant', 'customer']),
});

disputeRoutes.post('/', zValidator('json', schema), async (c) => {
  const userId = c.get('userId');
  const data = c.req.valid('json');
  const [event] = await db.select().from(creditEvents).where(eq(creditEvents.id, data.creditEventId)).limit(1);
  if (!event) return fail(c, 404, 'Credit event not found');
  if (data.raisedBy === 'merchant' && event.merchantId !== userId) return fail(c, 403, 'Not your credit event');
  if (data.raisedBy === 'customer' && event.customerId !== userId) return fail(c, 403, 'Not your credit event');

  const [created] = await db
    .insert(disputes)
    .values({
      id: newId('d'),
      creditEventId: data.creditEventId,
      raisedBy: data.raisedBy,
      raisedByUserId: userId,
      type: data.type,
      description: data.description,
    })
    .returning();

  await db
    .update(creditEvents)
    .set({ status: 'disputed', updatedAt: new Date() })
    .where(eq(creditEvents.id, data.creditEventId));

  const otherParty = data.raisedBy === 'merchant' ? event.customerId : event.merchantId;
  await notify(
    otherParty,
    'dispute_opened',
    'Dispute opened',
    `A dispute was opened on the credit event for ${event.itemDescription}.`,
    { creditEventId: event.id, disputeId: created!.id }
  );

  return ok(c, created);
});
