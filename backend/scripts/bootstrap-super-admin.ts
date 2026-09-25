import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { PrismaService } from '../src/database/prisma.service';
import {
  UserIdentifierType,
  UserStatus,
} from '../src/generated/prisma/enums';

async function run() {
  const username = process.env.SUPER_ADMIN_USERNAME?.trim();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase() || null;

  if (!username || !password) {
    throw new Error(
      'Set SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD before bootstrapping.',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const prisma = app.get(PrismaService);
    const passwords = app.get(PasswordService);
    const [role, security, registration] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } }),
      prisma.systemSecurityConfig.findUniqueOrThrow({ where: { id: 1 } }),
      prisma.systemRegistrationConfig.findUniqueOrThrow({ where: { id: 1 } }),
    ]);

    const passwordLength = Array.from(password).length;
    if (
      passwordLength < security.passwordMinLength ||
      passwordLength > security.passwordMaxLength
    ) {
      throw new Error(
        `SUPER_ADMIN_PASSWORD must be between ${security.passwordMinLength} and ${security.passwordMaxLength} characters.`,
      );
    }

    const existing = await prisma.user.findUnique({
      where: { username },
      include: { roles: { include: { role: true } } },
    });

    if (existing) {
      const isSuperAdmin = existing.roles.some(
        (item) => item.role.name === 'SUPER_ADMIN',
      );
      if (!isSuperAdmin) {
        throw new Error(
          'Refusing to bootstrap over an existing non-SUPER_ADMIN username.',
        );
      }
      console.log(
        `MegaGoldenClub SUPER_ADMIN already exists: ${existing.username}. Bootstrap is create-only and did not change credentials.`,
      );
      return;
    }

    const passwordHash = await passwords.hash(password);
    try {
      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            username,
            email,
            passwordHash,
            status: UserStatus.ACTIVE,
            mustChangePassword: true,
          },
        });
        await tx.userRole.create({
          data: { userId: created.id, roleId: role.id },
        });
        if (email && !registration.allowMultipleAccountsPerEmail) {
          await tx.userIdentifierClaim.create({
            data: {
              userId: created.id,
              type: UserIdentifierType.EMAIL,
              normalizedValue: email,
            },
          });
        }
        return created;
      });
      console.log(`MegaGoldenClub SUPER_ADMIN ready: ${user.username}`);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new Error(
          'SUPER_ADMIN username or email conflicts with an existing identity.',
        );
      }
      throw error;
    }
  } finally {
    await app.close();
  }
}

void run();
