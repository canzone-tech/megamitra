import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../rbac/permissions.decorator';
import { CatalogService } from './catalog.service';
import {
  CancelEntitlementDto,
  CompleteProductFulfillmentDto,
  CreateCatalogProductDto,
  CreateEntitlementPolicyDto,
  CreateEntitlementPolicyVersionDto,
  FailProductFulfillmentDto,
  GenerateEntitlementsDto,
  ListEntitlementsDto,
  StartProductFulfillmentDto,
  UpdateCatalogProductDto,
  UpdateEntitlementPolicyVersionDto,
} from './entitlement.dto';
import { EntitlementGenerationService } from './entitlement-generation.service';
import { EntitlementPolicyService } from './entitlement-policy.service';
import { EntitlementService } from './entitlement.service';

@Controller('admin/entitlements')
export class EntitlementAdminController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly policies: EntitlementPolicyService,
    private readonly generation: EntitlementGenerationService,
    private readonly entitlements: EntitlementService,
  ) {}

  @Permissions('product.read')
  @Get('products')
  listProducts() { return this.catalog.listProducts(); }

  @Permissions('product.manage')
  @Post('products')
  createProduct(@CurrentUser() user: AuthUser, @Body() dto: CreateCatalogProductDto) {
    return this.catalog.createProduct(user.id, dto);
  }

  @Permissions('product.manage')
  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: UpdateCatalogProductDto) {
    return this.catalog.updateProduct(user.id, id, dto);
  }

  @Permissions('product.read')
  @Get('policies')
  listPolicies() { return this.policies.listPolicies(); }

  @Permissions('product.manage')
  @Post('policies')
  createPolicy(@CurrentUser() user: AuthUser, @Body() dto: CreateEntitlementPolicyDto) {
    return this.policies.createPolicy(user.id, dto);
  }

  @Permissions('product.manage')
  @Post('policies/:id/default')
  setDefaultPolicy(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.policies.setDefaultPolicy(user.id, id);
  }

  @Permissions('product.manage')
  @Post('policies/:id/versions')
  createPolicyVersion(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: CreateEntitlementPolicyVersionDto) {
    return this.policies.createPolicyVersion(id, user.id, dto);
  }

  @Permissions('product.manage')
  @Patch('policy-versions/:id')
  updatePolicyVersion(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: UpdateEntitlementPolicyVersionDto) {
    return this.policies.updatePolicyVersion(id, user.id, dto);
  }

  @Permissions('product.manage')
  @Post('policy-versions/:id/publish')
  publishPolicyVersion(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.policies.publishPolicyVersion(id, user.id);
  }

  @Permissions('product.manage')
  @Post('policy-versions/:id/retire')
  retirePolicyVersion(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.policies.retirePolicyVersion(id, user.id);
  }

  @Permissions('entitlement.manage')
  @Post('generate')
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateEntitlementsDto) {
    return this.generation.generate(user.id, dto);
  }

  @Permissions('entitlement.read')
  @Get('items')
  listEntitlements(@Query() query: ListEntitlementsDto) { return this.entitlements.listEntitlements(query); }

  @Permissions('entitlement.read')
  @Get('items/:id')
  getEntitlement(@Param('id') id: string) { return this.entitlements.getEntitlement(id); }

  @Permissions('entitlement.manage')
  @Post('items/:id/cancel')
  cancelEntitlement(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: CancelEntitlementDto) {
    return this.entitlements.cancelEntitlement(id, user.id, dto);
  }

  @Permissions('entitlement.manage')
  @Post('items/:id/fulfillment-attempts')
  startFulfillment(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: StartProductFulfillmentDto) {
    return this.entitlements.startFulfillment(id, user.id, dto);
  }

  @Permissions('entitlement.manage')
  @Patch('fulfillment-attempts/:id/complete')
  completeFulfillment(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: CompleteProductFulfillmentDto) {
    return this.entitlements.completeFulfillment(id, user.id, dto);
  }

  @Permissions('entitlement.manage')
  @Patch('fulfillment-attempts/:id/fail')
  failFulfillment(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: FailProductFulfillmentDto) {
    return this.entitlements.failFulfillment(id, user.id, dto);
  }
}
