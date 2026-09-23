import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiExceptionFilter } from '../http/api-exception.filter';
import { PermissionsGuard } from '../rbac/permissions.guard';

export function configureApp(app: INestApplication): void {
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
  app.useGlobalGuards(app.get(JwtAuthGuard), app.get(PermissionsGuard));
  app.enableShutdownHooks();
}
