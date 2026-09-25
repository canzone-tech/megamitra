import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { PrismaService } from '../database/prisma.service';
import {
  AuditAction,
  RoleStatus,
  UserIdentifierType,
  UserStatus,
  UsernameCreationMode,
} from '../generated/prisma/enums';
import type { CreateManagedUserDto } from './users.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
  ) {}

  list(query?: string) {
    const q = query?.trim();
    return this.prisma.user.findMany({
      where: q
        ? {
            OR: [
              { username: { contains: q } },
              { email: { contains: q } },
              { phone: { contains: q } },
            ],
          }
        : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        username: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        status: true,
        mustChangePassword: true,
        lastLoginAt: true,
        createdAt: true,
        roles: { include: { role: true } },
      },
    });
  }

  async createManaged(dto: CreateManagedUserDto, actorUserId: string) {
    const [registration, security] = await Promise.all([
      this.prisma.systemRegistrationConfig.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.systemSecurityConfig.findUniqueOrThrow({ where: { id: 1 } }),
    ]);
    const email = dto.email?.trim().toLowerCase() || null;
    const phone = dto.phone?.trim() || null;
    const passwordLength = Array.from(dto.password).length;
    if (passwordLength < security.passwordMinLength || passwordLength > security.passwordMaxLength) {
      throw new BadRequestException(
        `Password length must be between ${security.passwordMinLength} and ${security.passwordMaxLength} characters`,
      );
    }
    const passwordHash = await this.passwords.hash(dto.password);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        let username = dto.username?.trim();
        const mustAutoUsername =
          registration.usernameMode === UsernameCreationMode.AUTO ||
          (registration.usernameMode === UsernameCreationMode.AUTO_OR_MANUAL && !username);
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
          throw new BadRequestException('Configured default member role is unavailable');
        }

        const created = await tx.user.create({
          data: {
            username,
            email,
            phone,
            passwordHash,
            firstName: dto.firstName?.trim() || null,
            lastName: dto.lastName?.trim() || null,
            status: UserStatus.ACTIVE,
            mustChangePassword: false,
          },
        });
        await tx.userRole.create({ data: { userId: created.id, roleId: defaultRole.id } });

        if (email && !registration.allowMultipleAccountsPerEmail) {
          await tx.userIdentifierClaim.create({
            data: { userId: created.id, type: UserIdentifierType.EMAIL, normalizedValue: email },
          });
        }
        if (phone && !registration.allowMultipleAccountsPerMobile) {
          await tx.userIdentifierClaim.create({
            data: { userId: created.id, type: UserIdentifierType.MOBILE, normalizedValue: phone },
          });
        }
        return created;
      });
      await this.audit.log({
        actorUserId,
        action: AuditAction.CREATE,
        entityType: 'User',
        entityId: user.id,
        description: 'Member created from owner management portal',
      });
      return this.get(user.id);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Username, email, or mobile is already in use');
      }
      throw error;
    }
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        status: true,
        mustChangePassword: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        roles: { include: { role: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateStatus(id: string, status: UserStatus, actorUserId: string) {
    const user = await this.prisma.user
      .update({ where: { id }, data: { status } })
      .catch(() => null);
    if (!user) throw new NotFoundException('User not found');
    const action =
      status === UserStatus.ACTIVE
        ? AuditAction.ACTIVATE
        : status === UserStatus.SUSPENDED
          ? AuditAction.SUSPEND
          : status === UserStatus.BLOCKED
            ? AuditAction.BLOCK
            : AuditAction.UPDATE;
    await this.audit.log({
      actorUserId,
      action,
      entityType: 'User',
      entityId: id,
      description: `User status changed to ${status}`,
    });
    return this.get(id);
  }

  async replaceRoles(id: string, roleNames: string[], actorUserId: string) {
    const normalized = [...new Set(roleNames.map((name) => name.trim().toUpperCase()))];
    const roles = await this.prisma.role.findMany({
      where: { name: { in: normalized }, status: RoleStatus.ACTIVE },
    });
    if (roles.length !== normalized.length) throw new BadRequestException('Unknown or inactive role');
    const target = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: { include: { role: true } } },
    });
    if (!target) throw new NotFoundException('User not found');
    const removingSuperAdmin =
      target.roles.some((item) => item.role.name === 'SUPER_ADMIN') &&
      !normalized.includes('SUPER_ADMIN');
    if (removingSuperAdmin) {
      const otherSuperAdmins = await this.prisma.userRole.count({
        where: { role: { name: 'SUPER_ADMIN' }, userId: { not: id } },
      });
      if (otherSuperAdmins === 0) {
        throw new BadRequestException('Cannot remove the last SUPER_ADMIN');
      }
    }
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: id } }),
      this.prisma.userRole.createMany({ data: roles.map((role) => ({ userId: id, roleId: role.id })) }),
    ]);
    await this.audit.log({
      actorUserId,
      action: AuditAction.ROLE_CHANGE,
      entityType: 'User',
      entityId: id,
      description: 'User roles replaced',
      metadata: { roles: normalized },
    });
    return this.get(id);
  }
}
