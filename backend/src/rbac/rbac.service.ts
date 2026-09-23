import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { AuditAction, RoleStatus } from '../generated/prisma/enums';
import { CreateRoleDto } from './rbac.dto';

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  listPermissions() {
    return this.prisma.permission.findMany({ orderBy: { code: 'asc' } });
  }

  listRoles() {
    return this.prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: { permissions: { include: { permission: true } } },
    });
  }

  async createRole(dto: CreateRoleDto, actorUserId: string) {
    try {
      const role = await this.prisma.role.create({
        data: { name: dto.name.trim().toUpperCase(), description: dto.description.trim(), status: RoleStatus.ACTIVE },
      });
      await this.audit.log({ actorUserId, action: AuditAction.CREATE, entityType: 'Role', entityId: role.id, description: `Role ${role.name} created` });
      return role;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('Role already exists');
      throw error;
    }
  }

  async replacePermissions(roleName: string, permissionCodes: string[], actorUserId: string) {
    const normalizedRole = roleName.trim().toUpperCase();
    if (normalizedRole === 'SUPER_ADMIN') throw new BadRequestException('SUPER_ADMIN permissions are platform invariants');
    const role = await this.prisma.role.findUnique({ where: { name: normalizedRole } });
    if (!role) throw new NotFoundException('Role not found');
    const permissions = await this.prisma.permission.findMany({ where: { code: { in: [...new Set(permissionCodes)] } } });
    if (permissions.length !== new Set(permissionCodes).size) throw new BadRequestException('Unknown permission code');
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      this.prisma.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })) }),
    ]);
    await this.audit.log({ actorUserId, action: AuditAction.PERMISSION_CHANGE, entityType: 'Role', entityId: role.id, description: `Permissions replaced for ${role.name}`, metadata: { permissions: permissionCodes } });
    return this.prisma.role.findUnique({ where: { id: role.id }, include: { permissions: { include: { permission: true } } } });
  }
}
