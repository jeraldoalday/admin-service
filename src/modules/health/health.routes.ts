import { Router } from 'express';
import { asyncHandler } from '../../common/asyncHandler.js';
import { prisma } from '../../db/prisma.js';

export const healthRouter = Router();

const startedAt = Date.now();

healthRouter.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
});

healthRouter.get(
  '/health/ready',
  asyncHandler(async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json({ status: 'ready', database: 'up' });
    } catch {
      res.status(503).json({ status: 'not_ready', database: 'down' });
    }
  }),
);
