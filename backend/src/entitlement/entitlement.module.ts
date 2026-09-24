import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { EntitlementAdminController } from './entitlement-admin.controller';
import { EntitlementGenerationService } from './entitlement-generation.service';
import { EntitlementMemberController } from './entitlement-member.controller';
import { EntitlementPolicyService } from './entitlement-policy.service';
import { EntitlementService } from './entitlement.service';

@Module({
  controllers: [EntitlementMemberController, EntitlementAdminController],
  providers: [CatalogService, EntitlementPolicyService, EntitlementGenerationService, EntitlementService],
  exports: [CatalogService, EntitlementPolicyService, EntitlementGenerationService, EntitlementService],
})
export class EntitlementModule {}
