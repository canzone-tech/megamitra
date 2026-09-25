import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { PrismaService } from '../src/database/prisma.service';
import { AuditAction } from '../src/generated/prisma/enums';

const CONFIRMATION = 'RESET_SUPER_ADMIN_PASSWORD';

async function run() {
  const username = process.env.BREAK_GLASS_SUPER_ADMIN_USERNAME?.trim();
  const password = process.env.BREAK_GLASS_SUPER_ADMIN_PASSWORD;
  const reason = process.env.BREAK_GLASS_REASON?.trim();
  const confirmation = process.env.BREAK_GLASS_CONFIRM?.trim();

  if (!username || !password || !reason) {
    throw new Error(
      'Set BREAK_GLASS_SUPER_ADMIN_USERNAME, BREAK_GLASS_SUPER_ADMIN_PASSWORD, and BREAK_GLASS_REASON for an emergency reset.',
    );
  }
  if (confirmation !== CONFIRMATION) {
    throw new Error(
      `Set BREAK_GLASS_CONFIRM=${CONFIRMATION} to explicitly authorize this emergency reset.`,
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const prisma = app.get(PrismaService);
    const passwords = app.get(PasswordService);
    const security = await prisma.systemSecurityConfig.findUniqueOrThrow({
      where: { id: 1 },
    });

    const passwordLength = Array.from(password).length;
    if (
      passwordLength < security.passwordMinLength ||
      passwordLength > security.passwordMaxLength
    ) {
      throw new Error(
        `BREAK_GLASS_SUPER_ADMIN_PASSWORD must be between ${security.passwordMinLength} and ${security.passwordMaxLength} characters.`,
      );
    }

    const user = await prisma.user.findUnique({
      where: { username },
      include: { roles: { include: { role: true } } },
    });
    if (!user) {
      throw new Error('SUPER_ADMIN user was not found.');
    }
    if (!user.roles.some((item) => item.role.name === 'SUPER_ADMIN')) {
      throw new Error('Refusing to reset a user without the SUPER_ADMIN role.');
    }
    if (await passwords.verify(user.passwordHash, password)) {
      throw new Error('Emergency password must differ from the current password.');
    }

    const passwordHash = await passwords.hash(password);
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          mustChangePassword: true,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: {
          revokedAt: now,
          revocationReason: 'break_glass_password_reset',
        },
      });
      await tx.$executeRawUnsafe(
        `UPDATE auth_action_tokens
         SET invalidatedAt = ?
         WHERE userId = ? AND consumedAt IS NULL AND invalidatedAt IS NULL`,
        now,
        user.id,
      );
      await tx.auditLog.create({
        data: {
          action: AuditAction.PASSWORD_CHANGE,
          entityType: 'User',
          entityId: user.id,
          description: 'Break-glass SUPER_ADMIN password reset',
          metadata: {
            operation: 'break_glass_super_admin_password_reset',
            username: user.username,
            reason,
          },
        },
      });
    });

    console.log(
      `MegaGoldenClub break-glass reset completed for SUPER_ADMIN ${user.username}. All active sessions were revoked and password change is required at next login.`,
    );
  } finally {
    await app.close();
  }
}

void run();
