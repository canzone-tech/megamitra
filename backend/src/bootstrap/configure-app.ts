import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiExceptionFilter } from '../http/api-exception.filter';
import { createRequestHardeningMiddleware } from '../http/request-hardening.middleware';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RateLimitGuard } from '../security/rate-limit.guard';

type ExpressLikeApplication = {
  disable?: (key: string) => void;
  set?: (key: string, value: unknown) => void;
};

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  const platform = app.getHttpAdapter().getInstance() as ExpressLikeApplication;
  platform.disable?.('x-powered-by');

  const trustProxyHops = Number(config.get<number>('TRUST_PROXY_HOPS') ?? 0);
  if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
    platform.set?.('trust proxy', trustProxyHops);
  }

  app.use(
    createRequestHardeningMiddleware({
      hstsEnabled: config.get<boolean>('SECURITY_HSTS_ENABLED') === true,
    }),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      validationError: { target: false, value: false },
    }),
  );
  app.useGlobalFilters(
    new ApiExceptionFilter(app.get(HttpAdapterHost)),
  );
  app.useGlobalGuards(
    app.get(RateLimitGuard),
    app.get(JwtAuthGuard),
    app.get(PermissionsGuard),
  );
  app.enableShutdownHooks();
}
