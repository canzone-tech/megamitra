import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,96}$/;

type RequestHardeningOptions = {
  hstsEnabled: boolean;
};

export function createRequestHardeningMiddleware(options: RequestHardeningOptions) {
  const logger = new Logger('HttpRequest');

  return (request: Request, response: Response, next: NextFunction): void => {
    const supplied = request.headers['x-request-id'];
    const candidate = Array.isArray(supplied) ? supplied[0] : supplied;
    const requestId =
      typeof candidate === 'string' && REQUEST_ID_PATTERN.test(candidate)
        ? candidate
        : randomUUID();
    request.headers['x-request-id'] = requestId;

    response.setHeader('X-Request-Id', requestId);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    if (options.hstsEnabled) {
      response.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    }

    const startedAt = Date.now();
    response.on('finish', () => {
      const path = (request.originalUrl || request.url || '/').split('?')[0] ?? '/';
      if (path === '/health/live') return;
      logger.log(
        `${request.method} ${path} ${response.statusCode} ${Date.now() - startedAt}ms requestId=${requestId}`,
      );
    });

    next();
  };
}
