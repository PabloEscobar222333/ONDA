import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { notifications, users } from '../db/schema.js';
import { newId } from '../lib/id.js';
import { logger } from '../lib/logger.js';

type NotificationType =
  | 'new_credit_event'
  | 'payment_reminder'
  | 'payment_confirmed_customer'
  | 'payment_confirmed_merchant'
  | 'cash_payment_awaiting'
  | 'dispute_opened'
  | 'credit_fully_paid';

export async function notify(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  await db.insert(notifications).values({
    id: newId('n'),
    userId,
    type,
    title,
    body,
    data: data ?? null,
  });

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.fcmToken || !user.pushEnabled) return;

  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: user.fcmToken,
        title,
        body,
        data: { type, ...data },
        sound: 'default',
      }),
    });
    if (!res.ok) logger.warn({ status: res.status }, 'Expo push failed');
  } catch (err) {
    logger.warn({ err }, 'Expo push error');
  }
}
