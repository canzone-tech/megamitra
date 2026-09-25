import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { CaptchaService } from '../captcha/captcha.service';
import { PrismaService } from '../database/prisma.service';
import {
  AuditAction,
  PasswordCreationMode,
  RoleStatus,
  UserIdentifierType,
  UserStatus,
  UsernameCreationMode,
} from '../generated/prisma/enums';
import type { AuthUser, JwtPayload } from './auth-user';
import {
  ChangePasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
} from './auth.dto';
import { AuthRecoveryService } from './auth-recovery.service';
import { PasswordService } from './password.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly captcha: CaptchaService,
    private readonly audit: AuditService,
    private readonly recovery: AuthRecoveryService,
  ) {}

  async register(dto: RegisterDto) {
    const [registration, authConfig, security] = await Promise.all([
      this.prisma.systemRegistrationConfig.findUniqueOrThrow({
        where: { id: 1 },
      }),
      this.prisma.systemAuthConfig.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.systemSecurityConfig.findUniqueOrThrow({ where: { id: 1 } }),
    ]);

    if (!registration.publicRegistrationEnabled) {
      throw new ForbiddenException('Public registration is disabled');
    }
    await this.requireCaptcha(
      authConfig.captchaOnRegistrationEnabled,
      dto.captchaId,
      dto.captchaAnswer,
    );

    const email = dto.email?.trim().toLowerCase() || null;
    const phone = dto.phone?.trim() || null;
    if (registration.emailRequired && !email) {
      throw new BadRequestException('Email is required');
    }
    if (registration.mobileRequired && !phone) {
      throw new BadRequestException('Mobile is required');
    }

    const generatedPassword =
      registration.passwordMode === PasswordCreationMode.AUTO ||
      (registration.passwordMode === PasswordCreationMode.AUTO_OR_MANUAL &&
        !dto.password);
    const password = generatedPassword
      ? randomBytes(18).toString('base64url')
      : dto.password;
    if (!password) throw new BadRequestException('Password is required');
    this.validatePasswordPolicy(
      password,
      security.passwordMinLength,
      security.passwordMaxLength,
    );
    const passwordHash = await this.passwords.hash(password);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        let username = dto.username?.trim();
        const mustAutoUsername =
          registration.usernameMode === UsernameCreationMode.AUTO ||
          (registration.usernameMode === UsernameCreationMode.AUTO_OR_MANUAL &&
            !username);
        if (mustAutoUsername) {
          const sequence = await tx.systemSequence.update({
            where: { key: 'username' },
            data: { nextValue: { increment: 1 } },
            select: { nextValue: true },
          });
          username = `${registration.usernamePrefixEnabled ? (registration.usernamePrefix ?? '') : ''}${sequence.nextValue.toString()}`;
        }
        if (!username) throw new BadRequestException('Username is required');

        const defaultRole = await tx.role.findUnique({
          where: { name: registration.defaultRoleName },
        });
        if (!defaultRole || defaultRole.status !== RoleStatus.ACTIVE) {
          throw new BadRequestException(
            'Configured default registration role is unavailable',
          );
        }

        const created = await tx.user.create({
          data: {
            username,
            email,
            phone,
            passwordHash,
            firstName: dto.firstName?.trim() || null,
            lastName: dto.lastName?.trim() || null,
            status: UserStatus.PENDING,
            mustChangePassword: generatedPassword,
          },
        });

        await tx.userRole.create({
          data: { userId: created.id, roleId: defaultRole.id },
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
        if (phone && !registration.allowMultipleAccountsPerMobile) {
          await tx.userIdentifierClaim.create({
            data: {
              userId: created.id,
              type: UserIdentifierType.MOBILE,
              normalizedValue: phone,
            },
          });
        }
        return created;
      });

      await this.audit.log({
        action: AuditAction.CREATE,
        entityType: 'User',
        entityId: user.id,
        description: 'Public registration created',
      });
      await this.recovery.sendRegistrationVerification(user.id);
      return {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          phone: user.phone,
          status: user.status,
          emailVerifiedAt: user.emailVerifiedAt,
        },
        ...(generatedPassword ? { initialPassword: password } : {}),
      };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          'Username, email, or mobile is already in use',
        );
      }
      throw error;
    }
  }

  async login(dto: LoginDto) {
    const [authConfig, security, extension] = await Promise.all([
      this.prisma.systemAuthConfig.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.systemSecurityConfig.findUniqueOrThrow({ where: { id: 1 } }),
      this.recovery.getExtensionConfig(),
    ]);
    await this.requireCaptcha(
      authConfig.captchaOnLoginEnabled,
      dto.captchaId,
      dto.captchaAnswer,
    );

    const identifier = dto.identifier.trim();
    const or: { username?: string; email?: string; phone?: string }[] = [];
    if (authConfig.loginWithUsername) or.push({ username: identifier });
    if (authConfig.loginWithEmail) {
      or.push({ email: identifier.toLowerCase() });
    }
    if (authConfig.loginWithMobile) or.push({ phone: identifier });

    const users = await this.prisma.user.findMany({
      where: { OR: or },
      take: 2,
    });
    const user = users.length === 1 ? users[0] : null;
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      throw new UnauthorizedException('Account is temporarily locked');
    }

    const valid = await this.passwords.verify(user.passwordHash, dto.password);
    if (!valid) {
      const baseAttempts =
        user.lockedUntil && user.lockedUntil <= now
          ? 0
          : user.failedLoginAttempts;
      const attempts = baseAttempts + 1;
      const lockedUntil =
        attempts >= security.maxFailedLoginAttempts
          ? new Date(Date.now() + security.lockoutMinutes * 60_000)
          : null;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: attempts, lockedUntil },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException(`Account status is ${user.status}`);
    }
    if (extension.emailVerificationRequiredForLogin && !user.emailVerifiedAt) {
      throw new ForbiddenException('Email verification is required before login');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now },
    });

    const result = await this.createSession(
      user.id,
      authConfig.accessTokenTtlSeconds,
      authConfig.refreshTokenTtlSeconds,
      security.maxActiveSessions,
      security.idleTimeoutMinutes,
      security.absoluteSessionTimeoutMinutes,
    );
    await this.audit.log({
      actorUserId: user.id,
      action: AuditAction.LOGIN,
      entityType: 'AuthSession',
      entityId: result.sessionId,
      description: 'User login',
    });
    return result;
  }

  async refresh(dto: RefreshDto) {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(dto.refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        issuer: 'megagoldenclub-api',
        audience: 'megagoldenclub-clients',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (payload.typ !== 'refresh') throw new UnauthorizedException();

    const [session, authConfig, security, extension] = await Promise.all([
      this.prisma.authSession.findUnique({
        where: { id: payload.sid },
        include: { user: true },
      }),
      this.prisma.systemAuthConfig.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.systemSecurityConfig.findUniqueOrThrow({ where: { id: 1 } }),
      this.recovery.getExtensionConfig(),
    ]);

    if (!session || session.userId !== payload.sub) {
      throw new UnauthorizedException();
    }

    const presentedHash = this.tokenHash(dto.refreshToken);
    if (session.revokedAt || session.refreshTokenHash !== presentedHash) {
      await this.revokeAllUserSessions(payload.sub, 'refresh_replay_detected');
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    const now = new Date();
    const expiryReason = this.sessionExpiryReason(
      session,
      security.idleTimeoutMinutes,
      now,
    );
    if (
      expiryReason ||
      session.user.status !== UserStatus.ACTIVE ||
      (extension.emailVerificationRequiredForLogin && !session.user.emailVerifiedAt)
    ) {
      const revocationReason = expiryReason
        ?? (session.user.status !== UserStatus.ACTIVE
          ? `user_status_${session.user.status.toLowerCase()}`
          : 'email_verification_required');
      await this.prisma.authSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: now, revocationReason },
      });
      throw new UnauthorizedException('Session is not active');
    }

    if (!security.refreshTokenRotationEnabled) {
      await this.prisma.authSession.update({
        where: { id: session.id },
        data: { lastSeenAt: now },
      });
      return {
        sessionId: session.id,
        accessToken: await this.signAccess(
          payload.sub,
          session.id,
          authConfig.accessTokenTtlSeconds,
        ),
        refreshToken: dto.refreshToken,
        accessTokenExpiresInSeconds: authConfig.accessTokenTtlSeconds,
        refreshTokenExpiresInSeconds: Math.max(
          0,
          Math.floor((session.expiresAt.getTime() - now.getTime()) / 1000),
        ),
      };
    }

    const remainingAbsoluteSeconds = Math.floor(
      (session.absoluteExpiresAt.getTime() - now.getTime()) / 1000,
    );
    const effectiveRefreshTtl = Math.min(
      authConfig.refreshTokenTtlSeconds,
      remainingAbsoluteSeconds,
    );
    if (effectiveRefreshTtl <= 0) {
      throw new UnauthorizedException('Session has expired');
    }

    const newSessionId = randomUUID();
    const newRefresh = await this.signRefresh(
      payload.sub,
      newSessionId,
      effectiveRefreshTtl,
    );
    const expiresAt = new Date(now.getTime() + effectiveRefreshTtl * 1000);

    const rotated = await this.prisma.$transaction(async (tx) => {
      const update = await tx.authSession.updateMany({
        where: {
          id: session.id,
          userId: payload.sub,
          revokedAt: null,
          refreshTokenHash: presentedHash,
        },
        data: {
          revokedAt: now,
          revocationReason: 'rotated',
          rotatedToSessionId: newSessionId,
        },
      });
      if (update.count !== 1) return false;

      await tx.authSession.create({
        data: {
          id: newSessionId,
          userId: payload.sub,
          refreshTokenHash: this.tokenHash(newRefresh),
          expiresAt,
          lastSeenAt: now,
          absoluteExpiresAt: session.absoluteExpiresAt,
        },
      });
      return true;
    });

    if (!rotated) {
      await this.revokeAllUserSessions(payload.sub, 'refresh_replay_detected');
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    return {
      sessionId: newSessionId,
      accessToken: await this.signAccess(
        payload.sub,
        newSessionId,
        authConfig.accessTokenTtlSeconds,
      ),
      refreshToken: newRefresh,
      accessTokenExpiresInSeconds: authConfig.accessTokenTtlSeconds,
      refreshTokenExpiresInSeconds: effectiveRefreshTtl,
    };
  }

  async changePassword(
    user: AuthUser,
    dto: ChangePasswordDto,
  ): Promise<{ success: true }> {
    const [record, security] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      this.prisma.systemSecurityConfig.findUniqueOrThrow({ where: { id: 1 } }),
    ]);

    if (!(await this.passwords.verify(record.passwordHash, dto.currentPassword))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    this.validatePasswordPolicy(
      dto.newPassword,
      security.passwordMinLength,
      security.passwordMaxLength,
    );
    if (await this.passwords.verify(record.passwordHash, dto.newPassword)) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    const passwordHash = await this.passwords.hash(dto.newPassword);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          mustChangePassword: false,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      await tx.authSession.updateMany({
        where: {
          userId: user.id,
          id: { not: user.sessionId },
          revokedAt: null,
        },
        data: {
          revokedAt: now,
          revocationReason: 'password_changed',
        },
      });
      await tx.$executeRawUnsafe(
        `UPDATE auth_action_tokens
         SET invalidatedAt = ?
         WHERE userId = ? AND consumedAt IS NULL AND invalidatedAt IS NULL`,
        now,
        user.id,
      );
    });

    await this.audit.log({
      actorUserId: user.id,
      action: AuditAction.PASSWORD_CHANGE,
      entityType: 'User',
      entityId: user.id,
      description: 'Password changed',
    });
    return { success: true };
  }

  async logout(user: AuthUser): Promise<{ success: true }> {
    await this.prisma.authSession.updateMany({
      where: { id: user.sessionId, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revocationReason: 'logout' },
    });
    await this.audit.log({
      actorUserId: user.id,
      action: AuditAction.LOGOUT,
      entityType: 'AuthSession',
      entityId: user.sessionId,
      description: 'User logout',
    });
    return { success: true };
  }

  private async createSession(
    userId: string,
    accessTtl: number,
    refreshTtl: number,
    maxActiveSessions: number,
    idleTimeoutMinutes: number,
    absoluteSessionTimeoutMinutes: number,
  ) {
    const now = new Date();
    const idleCutoff = new Date(now.getTime() - idleTimeoutMinutes * 60_000);
    await this.prisma.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        OR: [
          { expiresAt: { lte: now } },
          { absoluteExpiresAt: { lte: now } },
          { lastSeenAt: { lte: idleCutoff } },
        ],
      },
      data: { revokedAt: now, revocationReason: 'expired_before_login' },
    });

    const active = await this.prisma.authSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
        lastSeenAt: { gt: idleCutoff },
      },
      orderBy: { createdAt: 'asc' },
    });
    const revokeCount = Math.max(0, active.length - maxActiveSessions + 1);
    if (revokeCount > 0) {
      await this.prisma.authSession.updateMany({
        where: {
          id: { in: active.slice(0, revokeCount).map((item) => item.id) },
        },
        data: { revokedAt: now, revocationReason: 'max_active_sessions' },
      });
    }

    const sessionId = randomUUID();
    const absoluteExpiresAt = new Date(
      now.getTime() + absoluteSessionTimeoutMinutes * 60_000,
    );
    const remainingAbsoluteSeconds = Math.floor(
      (absoluteExpiresAt.getTime() - now.getTime()) / 1000,
    );
    const effectiveRefreshTtl = Math.min(
      refreshTtl,
      remainingAbsoluteSeconds,
    );
    const refreshToken = await this.signRefresh(
      userId,
      sessionId,
      effectiveRefreshTtl,
    );
    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId,
        refreshTokenHash: this.tokenHash(refreshToken),
        expiresAt: new Date(now.getTime() + effectiveRefreshTtl * 1000),
        lastSeenAt: now,
        absoluteExpiresAt,
      },
    });
    return {
      sessionId,
      accessToken: await this.signAccess(userId, sessionId, accessTtl),
      refreshToken,
      accessTokenExpiresInSeconds: accessTtl,
      refreshTokenExpiresInSeconds: effectiveRefreshTtl,
    };
  }

  private signAccess(
    userId: string,
    sessionId: string,
    ttl: number,
  ): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, sid: sessionId, typ: 'access' },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        issuer: 'megagoldenclub-api',
        audience: 'megagoldenclub-clients',
        expiresIn: ttl,
      },
    );
  }

  private signRefresh(
    userId: string,
    sessionId: string,
    ttl: number,
  ): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, sid: sessionId, typ: 'refresh' },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        issuer: 'megagoldenclub-api',
        audience: 'megagoldenclub-clients',
        expiresIn: ttl,
      },
    );
  }

  private tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private validatePasswordPolicy(
    password: string,
    minLength: number,
    maxLength: number,
  ): void {
    const length = Array.from(password).length;
    if (length < minLength || length > maxLength) {
      throw new BadRequestException(
        `Password length must be between ${minLength} and ${maxLength} characters`,
      );
    }
  }

  private sessionExpiryReason(
    session: {
      expiresAt: Date;
      lastSeenAt: Date;
      absoluteExpiresAt: Date;
    },
    idleTimeoutMinutes: number,
    now: Date,
  ): string | null {
    if (session.expiresAt <= now) return 'refresh_expired';
    if (session.absoluteExpiresAt <= now) return 'absolute_timeout';
    if (
      session.lastSeenAt.getTime() + idleTimeoutMinutes * 60_000 <=
      now.getTime()
    ) {
      return 'idle_timeout';
    }
    return null;
  }

  private async revokeAllUserSessions(
    userId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revocationReason: reason },
    });
  }

  private async requireCaptcha(
    enabled: boolean,
    id?: string,
    answer?: string,
  ): Promise<void> {
    if (enabled && !(await this.captcha.verify(id, answer))) {
      throw new BadRequestException('Invalid or expired CAPTCHA');
    }
  }
}
