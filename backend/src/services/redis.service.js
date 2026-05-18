import Redis from 'ioredis';
import { env } from '../config/env.js';

export function createRedisClient() {
  const redis = new Redis(env.REDIS_URL, {
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  redis.on('connect', () => {
    console.log('🔴 Redis connected');
  });

  redis.on('error', (error) => {
    console.error('🔴 Redis error:', error);
  });

  redis.on('close', () => {
    console.log('🔴 Redis connection closed');
  });

  return redis;
}

export class RedisService {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  async set(key, value, ttl = 3600) {
    const serializedValue = JSON.stringify(value);
    if (ttl > 0) {
      await this.redis.setex(key, ttl, serializedValue);
    } else {
      await this.redis.set(key, serializedValue);
    }
  }

  async get(key) {
    const value = await this.redis.get(key);
    return value ? JSON.parse(value) : null;
  }

  async del(key) {
    return await this.redis.del(key);
  }

  async exists(key) {
    return await this.redis.exists(key);
  }

  async keys(pattern) {
    return await this.redis.keys(pattern);
  }

  async flush() {
    return await this.redis.flushdb();
  }

  // Session management
  async setSession(token, session, ttl) {
    const key = `session:${token}`;
    await this.set(key, session, ttl);
  }

  async getSession(token) {
    const key = `session:${token}`;
    return await this.get(key);
  }

  async deleteSession(token) {
    const key = `session:${token}`;
    return await this.del(key);
  }

  // Cache management
  async setCache(key, data, ttl = 300) {
    const cacheKey = `cache:${key}`;
    await this.set(cacheKey, data, ttl);
  }

  async getCache(key) {
    const cacheKey = `cache:${key}`;
    return await this.get(cacheKey);
  }

  async deleteCache(key) {
    const cacheKey = `cache:${key}`;
    return await this.del(cacheKey);
  }

  // Rate limiting
  async incrementRateLimit(identifier, windowMs, maxRequests) {
    const key = `rate_limit:${identifier}`;
    const current = await this.redis.incr(key);
    
    if (current === 1) {
      await this.redis.expire(key, Math.ceil(windowMs / 1000));
    }
    
    return {
      current,
      remaining: Math.max(0, maxRequests - current),
      resetTime: await this.redis.pttl(key)
    };
  }

  // Queue operations
  async addToQueue(queueName, data, priority = 0) {
    const key = `queue:${queueName}`;
    const item = {
      id: Date.now().toString(),
      data,
      priority,
      createdAt: new Date().toISOString()
    };
    
    await this.redis.zadd(key, priority, JSON.stringify(item));
  }

  async getNextFromQueue(queueName) {
    const key = `queue:${queueName}`;
    const result = await this.redis.zpopmin(key, 1);
    
    if (result.length === 0) {
      return null;
    }
    
    return JSON.parse(result[0].value);
  }

  async getQueueSize(queueName) {
    const key = `queue:${queueName}`;
    return await this.redis.zcard(key);
  }
}
