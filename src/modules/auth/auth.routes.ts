import { Router } from 'express';
import { asyncHandler } from '../../common/asyncHandler.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { login, me, refresh, register } from './auth.controller.js';

export const authRouter = Router();

authRouter.post('/auth/register', asyncHandler(register));
authRouter.post('/auth/login', asyncHandler(login));
authRouter.post('/auth/refresh', asyncHandler(refresh));
authRouter.get('/auth/me', requireAuth, asyncHandler(me));
