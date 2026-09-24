import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { AuditAction, UserIdentifierType } from '../generated/prisma/enums';
import { RedisService } from '../redis/redis.service';
import type { AuthUser } from './auth-user';
import { AuthEmailTemplatePurposeDto } from './auth-email-template.dto';
import {
  ConfirmEmailChangeDto,
  ConfirmEmailVerificationDto,
  ForgotPasswordDto,
  RequestEmailChangeDto,
  RequestEmailVerificationDto,
  ResetPasswordDto,
} from './auth-recovery.dto';
import { PasswordService } from './password.service';
import { SmtpMailService } from './smtp-mail.service';

type AuthExtensionConfigRow = {
  passwordResetEnabled: boolean | number;
  passwordResetTokenTtlMinutes: number;
  passwordResetRequestWindowMinutes: number;
  passwordResetMaxRequestsPerWindow: number;
  emailVerificationEnabled: boolean | number;
  emailVerificationRequiredForLogin: boolean | number;
  emailVerificationTokenTtlMinutes: number;
  emailVerificationRequestWindowMinutes: number;
  emailVerificationMaxRequestsPerWindow: number;
  emailChangeEnabled: boolean | number;
};

export type AuthExtensionConfig = {
  passwordResetEnabled: boolean;
  passwordResetTokenTtlMinutes: number;
  passwordResetRequestWindowMinutes: number;
  passwordResetMaxRequestsPerWindow: number;
  emailVerificationEnabled: boolean;
  emailVerificationRequiredForLogin: boolean;
  emailVerificationTokenTtlMinutes: number;
  emailVerificationRequestWindowMinutes: number;
  emailVerificationMaxRequestsPerWindow: number;
  emailChangeEnabled: boolean;
};

type AuthActionPurpose = 'PASSWORD_RESET' | 'EMAIL_VERIFICATION' | 'EMAIL_CHANGE';

type ActionTokenRow = {
  id: string;
  userId: string;
  purpose: AuthActionPurpose;
  tokenHash: string;
  targetEmail: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
  invalidatedAt: Date | null;
  createdAt: Date;
};

const GENERIC_ACCEPTED = {
  accepted: true,
  message: 'If the account is eligible, the requested email will be sent.',
};

@Injectable()
export class AuthRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly passwords: PasswordService,
    private readonly mail: SmtpMailService,
    private readonly audit: AuditService,
  ) {}

  async getExtensionConfig(): Promise<AuthExtensionConfig> {
    const rows = await this.prisma.$queryRawUnsafe<AuthExtensionConfigRow[]>(
      `SELECT passwordResetEnabled, passwordResetTokenTtlMinutes,
              passwordResetRequestWindowMinutes, passwordResetMaxRequestsPerWindow,
              emailVerificationEnabled, emailVerificationRequiredForLogin,
              emailVerificationTokenTtlMinutes, emailVerificationRequestWindowMinutes,
              emailVerificationMaxRequestsPerWindow, emailChangeEnabled
       FROM system_auth_config
       WHERE id = 1
       LIMIT 1`,
    );
    const row = rows[0];
    if (!row) throw new Error('System authentication configuration is missing');
    return {
      passwordResetEnabled: Boolean(row.passwordResetEnabled),
      passwordResetTokenTtlMinutes: Number(row.passwordResetTokenTtlMinutes),
      passwordResetRequestWindowMinutes: Number(row.passwordResetRequestWindowMinutes),
      passwordResetMaxRequestsPerWindow: Number(row.passwordResetMaxRequestsPerWindow),
      emailVerificationEnabled: Boolean(row.emailVerificationEnabled),
      emailVerificationRequiredForLogin: Boolean(row.emailVerificationRequiredForLogin),
      emailVerificationTokenTtlMinutes: Number(row.emailVerificationTokenTtlMinutes),
      emailVerificationRequestWindowMinutes: Number(row.emailVerificationRequestWindowMinutes),
      emailVerificationMaxRequestsPerWindow: Number(row.emailVerificationMaxRequestsPerWindow),
      emailChangeEnabled: Boolean(row.emailChangeEnabled),
    };
  }

  async publicConfig() {
    const [base, extension, registration] = await Promise.all([
      this.prisma.systemAuthConfig.findUniqueOrThrow({ where: { id: 1 } }),
      this.getExtensionConfig(),
      this.prisma.systemRegistrationConfig.findUniqueOrThrow({ where: { id: 1 } }),
    ]);
    return {
      loginWithUsername: base.loginWithUsername,
      loginWithEmail: base.loginWithEmail,
      loginWithMobile: base.loginWithMobile,
      captchaOnLoginEnabled: base.captchaOnLoginEnabled,
      captchaOnRegistrationEnabled: base.captchaOnRegistrationEnabled,
      publicRegistrationEnabled: registration.publicRegistrationEnabled,
      passwordResetEnabled: extension.passwordResetEnabled,
      emailVerificationEnabled: extension.emailVerificationEnabled,
      emailVerificationRequiredForLogin: extension.emailVerificationRequiredForLogin,
      emailChangeEnabled: extension.emailChangeEnabled,
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = this.normalizeEmail(dto.email);
    const config = await this.getExtensionConfig();
    if (!config.passwordResetEnabled || !this.mail.isConfigured()) return GENERIC_ACCEPTED;
    if (
      await this.rateLimited(
        'password-reset',
        email,
        config.passwordResetRequestWindowMinutes,
        config.passwordResetMaxRequestsPerWindow,
      )
    ) {
      return GENERIC_ACCEPTED;
    }

    const users = await this.prisma.user.findMany({ where: { email }, take: 2 });
    if (users.length !== 1) return GENERIC_ACCEPTED;
    const user = users[0];

    try {
      await this.issueTokenAndMail({
        userId: user.id,
        username: user.username,
        recipient: email,
        purpose: 'PASSWORD_RESET',
        ttlMinutes: config.passwordResetTokenTtlMinutes,
        path: '/reset-password',
      });
    } catch {
      // Public recovery endpoints intentionally do not reveal delivery state.
    }
    return GENERIC_ACCEPTED;
  }

  async resetPassword(dto: ResetPasswordDto) {
    const token = await this.requireActiveToken(dto.token, 'PASSWORD_RESET');
    const security = await this.prisma.systemSecurityConfig.findUniqueOrThrow({ where: { id: 1 } });
    this.validatePassword(dto.newPassword, security.passwordMinLength, security.passwordMaxLength);
    const passwordHash = await this.passwords.hash(dto.newPassword);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.$executeRawUnsafe(
        `UPDATE auth_action_tokens
         SET consumedAt = ?
         WHERE id = ? AND consumedAt IS NULL AND invalidatedAt IS NULL AND expiresAt > ?`,
        now,
        token.id,
        now,
      );
      if (consumed !== 1) throw new BadRequestException('Invalid or expired password reset token');

      await tx.user.update({
        where: { id: token.userId },
        data: {
          passwordHash,
          mustChangePassword: false,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      await tx.authSession.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: now, revocationReason: 'password_reset' },
      });
      await tx.$executeRawUnsafe(
        `UPDATE auth_action_tokens
         SET invalidatedAt = ?
         WHERE userId = ? AND id <> ? AND consumedAt IS NULL AND invalidatedAt IS NULL`,
        now,
        token.userId,
        token.id,
      );
    });

    await this.audit.log({
      actorUserId: token.userId,
      action: AuditAction.PASSWORD_CHANGE,
      entityType: 'User',
      entityId: token.userId,
      description: 'Password reset completed through one-time recovery token',
    });
    return { success: true, sessionsRevoked: true };
  }

  async requestEmailVerification(dto: RequestEmailVerificationDto) {
    const email = this.normalizeEmail(dto.email);
    const config = await this.getExtensionConfig();
    if (!config.emailVerificationEnabled || !this.mail.isConfigured()) return GENERIC_ACCEPTED;
    if (
      await this.rateLimited(
        'email-verification',
        email,
        config.emailVerificationRequestWindowMinutes,
        config.emailVerificationMaxRequestsPerWindow,
      )
    ) {
      return GENERIC_ACCEPTED;
    }

    const users = await this.prisma.user.findMany({ where: { email }, take: 2 });
    if (users.length !== 1 || users[0].emailVerifiedAt) return GENERIC_ACCEPTED;
    const user = users[0];
    try {
      await this.issueTokenAndMail({
        userId: user.id,
        username: user.username,
        recipient: email,
        purpose: 'EMAIL_VERIFICATION',
        targetEmail: email,
        ttlMinutes: config.emailVerificationTokenTtlMinutes,
        path: '/verify-email',
      });
    } catch {
      // Public verification requests intentionally do not reveal delivery state.
    }
    return GENERIC_ACCEPTED;
  }

  async sendRegistrationVerification(userId: string): Promise<void> {
    const config = await this.getExtensionConfig();
    if (!config.emailVerificationEnabled || !this.mail.isConfigured()) return;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.email || user.emailVerifiedAt) return;
    try {
      await this.issueTokenAndMail({
        userId: user.id,
        username: user.username,
        recipient: user.email,
        purpose: 'EMAIL_VERIFICATION',
        targetEmail: this.normalizeEmail(user.email),
        ttlMinutes: config.emailVerificationTokenTtlMinutes,
        path: '/verify-email',
      });
    } catch {
      // Registration itself remains durable even when SMTP delivery is temporarily unavailable.
    }
  }

  async confirmEmailVerification(dto: ConfirmEmailVerificationDto) {
    const token = await this.requireActiveToken(dto.token, 'EMAIL_VERIFICATION');
    if (!token.targetEmail) throw new BadRequestException('Invalid email verification token');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: token.userId } });
    if (this.normalizeEmail(user.email ?? '') !== this.normalizeEmail(token.targetEmail)) {
      await this.invalidateToken(token.id);
      throw new BadRequestException('Email verification token no longer matches the account email');
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.$executeRawUnsafe(
        `UPDATE auth_action_tokens
         SET consumedAt = ?
         WHERE id = ? AND consumedAt IS NULL AND invalidatedAt IS NULL AND expiresAt > ?`,
        now,
        token.id,
        now,
      );
      if (consumed !== 1) throw new BadRequestException('Invalid or expired email verification token');
      await tx.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: now } });
      await tx.$executeRawUnsafe(
        `UPDATE auth_action_tokens
         SET invalidatedAt = ?
         WHERE userId = ? AND purpose = 'EMAIL_VERIFICATION' AND id <> ?
           AND consumedAt IS NULL AND invalidatedAt IS NULL`,
        now,
        token.userId,
        token.id,
      );
    });
    await this.audit.log({
      actorUserId: token.userId,
      action: AuditAction.UPDATE,
      entityType: 'User',
      entityId: token.userId,
      description: 'Email address verified',
    });
    return { success: true, emailVerified: true };
  }

  async requestEmailChange(user: AuthUser, dto: RequestEmailChangeDto) {
    const config = await this.getExtensionConfig();
    if (!config.emailChangeEnabled) throw new ForbiddenException('Email change is disabled');
    if (!this.mail.isConfigured()) throw new ServiceUnavailableException('SMTP delivery is not configured');
    if (
      await this.rateLimited(
        'email-change',
        user.id,
        config.emailVerificationRequestWindowMinutes,
        config.emailVerificationMaxRequestsPerWindow,
      )
    ) {
      throw new HttpException('Too many email change requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    const account = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const validPassword = await this.passwords.verify(account.passwordHash, dto.currentPassword);
    if (!validPassword) throw new ForbiddenException('Current password is incorrect');

    const targetEmail = this.normalizeEmail(dto.newEmail);
    if (account.email && this.normalizeEmail(account.email) === targetEmail) {
      throw new BadRequestException('New email must be different from the current email');
    }
    await this.assertEmailAvailable(targetEmail, user.id);

    await this.issueTokenAndMail({
      userId: user.id,
      username: account.username,
      recipient: targetEmail,
      purpose: 'EMAIL_CHANGE',
      targetEmail,
      ttlMinutes: config.emailVerificationTokenTtlMinutes,
      path: '/confirm-email-change',
      extraVariables: { pendingEmail: targetEmail },
    });
    return { accepted: true, message: 'A confirmation link was sent to the new email address.' };
  }

  async confirmEmailChange(dto: ConfirmEmailChangeDto) {
    const token = await this.requireActiveToken(dto.token, 'EMAIL_CHANGE');
    if (!token.targetEmail) throw new BadRequestException('Invalid email change token');
    const targetEmail = this.normalizeEmail(token.targetEmail);
    await this.assertEmailAvailable(targetEmail, token.userId);
    const registration = await this.prisma.systemRegistrationConfig.findUniqueOrThrow({ where: { id: 1 } });
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.$executeRawUnsafe(
        `UPDATE auth_action_tokens
         SET consumedAt = ?
         WHERE id = ? AND consumedAt IS NULL AND invalidatedAt IS NULL AND expiresAt > ?`,
        now,
        token.id,
        now,
      );
      if (consumed !== 1) throw new BadRequestException('Invalid or expired email change token');

      await tx.user.update({
        where: { id: token.userId },
        data: { email: targetEmail, emailVerifiedAt: now },
      });
      await tx.userIdentifierClaim.deleteMany({
        where: { userId: token.userId, type: UserIdentifierType.EMAIL },
      });
      if (!registration.allowMultipleAccountsPerEmail) {
        await tx.userIdentifierClaim.create({
          data: {
            userId: token.userId,
            type: UserIdentifierType.EMAIL,
            normalizedValue: targetEmail,
          },
        });
      }
      await tx.authSession.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: now, revocationReason: 'email_changed' },
      });
      await tx.$executeRawUnsafe(
        `UPDATE auth_action_tokens
         SET invalidatedAt = ?
         WHERE userId = ? AND id <> ? AND consumedAt IS NULL AND invalidatedAt IS NULL`,
        now,
        token.userId,
        token.id,
      );
    });

    await this.audit.log({
      actorUserId: token.userId,
      action: AuditAction.UPDATE,
      entityType: 'User',
      entityId: token.userId,
      description: 'Email address changed after verification of the new address',
      metadata: { newEmail: targetEmail },
    });
    return { success: true, emailChanged: true, sessionsRevoked: true };
  }

  async invalidateUserRecoveryTokens(userId: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE auth_action_tokens
       SET invalidatedAt = CURRENT_TIMESTAMP(3)
       WHERE userId = ? AND consumedAt IS NULL AND invalidatedAt IS NULL`,
      userId,
    );
  }

  private async issueTokenAndMail(input: {
    userId: string;
    username: string;
    recipient: string;
    purpose: AuthActionPurpose;
    targetEmail?: string;
    ttlMinutes: number;
    path: string;
    extraVariables?: Record<string, string>;
  }): Promise<void> {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hash(rawToken);
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + input.ttlMinutes * 60_000);

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE auth_action_tokens
         SET invalidatedAt = CURRENT_TIMESTAMP(3)
         WHERE userId = ? AND purpose = ? AND consumedAt IS NULL AND invalidatedAt IS NULL`,
        input.userId,
        input.purpose,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO auth_action_tokens (
           id, userId, purpose, tokenHash, targetEmail, expiresAt, createdAt
         ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
        id,
        input.userId,
        input.purpose,
        tokenHash,
        input.targetEmail ?? null,
        expiresAt,
      );
    });

    const actionUrl = `${this.mail.publicAppUrl()}${input.path}?token=${encodeURIComponent(rawToken)}`;
    const purpose = input.purpose as AuthEmailTemplatePurposeDto;
    try {
      const delivery = await this.mail.sendAuthEmail(purpose, input.recipient, {
        username: input.username,
        actionUrl,
        expiresInMinutes: String(input.ttlMinutes),
        pendingEmail: input.targetEmail ?? '',
        ...(input.extraVariables ?? {}),
      });
      await this.audit.log({
        actorUserId: input.userId,
        action: AuditAction.CREATE,
        entityType: 'AuthActionToken',
        entityId: id,
        description: `${input.purpose} token issued and email accepted by SMTP transport`,
        metadata: {
          purpose: input.purpose,
          templateVersionId: delivery.templateVersionId,
          expiresAt: expiresAt.toISOString(),
        },
      });
    } catch (error) {
      await this.invalidateToken(id);
      await this.audit.log({
        actorUserId: input.userId,
        action: AuditAction.UPDATE,
        entityType: 'AuthActionToken',
        entityId: id,
        description: `${input.purpose} token invalidated after email delivery failure`,
        metadata: { purpose: input.purpose },
      });
      throw error;
    }
  }

  private async requireActiveToken(rawToken: string, purpose: AuthActionPurpose): Promise<ActionTokenRow> {
    const tokenHash = this.hash(rawToken.trim());
    const rows = await this.prisma.$queryRawUnsafe<ActionTokenRow[]>(
      `SELECT id, userId, purpose, tokenHash, targetEmail, expiresAt, consumedAt, invalidatedAt, createdAt
       FROM auth_action_tokens
       WHERE tokenHash = ? AND purpose = ?
         AND consumedAt IS NULL AND invalidatedAt IS NULL
         AND expiresAt > CURRENT_TIMESTAMP(3)
       LIMIT 1`,
      tokenHash,
      purpose,
    );
    const token = rows[0];
    if (!token) throw new BadRequestException(`Invalid or expired ${purpose.toLowerCase().replaceAll('_', ' ')} token`);
    return token;
  }

  private async invalidateToken(id: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE auth_action_tokens
       SET invalidatedAt = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND consumedAt IS NULL AND invalidatedAt IS NULL`,
      id,
    );
  }

  private async assertEmailAvailable(email: string, userId: string): Promise<void> {
    const registration = await this.prisma.systemRegistrationConfig.findUniqueOrThrow({ where: { id: 1 } });
    if (registration.allowMultipleAccountsPerEmail) return;
    const existing = await this.prisma.user.findFirst({
      where: { email, id: { not: userId } },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Email address is already in use');
    const claim = await this.prisma.userIdentifierClaim.findUnique({
      where: {
        type_normalizedValue: {
          type: UserIdentifierType.EMAIL,
          normalizedValue: email,
        },
      },
    });
    if (claim && claim.userId !== userId) throw new ConflictException('Email address is already in use');
  }

  private async rateLimited(
    category: string,
    identity: string,
    windowMinutes: number,
    maxRequests: number,
  ): Promise<boolean> {
    const key = `megamitra:auth-rate:v1:${category}:${this.hash(identity.toLowerCase())}`;
    const client = this.redis.getClient();
    const count = await client.incr(key);
    if (count === 1) await client.expire(key, windowMinutes * 60);
    return count > maxRequests;
  }

  private validatePassword(password: string, minLength: number, maxLength: number): void {
    const length = Array.from(password).length;
    if (length < minLength || length > maxLength) {
      throw new BadRequestException(
        `Password length must be between ${minLength} and ${maxLength} characters`,
      );
    }
  }

  private normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
