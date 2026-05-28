import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { firebaseAuth } from '../lib/firebase.js';
import { fail } from '../lib/response.js';

declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    role?: 'merchant' | 'customer';
  }
}

/**
 * Verifies a Firebase ID token issued by Google, Apple, or Email/Password
 * sign-in on the client. The Firebase UID is the canonical user identity
 * across all providers (linked accounts share a UID).
 *
 * On first sight of a UID we DO NOT upsert here — clients must call
 * POST /auth/sync after sign-in so the row gets created with full provider
 * metadata (email, name, photo, provider list). Requests that reach this
 * middleware without a matching users row are rejected so handlers can rely
 * on `c.get('userId')` referring to an existing row.
 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return fail(c, 401, 'Missing or invalid Authorization header');
  }
  const token = header.slice(7);

  let uid: string;
  try {
    const decoded = await firebaseAuth().verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return fail(c, 401, 'Invalid or expired token');
  }

  const [user] = await db.select().from(users).where(eq(users.id, uid)).limit(1);
  if (!user) {
    return fail(c, 401, 'User not synced. Call POST /auth/sync first.');
  }

  c.set('userId', user.id);
  if (user.activeRole) c.set('role', user.activeRole);

  await next();
};

export const requireRole =
  (role: 'merchant' | 'customer'): MiddlewareHandler =>
  async (c, next) => {
    if (c.get('role') !== role) {
      return fail(c, 403, `Requires ${role} role`);
    }
    await next();
  };
