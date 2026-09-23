import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { AuditAction, RoleStatus } from '../generated/prisma/enums';
import {
  UpdateAuthConfigDto,
  UpdateRegistrationConfigDto,
  UpdateSecurityConfigDto,
} from './platform-config.dto';

@Injectable()
export class PlatformConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getAll() {
    const [auth, security, registration] = await Promise.all([
      this.prisma.systemAuthConfig.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.systemSecurityConfig.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.systemRegistrationConfig.findUniqueOrThrow({ where: { id: 1 } }),
    ]);
    return { auth, security, registration };
  }

  async updateAuth(dto: UpdateAuthConfigDto, actorUserId: string) {
    const current = await this.prisma.systemAuthConfig.findUniqueOrThrow({
      where: { id: 1 },
    });
    const merged = { ...current, ...dto };
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
    const result = await this.prisma.systemAuthConfig.update({
      where: { id: 1 },
      data: { ...dto, updatedByUserId: actorUserId },
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'SystemAuthConfig',
      entityId: '1',
      description: 'Authentication configuration updated',
    });
    return result;
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
    const current = await this.prisma.systemRegistrationConfig.findUniqueOrThrow({
      where: { id: 1 },
    });
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
}
