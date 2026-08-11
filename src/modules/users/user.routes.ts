import { Router } from 'express';
import { asyncHandler } from '../../common/asyncHandler.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { get, list, remove, update } from './user.controller.js';

export const userRouter = Router();

userRouter.use('/users', requireAuth, requireRole('ADMIN'));

userRouter.get('/users', asyncHandler(list));
userRouter.get('/users/:id', asyncHandler(get));
userRouter.patch('/users/:id', asyncHandler(update));
userRouter.delete('/users/:id', asyncHandler(remove));
