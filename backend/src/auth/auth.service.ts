import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { CaptchaService } from '../captcha/captcha.service';
import { PrismaService } from '../database/prisma.service';
import { AuditAction, PasswordCreationMode, UserIdentifierType, UserStatus, UsernameCreationMode } from '../generated/prisma/enums';
import { AuthUser, JwtPayload } from './auth-user';
import { LoginDto, RefreshDto, RegisterDto } from './auth.dto';
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
  ) {}

  async register(dto: RegisterDto) {
    const registration = await this.prisma.systemRegistrationConfig.findUniqueOrThrow({ where: { id: 1 } });
    const authConfig = await this.prisma.systemAuthConfig.findUniqueOrThrow({ where: { id: 1 } });
    if (!registration.publicRegistrationEnabled) throw new ForbiddenException('Public registration is disabled');
    await this.requireCaptcha(authConfig.captchaOnRegistrationEnabled, dto.captchaId, dto.captchaAnswer);

    const email = dto.email?.trim().toLowerCase() || null;
    const phone = dto.phone?.trim() || null;
    if (registration.emailRequired && !email) throw new BadRequestException('Email is required');
    if (registration.mobileRequired && !phone) throw new BadRequestException('Mobile is required');

    const generatedPassword = registration.passwordMode === PasswordCreationMode.AUTO ||
      (registration.passwordMode === PasswordCreationMode.AUTO_OR_MANUAL && !dto.password);
    const password = generatedPassword ? randomBytes(18).toString('base64url') : dto.password;
    if (!password) throw new BadRequestException('Password is required');
    const passwordHash = await this.passwords.hash(password);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        let username = dto.username?.trim();
        const mustAutoUsername = registration.usernameMode === UsernameCreationMode.AUTO ||
          (registration.usernameMode === UsernameCreationMode.AUTO_OR_MANUAL && !username);
        if (mustAutoUsername) {
          const sequence = await tx.systemSequence.update({
            where: { key: 'username' },
            data: { nextValue: { increment: 1 } },
            select: { nextValue: true },
          });
          username = `${registration.usernamePrefixEnabled ? registration.usernamePrefix ?? '' : ''}${sequence.nextValue.toString()}`;
        }
        if (!username) throw new BadRequestException('Username is required');

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

        if (email && !registration.allowMultipleAccountsPerEmail) {
          await tx.userIdentifierClaim.create({ data: { userId: created.id, type: UserIdentifierType.EMAIL, normalizedValue: email } });
        }
        if (phone && !registration.allowMultipleAccountsPerMobile) {
          await tx.userIdentifierClaim.create({ data: { userId: created.id, type: UserIdentifierType.MOBILE, normalizedValue: phone } });
        }
        return created;
      });

      await this.audit.log({ action: AuditAction.CREATE, entityType: 'User', entityId: user.id, description: 'Public registration created' });
      return {
        user: { id: user.id, username: user.username, email: user.email, phone: user.phone, status: user.status },
        ...(generatedPassword ? { initialPassword: password } : {}),
      };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('Username, email, or mobile is already in use');
      throw error;
    }
  }

  async login(dto: LoginDto) {
    const authConfig = await this.prisma.systemAuthConfig.findUniqueOrThrow({ where: { id: 1 } });
    const security = await this.prisma.systemSecurityConfig.findUniqueOrThrow({ where: { id: 1 } });
    await this.requireCaptcha(authConfig.captchaOnLoginEnabled, dto.captchaId, dto.captchaAnswer);

    const identifier = dto.identifier.trim();
    const or: any[] = [];
    if (authConfig.loginWithUsername) or.push({ username: identifier });
    if (authConfig.loginWithEmail) or.push({ email: identifier.toLowerCase() });
    if (authConfig.loginWithMobile) or.push({ phone: identifier });
    const users = await this.prisma.user.findMany({ where: { OR: or }, take: 2 });
    const user = users.length === 1 ? users[0] : null;
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) throw new UnauthorizedException('Account is temporarily locked');
    const valid = await this.passwords.verify(user.passwordHash, dto.password);
    if (!valid) {
      const baseAttempts = user.lockedUntil && user.lockedUntil <= now ? 0 : user.failedLoginAttempts;
      const attempts = baseAttempts + 1;
      const lockedUntil = attempts >= security.maxFailedLoginAttempts
        ? new Date(Date.now() + security.lockoutMinutes * 60_000)
        : null;
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: attempts, lockedUntil } });
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.status !== UserStatus.ACTIVE) throw new ForbiddenException(`Account status is ${user.status}`);

    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now } });
    const result = await this.createSession(user.id, authConfig.accessTokenTtlSeconds, authConfig.refreshTokenTtlSeconds, security.maxActiveSessions);
    await this.audit.log({ actorUserId: user.id, action: AuditAction.LOGIN, entityType: 'AuthSession', entityId: result.sessionId, description: 'User login' });
    return result;
  }

  async refresh(dto: RefreshDto) {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(dto.refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        issuer: 'megamitra-api',
        audience: 'megamitra-clients',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (payload.typ !== 'refresh') throw new UnauthorizedException();

    const session = await this.prisma.authSession.findUnique({ where: { id: payload.sid }, include: { user: true } });
    if (!session || session.userId !== payload.sub) throw new UnauthorizedException();
    const presentedHash = this.tokenHash(dto.refreshToken);
    if (session.revokedAt || session.refreshTokenHash !== presentedHash) {
      await this.prisma.authSession.updateMany({
        where: { userId: payload.sub, revokedAt: null },
        data: { revokedAt: new Date(), revocationReason: 'refresh_replay_detected' },
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    if (session.expiresAt <= new Date() || session.user.status !== UserStatus.ACTIVE) throw new UnauthorizedException();

    const authConfig = await this.prisma.systemAuthConfig.findUniqueOrThrow({ where: { id: 1 } });
    const security = await this.prisma.systemSecurityConfig.findUniqueOrThrow({ where: { id: 1 } });
    if (!security.refreshTokenRotationEnabled) {
      return {
        sessionId: session.id,
        accessToken: await this.signAccess(payload.sub, session.id, authConfig.accessTokenTtlSeconds),
        refreshToken: dto.refreshToken,
        accessTokenExpiresInSeconds: authConfig.accessTokenTtlSeconds,
        refreshTokenExpiresInSeconds: Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)),
      };
    }

    const newSessionId = randomUUID();
    const newRefresh = await this.signRefresh(payload.sub, newSessionId, authConfig.refreshTokenTtlSeconds);
    const expiresAt = new Date(Date.now() + authConfig.refreshTokenTtlSeconds * 1000);
    await this.prisma.$transaction([
      this.prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), revocationReason: 'rotated', rotatedToSessionId: newSessionId } }),
      this.prisma.authSession.create({ data: { id: newSessionId, userId: payload.sub, refreshTokenHash: this.tokenHash(newRefresh), expiresAt } }),
    ]);

    return {
      sessionId: newSessionId,
      accessToken: await this.signAccess(payload.sub, newSessionId, authConfig.accessTokenTtlSeconds),
      refreshToken: newRefresh,
      accessTokenExpiresInSeconds: authConfig.accessTokenTtlSeconds,
      refreshTokenExpiresInSeconds: authConfig.refreshTokenTtlSeconds,
    };
  }

  async logout(user: AuthUser): Promise<{ success: true }> {
    await this.prisma.authSession.updateMany({
      where: { id: user.sessionId, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revocationReason: 'logout' },
    });
    await this.audit.log({ actorUserId: user.id, action: AuditAction.LOGOUT, entityType: 'AuthSession', entityId: user.sessionId, description: 'User logout' });
    return { success: true };
  }

  private async createSession(userId: string, accessTtl: number, refreshTtl: number, maxActiveSessions: number) {
    const active = await this.prisma.authSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
    });
    const revokeCount = Math.max(0, active.length - maxActiveSessions + 1);
    if (revokeCount > 0) {
      await this.prisma.authSession.updateMany({
        where: { id: { in: active.slice(0, revokeCount).map((item) => item.id) } },
        data: { revokedAt: new Date(), revocationReason: 'max_active_sessions' },
      });
    }

    const sessionId = randomUUID();
    const refreshToken = await this.signRefresh(userId, sessionId, refreshTtl);
    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId,
        refreshTokenHash: this.tokenHash(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });
    return {
      sessionId,
      accessToken: await this.signAccess(userId, sessionId, accessTtl),
      refreshToken,
      accessTokenExpiresInSeconds: accessTtl,
      refreshTokenExpiresInSeconds: refreshTtl,
    };
  }

  private signAccess(userId: string, sessionId: string, ttl: number): Promise<string> {
    return this.jwt.signAsync({ sub: userId, sid: sessionId, typ: 'access' }, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'), issuer: 'megamitra-api', audience: 'megamitra-clients', expiresIn: ttl,
    });
  }

  private signRefresh(userId: string, sessionId: string, ttl: number): Promise<string> {
    return this.jwt.signAsync({ sub: userId, sid: sessionId, typ: 'refresh' }, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'), issuer: 'megamitra-api', audience: 'megamitra-clients', expiresIn: ttl,
    });
  }

  private tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async requireCaptcha(enabled: boolean, id?: string, answer?: string): Promise<void> {
    if (enabled && !(await this.captcha.verify(id, answer))) throw new BadRequestException('Invalid or expired CAPTCHA');
  }
}
