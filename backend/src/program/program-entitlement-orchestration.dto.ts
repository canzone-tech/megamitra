import { IsUUID } from 'class-validator';

export class ConfigureProgramEntitlementHookDto {
  @IsUUID()
  entitlementPolicyVersionId!: string;
}
