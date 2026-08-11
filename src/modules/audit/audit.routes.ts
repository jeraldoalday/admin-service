import { Router } from 'express';
import { asyncHandler } from '../../common/asyncHandler.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { list } from './audit.controller.js';

export const auditRouter = Router();

auditRouter.get('/audit-logs', requireAuth, requireRole('ADMIN'), asyncHandler(list));
