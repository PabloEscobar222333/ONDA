import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, count, desc, eq, lt } from 'drizzle-orm';

import { db } from '../db/client.js';
import { notifications } from '../db/schema.js';
import { fail, ok } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';

export const notificationRoutes = new Hono();
notificationRoutes.use('*', requireAuth);

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime().optional(),
});

/**
 * GET /notifications?limit=50&before=<ISO>
 *
 * Returns the current user's notifications, newest first. The response also
 * includes `unreadCount` so the bell badge doesn't need a second round-trip.
 *
 * Pagination uses a `before` cursor (the createdAt of the last item from the
 * previous page) so newly-arrived notifications never reshuffle results.
 */
notificationRoutes.get('/', zValidator('query', listQuery), async (c) => {
  const userId = c.get('userId');
  const { limit, before } = c.req.valid('query');

  const whereExpr = before
    ? and(eq(notifications.userId, userId), lt(notifications.createdAt, new Date(before)))
    : eq(notifications.userId, userId);

  const items = await db
    .select()
    .from(notifications)
    .where(whereExpr)
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  const [unread] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));

  const nextCursor = items.length === limit ? items[items.length - 1]!.createdAt.toISOString() : null;

  return ok(c, {
    items: items.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      data: n.data ?? null,
      isRead: n.isRead,
      createdAt: n.createdAt.toISOString(),
    })),
    unreadCount: unread?.value ?? 0,
    nextCursor,
  });
});

/**
 * PATCH /notifications/:id/read
 *
 * Marks a single notification as read. Idempotent.
 */
notificationRoutes.patch('/:id/read', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const result = await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning({ id: notifications.id });

  if (result.length === 0) return fail(c, 404, 'Notification not found');
  return ok(c, { id });
});

/**
 * POST /notifications/read-all
 *
 * Marks every unread notification for the user as read.
 */
notificationRoutes.post('/read-all', async (c) => {
  const userId = c.get('userId');
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  return ok(c, { ok: true });
});
