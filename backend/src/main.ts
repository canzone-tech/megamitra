import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap/configure-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const port = Number(process.env.PORT ?? 3100);
  await app.listen(port);
  console.log(`MegaGoldenClub API listening on http://localhost:${port}`);
}

void bootstrap();
