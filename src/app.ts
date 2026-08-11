import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authRateLimiter } from './middleware/rateLimit.js';
import { requestLogger } from './middleware/requestLogger.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { userRouter } from './modules/users/user.routes.js';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(requestLogger);

  app.use(healthRouter);
  app.use('/auth', authRateLimiter);
  app.use(authRouter);
  app.use(auditRouter);
  app.use(userRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
