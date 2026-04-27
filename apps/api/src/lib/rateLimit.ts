import RedisStore from 'rate-limit-redis';
import rateLimit from 'express-rate-limit';
import { redis } from './queue';

/**
 * Rate limiting middleware factory
 * Allows configuring different limits for different endpoints
 */

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  max: number; // Max requests per window
  message?: string;
  keyGenerator?: (req: any) => string;
}

const defaultConfig: RateLimitConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
};

/**
 * Create a rate limit middleware for a specific endpoint
 * Uses Redis as store for distributed rate limiting
 */
export function createRateLimiter(config: Partial<RateLimitConfig> = {}) {
  const finalConfig = { ...defaultConfig, ...config };

  return rateLimit({
    store: new RedisStore({
      client: redis,
      prefix: 'ratelimit:',
    }),
    windowMs: finalConfig.windowMs,
    max: finalConfig.max,
    message: finalConfig.message || 'Too many requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        error: 'Too Many Requests',
        message: finalConfig.message || 'Too many requests, please try again later',
        retryAfter: req.rateLimit?.resetTime,
      });
    },
    keyGenerator: finalConfig.keyGenerator || ((req) => {
      // Use IP address as default key
      return (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip || 'unknown';
    }),
  });
}

/**
 * Predefined rate limiters for common endpoints
 */

// Auth endpoints: strict limits to prevent brute force
export const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 requests per 15 minutes
  message: 'Too many login attempts, please try again later',
});

// API endpoints: moderate limits
export const apiLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100, // 100 requests per 15 minutes
});

// Webhook endpoints: higher limits (they're trusted)
export const webhookLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 1000, // 1000 requests per minute
});

// Admin endpoints: strict limits
export const adminLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 50, // 50 requests per minute
  keyGenerator: (req) => {
    // Rate limit by user ID for admins, not IP
    return `admin:${req.user?.id || req.ip}`;
  },
});

// File upload endpoints: stricter limits
export const uploadLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10, // 10 uploads per minute
  message: 'Upload limit exceeded, please wait before uploading again',
});

// Create custom limiter with user-based key
export function createUserLimiter(config: Partial<RateLimitConfig> = {}) {
  return createRateLimiter({
    ...config,
    keyGenerator: (req) => {
      // Rate limit per user (authenticated endpoints)
      return req.user?.id || req.ip || 'unknown';
    },
  });
}
