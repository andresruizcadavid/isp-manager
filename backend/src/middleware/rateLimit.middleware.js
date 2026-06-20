import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Demasiados intentos. Intenta de nuevo en 15 minutos.'
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

export const globalRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  // Reads are exempt: the SPA polls constantly (dashboard widgets, campaign
  // progress, network monitor) and several operators usually share one office
  // IP, so counting GETs exhausted the budget and 429'd legitimate sessions
  // ("Demasiadas solicitudes" on the clients list). All reads are still
  // behind auth + origin guard; the budget now protects WRITES, and login
  // brute-force has its own stricter authRateLimiter.
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Demasiadas solicitudes. Intenta de nuevo más tarde.'
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});
