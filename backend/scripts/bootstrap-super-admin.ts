import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { PrismaService } from '../src/database/prisma.service';
import { UserStatus } from '../src/generated/prisma/enums';

async function run() {
  const username = process.env.SUPER_ADMIN_USERNAME?.trim();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase() || null;
  if (!username || !password || password.length < 12) {
    throw new Error('Set SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD (minimum 12 characters) in .env before bootstrapping.');
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const prisma = app.get(PrismaService);
    const passwords = app.get(PasswordService);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });
    const passwordHash = await passwords.hash(password);
    const user = await prisma.user.upsert({
      where: { username },
      update: { email, passwordHash, status: UserStatus.ACTIVE, mustChangePassword: true },
      create: { username, email, passwordHash, status: UserStatus.ACTIVE, mustChangePassword: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
    console.log(`MegaMitra SUPER_ADMIN ready: ${user.username}`);
  } finally {
    await app.close();
  }
}

void run();
