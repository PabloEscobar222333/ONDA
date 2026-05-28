import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { firebaseAuth } from '../lib/firebase.js';
import { logger } from '../lib/logger.js';
import { fail, ok } from '../lib/response.js';
import { getUserProfile } from '../services/userProfile.js';

export const authRoutes = new Hono();

const PROVIDER_LABELS: Record<string, string> = {
  'google.com': 'google',
  'apple.com': 'apple',
  password: 'email',
};

/**
 * POST /auth/sync
 *
 * Called by the client immediately after any Firebase sign-in (Google, Apple,
 * or Email/Password). The Authorization header carries the Firebase ID token.
 *
 * Behavior:
 *   - Verify the ID token via Firebase Admin.
 *   - If a users row already exists for this UID, refresh provider metadata
 *     (email, name, photo) and append the current provider to `providers[]`.
 *   - Otherwise create a fresh row.
 *
 * Account linking across providers is handled on the client via Firebase's
 * `linkWithCredential` so a single UID identifies one human across Google,
 * Apple, and Email/Password. The backend therefore only sees one UID per user
 * and does not need to merge rows here.
 *
 * Returns { user, isNewUser, needsRoleSelection }.
 */
authRoutes.post('/sync', async (c) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return fail(c, 401, 'Missing or invalid Authorization header');
  }
  const token = header.slice(7);

  let decoded;
  try {
    decoded = await firebaseAuth().verifyIdToken(token);
  } catch (err) {
    logger.debug({ err }, 'sync: Firebase ID token rejected');
    return fail(c, 401, 'Invalid or expired Firebase token');
  }

  const uid = decoded.uid;
  const email = decoded.email ?? null;
  const fullName = (decoded.name as string | undefined) ?? null;
  const photoUrl = decoded.picture ?? null;
  const providerRaw = decoded.firebase?.sign_in_provider ?? 'unknown';
  const provider = PROVIDER_LABELS[providerRaw] ?? providerRaw;

  const [existing] = await db.select().from(users).where(eq(users.id, uid)).limit(1);

  if (existing) {
    await db
      .update(users)
      .set({
        email: email ?? existing.email,
        fullName: fullName ?? existing.fullName,
        photoUrl: photoUrl ?? existing.photoUrl,
        providers: sql`array(select distinct unnest(${users.providers} || ${[provider]}::text[]))`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, uid));
  } else {
    await db.insert(users).values({
      id: uid,
      email,
      fullName,
      photoUrl,
      providers: [provider],
    });
  }

  const user = await getUserProfile(uid);
  return ok(c, {
    user,
    isNewUser: !existing,
    needsRoleSelection: !user?.activeRole,
  });
});
