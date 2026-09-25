import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SuperAdminLifecycleService } from '../src/auth/super-admin-lifecycle.service';

async function run() {
  const username = process.env.SUPER_ADMIN_USERNAME?.trim();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase() || null;

  if (!username || !password) {
    throw new Error(
      'Set SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD in the invoking environment before bootstrapping.',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const lifecycle = app.get(SuperAdminLifecycleService);
    const result = await lifecycle.bootstrapCreateOnly({ username, email, password });
    if (result.status === 'already_exists') {
      console.log(
        `MegaGoldenClub SUPER_ADMIN already exists: ${result.username}. Bootstrap is create-only and did not change credentials.`,
      );
      return;
    }
    console.log(`MegaGoldenClub SUPER_ADMIN ready: ${result.username}`);
  } finally {
    await app.close();
  }
}

void run();
