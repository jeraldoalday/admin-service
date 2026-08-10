import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client.js';
import { config } from '../config/index.js';

// DATABASE_URL uses the "file:" prefix for the Prisma CLI/migrations, but the
// better-sqlite3 driver adapter takes a plain filesystem path at runtime.
const sqliteFilePath = config.database.url.replace(/^file:/, '');
const adapter = new PrismaBetterSqlite3({ url: sqliteFilePath });

export const prisma = new PrismaClient({
  adapter,
  log: config.isProduction ? ['error', 'warn'] : ['warn'],
});
