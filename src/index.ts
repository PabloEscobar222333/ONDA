import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';

import { env } from './lib/env.js';
import { logger } from './lib/logger.js';
import { ok } from './lib/response.js';
import { onError, onNotFound } from './middleware/error.js';

import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { merchantRoutes } from './routes/merchant.js';
import { creditEventRoutes } from './routes/creditEvents.js';
import { paymentRoutes } from './routes/payments.js';
import { customerRoutes } from './routes/customer.js';
import { trustRoutes } from './routes/trust.js';
import { disputeRoutes } from './routes/disputes.js';
import { notificationRoutes } from './routes/notifications.js';

import { startJobs } from './jobs/index.js';

const app = new Hono().basePath('/v1');

app.use('*', cors());
app.use('*', honoLogger((msg) => logger.debug(msg)));

app.get('/health', (c) => ok(c, { status: 'ok', uptime: process.uptime() }));

app.route('/auth', authRoutes);
app.route('/users', userRoutes);
app.route('/merchant', merchantRoutes);
app.route('/credit-events', creditEventRoutes);
app.route('/payments', paymentRoutes);
app.route('/customer', customerRoutes);
app.route('/customer/trust-score', trustRoutes);
app.route('/disputes', disputeRoutes);
app.route('/notifications', notificationRoutes);

app.onError(onError);
app.notFound(onNotFound);

const server = serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
  logger.info({ port: info.port }, 'ONDA API listening');
});

startJobs().catch((err) => {
  logger.error({ err }, 'Failed to start background jobs');
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutting down…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
