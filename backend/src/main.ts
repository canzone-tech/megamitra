import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap/configure-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const port = Number(process.env.PORT ?? 3100);
  // Ubuntu VPS services set HOST=127.0.0.1 so the API cannot be reached
  // directly from the internet. Existing CI/development defaults are preserved.
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);
  console.log(`MegaGoldenClub API listening on ${host}:${port}`);
}

void bootstrap();
