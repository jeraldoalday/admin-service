import rateLimit, { type Options, type RateLimitRequestHandler } from 'express-rate-limit';
import { config } from '../config/index.js';

export function createRateLimiter(overrides: Partial<Options> = {}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
    },
    ...overrides,
  });
}

// Relaxed in tests so integration suites that register/login many users in a
// tight loop don't trip the limiter; the limiter itself is still exercised
// directly in tests/rateLimit.test.ts.
export const authRateLimiter = createRateLimiter({ limit: config.isTest ? 1000 : 20 });

// API keys are bearer-style secrets checked by direct hash lookup, so nothing
// about a wrong X-API-Key value is throttled by default the way login attempts
// are. This caps guess attempts against /service/* the same way authRateLimiter
// caps login/register attempts.
export const serviceRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  limit: config.isTest ? 1000 : 60,
});
