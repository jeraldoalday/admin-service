import { createApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './common/logger.js';
import { prisma } from './db/prisma.js';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, 'admin-service listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'Shutting down gracefully');
  server.close((err) => {
    void prisma.$disconnect().finally(() => {
      if (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
      process.exit(0);
    });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
