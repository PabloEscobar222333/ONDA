import { eq } from 'drizzle-orm';
import { getMessaging } from 'firebase-admin/messaging';
import { db } from '../db/client.js';
import { notifications, users } from '../db/schema.js';
import { firebaseAuth } from '../lib/firebase.js';
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

/**
 * Writes an in-app notification row and (best-effort) sends a push via FCM.
 * The token stored on users.fcm_token is now a raw FCM registration token
 * obtained by @react-native-firebase/messaging on the client.
 */
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

  // Ensure Firebase Admin is initialised (push uses the same app as auth).
  firebaseAuth();

  try {
    await getMessaging().send({
      token: user.fcmToken,
      notification: { title, body },
      data: stringifyData({ type, ...(data ?? {}) }),
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    // Token no longer valid — clear it so we stop trying.
    if (
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token'
    ) {
      await db.update(users).set({ fcmToken: null }).where(eq(users.id, userId));
      logger.info({ userId }, 'Cleared invalid FCM token');
      return;
    }
    logger.warn({ err }, 'FCM push error');
  }
}

function stringifyData(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}
