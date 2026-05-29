import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { customerProfiles, merchantProfiles, userRoles, users } from '../db/schema.js';
import { env } from '../lib/env.js';
import { getSignedUrl } from './storage.js';

export type UserProfileResponse = {
  userId: string;
  email: string | null;
  fullName: string | null;
  photoUrl: string | null;
  providers: string[];
  phoneNumber: string | null;
  displayName: string | null;
  roles: ('merchant' | 'customer')[];
  activeRole: 'merchant' | 'customer' | null;
  createdAt: string;
  merchantProfile?: Awaited<ReturnType<typeof getMerchantProfile>>;
  customerProfile?: Awaited<ReturnType<typeof getCustomerProfile>>;
};

export async function getUserProfile(userId: string): Promise<UserProfileResponse | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;

  const roles = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId));
  const roleList = roles.map((r) => r.role);

  const merchantProfile = roleList.includes('merchant') ? await getMerchantProfile(userId) : undefined;
  const customerProfile = roleList.includes('customer') ? await getCustomerProfile(userId) : undefined;

  return {
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    photoUrl: user.photoUrl,
    providers: user.providers,
    phoneNumber: user.phoneNumber,
    displayName: user.displayName,
    roles: roleList,
    activeRole: user.activeRole,
    createdAt: user.createdAt.toISOString(),
    merchantProfile,
    customerProfile,
  };
}

export async function getMerchantProfile(userId: string) {
  const [p] = await db.select().from(merchantProfiles).where(eq(merchantProfiles.userId, userId)).limit(1);
  if (!p) return null;

  // Mint a fresh signed URL for the profile photo on every read — we store only
  // the object key, never an expiring URL. Best-effort: a stale/missing object
  // shouldn't break the whole profile fetch.
  let photoUrl: string | null = null;
  if (p.profilePhotoKey) {
    try {
      photoUrl = await getSignedUrl(env.SUPABASE_BUCKET_KYC, p.profilePhotoKey);
    } catch {
      photoUrl = null;
    }
  }

  return {
    businessName: p.businessName,
    businessType: p.businessType,
    ownerName: p.ownerName,
    location: p.location,
    region: p.region,
    digitalAddress: p.digitalAddress,
    photoUrl,
    kycVerified: p.kycVerified,
    settlementType: p.settlementType,
    settlementDetails: p.settlementDetails,
    settlementVerified: p.settlementVerified,
    kycSubmitted: !!p.kycSubmittedAt,
    activated: p.activated,
  };
}

export async function getCustomerProfile(userId: string) {
  const [p] = await db.select().from(customerProfiles).where(eq(customerProfiles.userId, userId)).limit(1);
  if (!p) return null;
  return {
    fullName: p.fullName,
    trustScore: p.trustScore,
    trustRating: p.trustRating,
  };
}
