import PgBoss from 'pg-boss';
import { and, eq, lt, sql } from 'drizzle-orm';

import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { db } from '../db/client.js';
import { payments } from '../db/schema.js';
import { snapshotMonthly } from '../services/trustScore.js';

let boss: PgBoss | null = null;

const QUEUE = {
  expireCashWindow: 'expire-cash-window',
  monthlyTrust: 'monthly-trust-snapshot',
  markOverdue: 'mark-overdue',
} as const;

export async function startJobs(): Promise<void> {
  boss = new PgBoss({ connectionString: env.DATABASE_URL });
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));
  await boss.start();

  // pg-boss v10 requires queues to be created before work() / schedule().
  for (const name of Object.values(QUEUE)) {
    await boss.createQueue(name);
  }

  await boss.work(QUEUE.expireCashWindow, async () => {
    const now = new Date();
    const expired = await db
      .update(payments)
      .set({ status: 'failed' })
      .where(and(eq(payments.status, 'pending'), lt(payments.expiresAt, now)))
      .returning({ id: payments.id });
    if (expired.length) logger.info({ count: expired.length }, 'Expired pending payments');
  });

  await boss.work(QUEUE.monthlyTrust, async () => {
    await snapshotMonthly();
    logger.info('Monthly trust score snapshot complete');
  });

  await boss.work(QUEUE.markOverdue, async () => {
    const now = new Date();
    // Mark active events overdue when any schedule item is past due and unpaid.
    // Simple approximation: status active + no payment recorded in 30+ days.
    const r = await db.execute(sql`
      update credit_events
      set status = 'overdue', updated_at = now()
      where status = 'active'
        and updated_at < ${new Date(now.getTime() - 30 * 86400_000)}
    `);
    logger.info({ rows: r.rowCount }, 'Marked overdue events');
  });

  await boss.schedule(QUEUE.expireCashWindow, '*/15 * * * *');
  await boss.schedule(QUEUE.markOverdue, '0 * * * *');
  await boss.schedule(QUEUE.monthlyTrust, '0 1 1 * *');

  logger.info('Background jobs scheduled');
}

export async function stopJobs(): Promise<void> {
  await boss?.stop();
}
