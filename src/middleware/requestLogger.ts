import { pinoHttp, type Options } from 'pino-http';
import { logger } from '../common/logger.js';

const options: Options = {
  logger,
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  redact: ['req.headers.authorization', 'req.headers.cookie'],
};

export const requestLogger = pinoHttp(options);
