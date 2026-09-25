import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SuperAdminLifecycleService } from '../src/auth/super-admin-lifecycle.service';

const CONFIRMATION = 'RESET_SUPER_ADMIN_PASSWORD';

async function run() {
  const username = process.env.BREAK_GLASS_SUPER_ADMIN_USERNAME?.trim();
  const password = process.env.BREAK_GLASS_SUPER_ADMIN_PASSWORD;
  const reason = process.env.BREAK_GLASS_REASON?.trim();
  const confirmation = process.env.BREAK_GLASS_CONFIRM?.trim();

  if (!username || !password || !reason) {
    throw new Error(
      'Set BREAK_GLASS_SUPER_ADMIN_USERNAME, BREAK_GLASS_SUPER_ADMIN_PASSWORD, and BREAK_GLASS_REASON in the invoking environment for an emergency reset.',
    );
  }
  if (confirmation !== CONFIRMATION) {
    throw new Error(
      `Set BREAK_GLASS_CONFIRM=${CONFIRMATION} to explicitly authorize this emergency reset.`,
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const lifecycle = app.get(SuperAdminLifecycleService);
    const result = await lifecycle.breakGlassReset({ username, password, reason });
    console.log(
      `MegaGoldenClub break-glass reset completed for SUPER_ADMIN ${result.username}. All active sessions were revoked and password change is required at next login.`,
    );
  } finally {
    await app.close();
  }
}

void run();
