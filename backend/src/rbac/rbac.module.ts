import { Module } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';

@Module({
  controllers: [RbacController],
  providers: [RbacService, PermissionsGuard],
  exports: [PermissionsGuard, RbacService],
})
export class RbacModule {}
