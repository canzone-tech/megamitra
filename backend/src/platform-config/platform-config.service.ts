import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { AuditAction, RoleStatus } from '../generated/prisma/enums';
import {
  UpdateAuthConfigDto,
  UpdateRegistrationConfigDto,
  UpdateSecurityConfigDto,
} from './platform-config.dto';

type AuthExtensionRow = {
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

@Injectable()
export class PlatformConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly env: ConfigService,
  ) {}

  async getAll() {
    const [auth, authExtension, security, registration] = await Promise.all([
      this.prisma.systemAuthConfig.findUniqueOrThrow({ where: { id: 1 } }),
      this.getAuthExtension(),
      this.prisma.systemSecurityConfig.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.systemRegistrationConfig.findUniqueOrThrow({ where: { id: 1 } }),
    ]);
    return { auth: { ...auth, ...authExtension }, security, registration };
  }

  async updateAuth(dto: UpdateAuthConfigDto, actorUserId: string) {
    const [current, extension, registration] = await Promise.all([
      this.prisma.systemAuthConfig.findUniqueOrThrow({ where: { id: 1 } }),
      this.getAuthExtension(),
      this.prisma.systemRegistrationConfig.findUniqueOrThrow({ where: { id: 1 } }),
    ]);
    const merged = { ...current, ...extension, ...dto };
    if (
      !merged.loginWithUsername &&
      !merged.loginWithEmail &&
      !merged.loginWithMobile
    ) {
      throw new BadRequestException(
        'At least one login method must remain enabled',
      );
    }
    if (merged.refreshTokenTtlSeconds <= merged.accessTokenTtlSeconds) {
      throw new BadRequestException(
        'Refresh token TTL must exceed access token TTL',
      );
    }
    if (
      merged.emailVerificationRequiredForLogin &&
      !merged.emailVerificationEnabled
    ) {
      throw new BadRequestException(
        'Email verification must be enabled before it can be required for login',
      );
    }
    if (merged.emailVerificationRequiredForLogin && !registration.emailRequired) {
      throw new BadRequestException(
        'Registration email must be required before email verification can be required for login',
      );
    }
    if (
      (merged.passwordResetEnabled ||
        merged.emailVerificationEnabled ||
        merged.emailChangeEnabled) &&
      !this.smtpConfigured()
    ) {
      throw new BadRequestException(
        'SMTP_HOST and SMTP_FROM_EMAIL must be configured before enabling email-based authentication features',
      );
    }

    const {
      passwordResetEnabled: _passwordResetEnabled,
      passwordResetTokenTtlMinutes: _passwordResetTokenTtlMinutes,
      passwordResetRequestWindowMinutes: _passwordResetRequestWindowMinutes,
      passwordResetMaxRequestsPerWindow: _passwordResetMaxRequestsPerWindow,
      emailVerificationEnabled: _emailVerificationEnabled,
      emailVerificationRequiredForLogin: _emailVerificationRequiredForLogin,
      emailVerificationTokenTtlMinutes: _emailVerificationTokenTtlMinutes,
      emailVerificationRequestWindowMinutes: _emailVerificationRequestWindowMinutes,
      emailVerificationMaxRequestsPerWindow: _emailVerificationMaxRequestsPerWindow,
      emailChangeEnabled: _emailChangeEnabled,
      ...baseDto
    } = dto;

    const result = await this.prisma.$transaction(async (tx) => {
      const base = await tx.systemAuthConfig.update({
        where: { id: 1 },
        data: { ...baseDto, updatedByUserId: actorUserId },
      });
      await tx.$executeRawUnsafe(
        `UPDATE system_auth_config
         SET passwordResetEnabled = ?, passwordResetTokenTtlMinutes = ?,
             passwordResetRequestWindowMinutes = ?, passwordResetMaxRequestsPerWindow = ?,
             emailVerificationEnabled = ?, emailVerificationRequiredForLogin = ?,
             emailVerificationTokenTtlMinutes = ?, emailVerificationRequestWindowMinutes = ?,
             emailVerificationMaxRequestsPerWindow = ?, emailChangeEnabled = ?
         WHERE id = 1`,
        merged.passwordResetEnabled,
        merged.passwordResetTokenTtlMinutes,
        merged.passwordResetRequestWindowMinutes,
        merged.passwordResetMaxRequestsPerWindow,
        merged.emailVerificationEnabled,
        merged.emailVerificationRequiredForLogin,
        merged.emailVerificationTokenTtlMinutes,
        merged.emailVerificationRequestWindowMinutes,
        merged.emailVerificationMaxRequestsPerWindow,
        merged.emailChangeEnabled,
      );
      return base;
    });

    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'SystemAuthConfig',
      entityId: '1',
      description: 'Authentication configuration updated',
    });
    return { ...result, ...(await this.getAuthExtension()) };
  }

  async updateSecurity(dto: UpdateSecurityConfigDto, actorUserId: string) {
    const current = await this.prisma.systemSecurityConfig.findUniqueOrThrow({
      where: { id: 1 },
    });
    const merged = { ...current, ...dto };
    if (merged.absoluteSessionTimeoutMinutes < merged.idleTimeoutMinutes) {
      throw new BadRequestException(
        'Absolute session timeout must be greater than or equal to idle timeout',
      );
    }
    if (merged.passwordMaxLength < merged.passwordMinLength) {
      throw new BadRequestException(
        'Password maximum length must be greater than or equal to minimum length',
      );
    }
    const result = await this.prisma.systemSecurityConfig.update({
      where: { id: 1 },
      data: { ...dto, updatedByUserId: actorUserId },
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'SystemSecurityConfig',
      entityId: '1',
      description: 'Security configuration updated',
    });
    return result;
  }

  async updateRegistration(
    dto: UpdateRegistrationConfigDto,
    actorUserId: string,
  ) {
    const [current, authExtension] = await Promise.all([
      this.prisma.systemRegistrationConfig.findUniqueOrThrow({
        where: { id: 1 },
      }),
      this.getAuthExtension(),
    ]);
    const merged = {
      ...current,
      ...dto,
      defaultRoleName: dto.defaultRoleName?.trim() ?? current.defaultRoleName,
    };
    if (
      merged.usernamePrefixEnabled &&
      (!merged.usernamePrefix ||
        merged.usernamePrefix.trim().length === 0 ||
        merged.usernamePrefix.trim().length > 20)
    ) {
      throw new BadRequestException(
        'A 1-20 character username prefix is required when prefixing is enabled',
      );
    }
    if (authExtension.emailVerificationRequiredForLogin && !merged.emailRequired) {
      throw new BadRequestException(
        'Email cannot be optional while email verification is required for login',
      );
    }

    const role = await this.prisma.role.findUnique({
      where: { name: merged.defaultRoleName },
    });
    if (!role || role.status !== RoleStatus.ACTIVE) {
      throw new BadRequestException(
        'Default registration role must reference an active role',
      );
    }

    const data = {
      ...dto,
      usernamePrefix: dto.usernamePrefix?.trim(),
      defaultRoleName: merged.defaultRoleName,
      updatedByUserId: actorUserId,
    };
    const result = await this.prisma.systemRegistrationConfig.update({
      where: { id: 1 },
      data,
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'SystemRegistrationConfig',
      entityId: '1',
      description: 'Registration configuration updated',
    });
    return result;
  }

  private async getAuthExtension() {
    const rows = await this.prisma.$queryRawUnsafe<AuthExtensionRow[]>(
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

  private smtpConfigured(): boolean {
    return Boolean(
      this.env.get<string>('SMTP_HOST')?.trim() &&
      this.env.get<string>('SMTP_FROM_EMAIL')?.trim(),
    );
  }
}
