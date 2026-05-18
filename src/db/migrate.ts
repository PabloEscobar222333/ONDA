import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client.js';
import { logger } from '../lib/logger.js';

const run = async () => {
  logger.info('Running database migrations…');
  await migrate(db, { migrationsFolder: './drizzle' });
  logger.info('Migrations complete.');
  await pool.end();
};

run().catch((err) => {
  logger.error({ err }, 'Migration failed');
  process.exit(1);
});
