import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  AuditAction,
  UserIdentifierType,
  UserStatus,
} from '../generated/prisma/enums';
import { PasswordService } from './password.service';

type BootstrapInput = {
  username: string;
  email?: string | null;
  password: string;
};

type BreakGlassInput = {
  username: string;
  password: string;
  reason: string;
};

export type SuperAdminBootstrapResult =
  | { status: 'created'; username: string; userId: string }
  | { status: 'already_exists'; username: string; userId: string };

export type SuperAdminBreakGlassResult = {
  status: 'reset';
  username: string;
  userId: string;
};

@Injectable()
export class SuperAdminLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async bootstrapCreateOnly(input: BootstrapInput): Promise<SuperAdminBootstrapResult> {
    const username = input.username.trim();
    const email = input.email?.trim().toLowerCase() || null;
    if (!username) throw new Error('SUPER_ADMIN username is required.');

    const [role, security, registration] = await Promise.all([
      this.prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } }),
      this.prisma.systemSecurityConfig.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.systemRegistrationConfig.findUniqueOrThrow({ where: { id: 1 } }),
    ]);
    this.validatePasswordLength(input.password, security.passwordMinLength, security.passwordMaxLength, 'SUPER_ADMIN_PASSWORD');

    const existing = await this.prisma.user.findUnique({
      where: { username },
      include: { roles: { include: { role: true } } },
    });
    if (existing) {
      if (!existing.roles.some((item) => item.role.name === 'SUPER_ADMIN')) {
        throw new Error('Refusing to bootstrap over an existing non-SUPER_ADMIN username.');
      }
      return { status: 'already_exists', username: existing.username, userId: existing.id };
    }

    const passwordHash = await this.passwords.hash(input.password);
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            username,
            email,
            passwordHash,
            status: UserStatus.ACTIVE,
            mustChangePassword: true,
          },
        });
        await tx.userRole.create({ data: { userId: created.id, roleId: role.id } });
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
      return { status: 'created', username: user.username, userId: user.id };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new Error('SUPER_ADMIN username or email conflicts with an existing identity.');
      }
      throw error;
    }
  }

  async breakGlassReset(input: BreakGlassInput): Promise<SuperAdminBreakGlassResult> {
    const username = input.username.trim();
    const reason = input.reason.trim();
    if (!username) throw new Error('SUPER_ADMIN username is required.');
    if (!reason) throw new Error('BREAK_GLASS_REASON is required.');

    const security = await this.prisma.systemSecurityConfig.findUniqueOrThrow({ where: { id: 1 } });
    this.validatePasswordLength(
      input.password,
      security.passwordMinLength,
      security.passwordMaxLength,
      'BREAK_GLASS_SUPER_ADMIN_PASSWORD',
    );

    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new Error('SUPER_ADMIN user was not found.');
    if (!user.roles.some((item) => item.role.name === 'SUPER_ADMIN')) {
      throw new Error('Refusing to reset a user without the SUPER_ADMIN role.');
    }
    if (await this.passwords.verify(user.passwordHash, input.password)) {
      throw new Error('Emergency password must differ from the current password.');
    }

    const passwordHash = await this.passwords.hash(input.password);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
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
        data: { revokedAt: now, revocationReason: 'break_glass_password_reset' },
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

    return { status: 'reset', username: user.username, userId: user.id };
  }

  private validatePasswordLength(password: string, min: number, max: number, label: string): void {
    const length = Array.from(password).length;
    if (length < min || length > max) {
      throw new Error(`${label} must be between ${min} and ${max} characters.`);
    }
  }
}
