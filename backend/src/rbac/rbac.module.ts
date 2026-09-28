import { Module } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';
import { RolesGuard } from './roles.guard';

@Module({
  controllers: [RbacController],
  providers: [RbacService, PermissionsGuard, RolesGuard],
  exports: [PermissionsGuard, RolesGuard, RbacService],
})
export class RbacModule {}
