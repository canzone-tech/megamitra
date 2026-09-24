import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { RedisService } from '../redis/redis.service';
import { RateLimitGuard } from './rate-limit.guard';

describe('RateLimitGuard', () => {
  function guardWith(result: [number, number]) {
    const evalMock = jest.fn().mockResolvedValue(result);
    const redis = {
      getClient: () => ({ eval: evalMock }),
    } as unknown as RedisService;
    const values: Record<string, unknown> = {
      NODE_ENV: 'test',
      RATE_LIMIT_ENABLED: true,
      RATE_LIMIT_TEST_ENABLED: true,
      RATE_LIMIT_AUTH_MAX: 2,
      RATE_LIMIT_AUTH_WINDOW_MS: 60000,
      RATE_LIMIT_GLOBAL_MAX: 20,
      RATE_LIMIT_GLOBAL_WINDOW_MS: 60000,
    };
    const config = {
      get: (key: string) => values[key],
    } as unknown as ConfigService;
    return { guard: new RateLimitGuard(redis, config), evalMock };
  }

  function context(path = '/auth/login') {
    const headers: Record<string, string> = {};
    const response = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    } as unknown as Response;
    const request = {
      method: 'POST',
      path,
      url: path,
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;
    const execution = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    return { execution, headers };
  }

  it('allows requests inside the configured bucket', async () => {
    const { guard, evalMock } = guardWith([2, 30000]);
    const { execution, headers } = context();

    await expect(guard.canActivate(execution)).resolves.toBe(true);
    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(headers['RateLimit-Limit']).toBe('2');
    expect(headers['RateLimit-Remaining']).toBe('0');
  });

  it('returns a retryable 429 after the configured limit', async () => {
    const { guard } = guardWith([3, 45000]);
    const { execution, headers } = context();

    let thrown: unknown;
    try {
      await guard.canActivate(execution);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(429);
    expect(headers['Retry-After']).toBe('45');
  });

  it('does not rate-limit health probes', async () => {
    const { guard, evalMock } = guardWith([99, 1000]);
    const { execution } = context('/health/ready');

    await expect(guard.canActivate(execution)).resolves.toBe(true);
    expect(evalMock).not.toHaveBeenCalled();
  });
});
