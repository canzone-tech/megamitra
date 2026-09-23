import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { AuditAction, RoleStatus, UserStatus } from '../generated/prisma/enums';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  list(query?: string) {
    const q = query?.trim();
    return this.prisma.user.findMany({
      where: q ? { OR: [{ username: { contains: q } }, { email: { contains: q } }, { phone: { contains: q } }] } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, username: true, email: true, phone: true, firstName: true, lastName: true,
        status: true, mustChangePassword: true, lastLoginAt: true, createdAt: true,
        roles: { include: { role: true } },
      },
    });
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true, username: true, email: true, phone: true, firstName: true, lastName: true,
        status: true, mustChangePassword: true, lastLoginAt: true, createdAt: true, updatedAt: true,
        roles: { include: { role: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateStatus(id: string, status: UserStatus, actorUserId: string) {
    const user = await this.prisma.user.update({ where: { id }, data: { status } }).catch(() => null);
    if (!user) throw new NotFoundException('User not found');
    const action = status === UserStatus.ACTIVE ? AuditAction.ACTIVATE : status === UserStatus.SUSPENDED ? AuditAction.SUSPEND : status === UserStatus.BLOCKED ? AuditAction.BLOCK : AuditAction.UPDATE;
    await this.audit.log({ actorUserId, action, entityType: 'User', entityId: id, description: `User status changed to ${status}` });
    return this.get(id);
  }

  async replaceRoles(id: string, roleNames: string[], actorUserId: string) {
    const normalized = [...new Set(roleNames.map((name) => name.trim().toUpperCase()))];
    const roles = await this.prisma.role.findMany({ where: { name: { in: normalized }, status: RoleStatus.ACTIVE } });
    if (roles.length !== normalized.length) throw new BadRequestException('Unknown or inactive role');
    const target = await this.prisma.user.findUnique({ where: { id }, include: { roles: { include: { role: true } } } });
    if (!target) throw new NotFoundException('User not found');
    const removingSuperAdmin = target.roles.some((item) => item.role.name === 'SUPER_ADMIN') && !normalized.includes('SUPER_ADMIN');
    if (removingSuperAdmin) {
      const otherSuperAdmins = await this.prisma.userRole.count({ where: { role: { name: 'SUPER_ADMIN' }, userId: { not: id } } });
      if (otherSuperAdmins === 0) throw new BadRequestException('Cannot remove the last SUPER_ADMIN');
    }
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: id } }),
      this.prisma.userRole.createMany({ data: roles.map((role) => ({ userId: id, roleId: role.id })) }),
    ]);
    await this.audit.log({ actorUserId, action: AuditAction.ROLE_CHANGE, entityType: 'User', entityId: id, description: 'User roles replaced', metadata: { roles: normalized } });
    return this.get(id);
  }
}
