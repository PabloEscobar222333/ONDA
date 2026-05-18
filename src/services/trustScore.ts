import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { creditEvents, customerProfiles, disputes, payments, trustScoreHistory } from '../db/schema.js';
import { newId } from '../lib/id.js';

const CARD_BASE = 20;

function ratingFor(score: number): 'Building' | 'Fair' | 'Good' | 'Excellent' {
  if (score >= 85) return 'Excellent';
  if (score >= 65) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Building';
}

export type TrustBreakdown = {
  totalPaymentsMade: number;
  paystackVerifiedCount: number;
  cashConfirmedInitialDepositsCount: number;
  onTimeRatePct: number;
  disputesRaised: number;
};

export async function computeTrustScore(userId: string): Promise<{ score: number; rating: 'Building' | 'Fair' | 'Good' | 'Excellent'; breakdown: TrustBreakdown }> {
  const customerEvents = await db
    .select({ id: creditEvents.id, status: creditEvents.status })
    .from(creditEvents)
    .where(eq(creditEvents.customerId, userId));

  const eventIds = customerEvents.map((e) => e.id);
  if (!eventIds.length) {
    return {
      score: CARD_BASE,
      rating: 'Building',
      breakdown: {
        totalPaymentsMade: 0,
        paystackVerifiedCount: 0,
        cashConfirmedInitialDepositsCount: 0,
        onTimeRatePct: 0,
        disputesRaised: 0,
      },
    };
  }

  const allPayments = await db
    .select()
    .from(payments)
    .where(eq(payments.status, 'confirmed'));
  const eventSet = new Set(eventIds);
  const confirmed = allPayments.filter((p) => eventSet.has(p.creditEventId));

  const paystackVerified = confirmed.filter((p) => !!p.paystackReference);
  const cashInitialConfirmed = confirmed.filter((p) => p.method === 'cash' && p.isInitialDeposit);
  const manualConfirmed = confirmed.filter((p) => !p.paystackReference && !(p.method === 'cash' && p.isInitialDeposit));

  const onTimeRate = (() => {
    let totalDue = 0;
    let onTime = 0;
    for (const e of customerEvents) {
      if (e.status === 'closed') totalDue++; // simplistic: closed events count as on-time
      if (e.status === 'overdue') totalDue++;
      if (e.status === 'closed') onTime++;
    }
    return totalDue === 0 ? 0 : Math.round((onTime / totalDue) * 100);
  })();

  const disputeRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(disputes)
    .where(eq(disputes.raisedByUserId, userId));
  const disputesRaised = disputeRows[0]?.n ?? 0;

  const breakdown: TrustBreakdown = {
    totalPaymentsMade: confirmed.length,
    paystackVerifiedCount: paystackVerified.length,
    cashConfirmedInitialDepositsCount: cashInitialConfirmed.length,
    onTimeRatePct: onTimeRate,
    disputesRaised,
  };

  let score = CARD_BASE;
  score += paystackVerified.length * 5;
  score += cashInitialConfirmed.length * 2.5;
  score += manualConfirmed.length * 2.5;
  score += Math.round(onTimeRate * 0.2);
  score -= disputesRaised * 5;
  score = Math.max(0, Math.min(100, Math.round(score)));

  return { score, rating: ratingFor(score), breakdown };
}

export async function recalcAndStoreTrustScore(userId: string): Promise<{ score: number; rating: 'Building' | 'Fair' | 'Good' | 'Excellent' }> {
  const { score, rating } = await computeTrustScore(userId);
  await db
    .update(customerProfiles)
    .set({ trustScore: score, trustRating: rating, updatedAt: new Date() })
    .where(eq(customerProfiles.userId, userId));
  return { score, rating };
}

export async function getHistory(userId: string, months = 6): Promise<{ period: string; score: number }[]> {
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const rows = await db
    .select({ period: trustScoreHistory.period, score: trustScoreHistory.score })
    .from(trustScoreHistory)
    .where(and(eq(trustScoreHistory.userId, userId), gte(trustScoreHistory.snapshotAt, since)))
    .orderBy(trustScoreHistory.period);
  return rows;
}

export async function snapshotMonthly(): Promise<void> {
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM
  const customers = await db.select({ userId: customerProfiles.userId }).from(customerProfiles);
  for (const c of customers) {
    const { score } = await computeTrustScore(c.userId);
    await db
      .insert(trustScoreHistory)
      .values({ id: newId('th'), userId: c.userId, period, score })
      .onConflictDoUpdate({
        target: [trustScoreHistory.userId, trustScoreHistory.period],
        set: { score, snapshotAt: new Date() },
      });
  }
}
