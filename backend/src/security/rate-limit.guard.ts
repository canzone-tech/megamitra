import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { RedisService } from '../redis/redis.service';

type RateLimitRule = {
  bucket: 'global' | 'auth' | 'recovery';
  limit: number;
  windowMs: number;
};

const INCREMENT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
`;

const RECOVERY_PATHS = new Set([
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/email-verification/request',
  '/auth/email-verification/confirm',
  '/auth/email-change/confirm',
]);

const AUTH_PATHS = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
]);

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.config.get<boolean>('RATE_LIMIT_ENABLED') === false) return true;
    if (
      this.config.get<string>('NODE_ENV') === 'test' &&
      this.config.get<boolean>('RATE_LIMIT_TEST_ENABLED') !== true
    ) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    if (request.method === 'OPTIONS') return true;

    const path = (request.path || request.url || '/').split('?')[0] ?? '/';
    if (path.startsWith('/health')) return true;

    const rule = this.ruleFor(path);
    const identity = request.ip || request.socket.remoteAddress || 'unknown';
    const identityHash = createHash('sha256').update(identity).digest('hex');
    const routeHash = createHash('sha256').update(path).digest('hex').slice(0, 16);
    const key = `megamitra:rate:${rule.bucket}:${routeHash}:${identityHash}`;

    const result = (await this.redis
      .getClient()
      .eval(INCREMENT_SCRIPT, 1, key, String(rule.windowMs))) as unknown;
    const tuple = Array.isArray(result) ? result : [];
    const count = Number(tuple[0] ?? 0);
    const ttlMs = Math.max(1, Number(tuple[1] ?? rule.windowMs));
    const remaining = Math.max(0, rule.limit - count);
    const resetSeconds = Math.max(1, Math.ceil(ttlMs / 1000));

    response.setHeader('RateLimit-Limit', String(rule.limit));
    response.setHeader('RateLimit-Remaining', String(remaining));
    response.setHeader('RateLimit-Reset', String(resetSeconds));

    if (count > rule.limit) {
      response.setHeader('Retry-After', String(resetSeconds));
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          errorCode: 'RATE_LIMITED',
          message: 'Too many requests. Please retry later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private ruleFor(path: string): RateLimitRule {
    if (RECOVERY_PATHS.has(path)) {
      return {
        bucket: 'recovery',
        limit: this.number('RATE_LIMIT_RECOVERY_MAX', 10),
        windowMs: this.number('RATE_LIMIT_RECOVERY_WINDOW_MS', 900_000),
      };
    }
    if (AUTH_PATHS.has(path)) {
      return {
        bucket: 'auth',
        limit: this.number('RATE_LIMIT_AUTH_MAX', 30),
        windowMs: this.number('RATE_LIMIT_AUTH_WINDOW_MS', 300_000),
      };
    }
    return {
      bucket: 'global',
      limit: this.number('RATE_LIMIT_GLOBAL_MAX', 600),
      windowMs: this.number('RATE_LIMIT_GLOBAL_WINDOW_MS', 60_000),
    };
  }

  private number(key: string, fallback: number): number {
    const value = Number(this.config.get<number>(key) ?? fallback);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
