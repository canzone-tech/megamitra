import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { PermissionsGuard } from './rbac/permissions.guard';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    validationError: { target: false, value: false },
  }));
  app.useGlobalGuards(app.get(JwtAuthGuard), app.get(PermissionsGuard));
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3100);
  await app.listen(port);
  console.log(`MegaMitra API listening on http://localhost:${port}`);
}

void bootstrap();
