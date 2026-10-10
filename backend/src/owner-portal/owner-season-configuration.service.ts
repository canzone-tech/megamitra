import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { BinaryPolicyService } from '../binary-policy/binary-policy.service';
import { FinancialDbService } from '../database/financial-db.service';
import { PrismaService } from '../database/prisma.service';
import {
  AuditAction,
  BinaryCapOverflowMode,
  ProgramIntervalUnit,
  ReferralRewardMode,
  ReferralRoundingMode,
} from '../generated/prisma/enums';
import { ProgramOrchestrationService } from '../program/program-orchestration.service';
import { ProgramPolicyService } from '../program/program-policy.service';
import { ReferralRewardPolicyService } from '../referral-reward/referral-reward-policy.service';
import type {
  CreateOwnerSeasonDto,
  OwnerSeasonPrizeDto,
  OwnerSeasonStatusDto,
  UpdateOwnerSeasonDto,
} from './owner-portal.dto';
import type { OwnerSeasonAdvancedConfigDto } from './owner-season-configuration.dto';
import { OwnerPortalService } from './owner-portal.service';

type SqlValue = string | number | bigint | boolean | Date | null;
type SeasonStatus = 'DRAFT' | 'REVIEW' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'ARCHIVED';
type SeasonRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: SeasonStatus;
  startDate: Date | string;
  endDate: Date | string | null;
  drawDay: number | null;
  eligibilityCutoff: string;
  programId: string | null;
  programVersionId: string | null;
  binaryPlanId: string | null;
  binaryPlanVersionId: string | null;
  referralPolicyId: string | null;
  referralPolicyVersionId: string | null;
};

type PortalSettings = {
  companyName: string;
  timezone: string;
  currencyCode: string;
  defaultLanguage: string;
};

const DEFAULT_PRIZES = [
  'Pulsar Bike 125CC',
  '₹50,000 Worth Gold',
  'Hero HF 100 CC Bike',
  'Royal Enfield Bike',
  'EV Scooter',
  'Car',
  'Luxury Sofa Set',
  'Laptop',
  'Tablet',
  'LED TV',
  'Smart Phone',
  'Car',
  'Smart TV',
  'Hero HF 100 CC Bike',
  'Smart Phone',
  'Honda Activa',
  'Hero HF 100 CC Bike',
  'Fridge Double Door',
  'Auto Rickshaw',
  'Tractor',
  'Mahindra Thar 4x2',
];

@Injectable()
export class OwnerSeasonConfigurationService {
  constructor(
    private readonly db: FinancialDbService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly portal: OwnerPortalService,
    private readonly programs: ProgramPolicyService,
    private readonly binaryPolicies: BinaryPolicyService,
    private readonly referralPolicies: ReferralRewardPolicyService,
    private readonly orchestration: ProgramOrchestrationService,
  ) {}

  async createSeason(dto: CreateOwnerSeasonDto, actorUserId: string) {
    const code = this.normalizeSeasonCode(dto.code || this.generatedSeasonCode());
    const existing = await this.rows<{ id: string }>(
      'SELECT id FROM owner_seasons WHERE code=? LIMIT 1',
      [code],
    );
    if (existing.length) throw new ConflictException('Season code already exists');
    this.validateSeason(dto);
    const settings = (await this.portal.settings()) as PortalSettings;
    const endDate = this.deriveSeasonEndDate(dto.startDate, dto.totalMonths);
    const effectiveFrom = this.dayStart(dto.startDate);
    const effectiveTo = this.dayEnd(endDate);

    const program = await this.programs.createProgram(
      {
        code: this.policyCode(code, 'PROGRAM'),
        name: `${dto.name} Membership`,
        description: dto.description,
      },
      actorUserId,
    );
    const programVersion = await this.programs.createVersion(
      program.id,
      {
        effectiveFrom,
        effectiveTo,
        currencyCode: settings.currencyCode,
        registrationFee: dto.registrationFee,
        installmentAmount: dto.monthlyEmi,
        installmentCount: dto.totalMonths,
        installmentIntervalUnit: ProgramIntervalUnit.MONTH,
        installmentIntervalCount: 1,
        firstInstallmentOffsetDays: 0,
        gracePeriodDays: 0,
        maxActiveEnrollmentsPerUser: 1,
        partialPaymentsAllowed: false,
        overpaymentsAllowed: false,
        eligibilityRules: {},
      },
      actorUserId,
    );

    const pairValue = Number(dto.pairValue);
    const binary = await this.binaryPolicies.createPlan(
      {
        code: this.policyCode(code, 'BINARY'),
        name: `${dto.name} Binary 2:2`,
        description: 'AB : CD 2:2 owner season plan',
      },
      actorUserId,
    );
    const binaryVersion = await this.binaryPolicies.createVersion(
      binary.id,
      {
        effectiveFrom,
        effectiveTo,
        qualifyingUnit: '1.0000',
        leftVolumePerPair: '2.0000',
        rightVolumePerPair: '2.0000',
        pairPayoutAmount: dto.pairValue,
        currencyCode: settings.currencyCode,
        settlementTimezone: settings.timezone,
        capOverflowMode: dto.carryForward
          ? BinaryCapOverflowMode.CARRY
          : BinaryCapOverflowMode.FLUSH,
        dailyPairCap: Math.floor(dto.dailyCap / pairValue),
        carryForwardEnabled: dto.carryForward,
        qualificationRules: {
          displayModel: 'AB:CD',
          pairRule: 'AC+BD',
        },
        settlementRules: {
          dailyPayoutCapAmount: dto.dailyCap.toFixed(2),
        },
      },
      actorUserId,
    );

    const referral = await this.referralPolicies.createPolicy(
      {
        code: this.policyCode(code, 'DIRECT'),
        name: `${dto.name} Direct Referral`,
        description: 'Qualifying direct referral reward',
      },
      actorUserId,
    );
    const referralVersion = await this.referralPolicies.createVersion(
      referral.id,
      {
        effectiveFrom,
        effectiveTo,
        rewardMode: ReferralRewardMode.FIXED,
        fixedAmount: dto.directReferral,
        currencyCode: settings.currencyCode,
        roundingMode: ReferralRoundingMode.HALF_UP,
        eligibilityRules: {},
      },
      actorUserId,
    );

    const id = randomUUID();
    await this.db.execute(
      `INSERT INTO owner_seasons
       (id, code, name, description, status, startDate, endDate, drawDay, eligibilityCutoff,
        programId, programVersionId, binaryPlanId, binaryPlanVersionId,
        referralPolicyId, referralPolicyVersionId, createdByUserId)
       VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        code,
        dto.name.trim(),
        dto.description?.trim() || null,
        dto.startDate.slice(0, 10),
        endDate,
        dto.drawDay ?? null,
        dto.eligibilityCutoff,
        program.id,
        programVersion.id,
        binary.id,
        binaryVersion.id,
        referral.id,
        referralVersion.id,
        actorUserId,
      ],
    );

    await this.portal.saveSeasonPrizes(
      id,
      dto.prizes?.length ? dto.prizes : this.defaultPrizes(dto.totalMonths),
      actorUserId,
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'OwnerSeason',
      entityId: id,
      description: 'Owner season draft created through authoritative season configuration',
      metadata: {
        code,
        currencyCode: settings.currencyCode,
        timezone: settings.timezone,
        automaticRulesConfigured: false,
      },
    });
    return this.portal.getSeason(id);
  }

  async updateSeason(id: string, dto: UpdateOwnerSeasonDto, actorUserId: string) {
    const current = await this.requireSeason(id);
    if (!['DRAFT', 'REVIEW'].includes(current.status)) {
      throw new ConflictException(
        'Active or closed seasons cannot be edited; duplicate the season instead',
      );
    }
    this.requirePolicyMapping(current);
    this.validateSeason(dto);
    const settings = (await this.portal.settings()) as PortalSettings;
    const endDate = this.deriveSeasonEndDate(dto.startDate, dto.totalMonths);
    const effectiveFrom = this.dayStart(dto.startDate);
    const effectiveTo = this.dayEnd(endDate);

    await this.programs.updateDraft(
      current.programVersionId!,
      {
        effectiveFrom,
        effectiveTo,
        currencyCode: settings.currencyCode,
        registrationFee: dto.registrationFee,
        installmentAmount: dto.monthlyEmi,
        installmentCount: dto.totalMonths,
        installmentIntervalUnit: ProgramIntervalUnit.MONTH,
        installmentIntervalCount: 1,
        firstInstallmentOffsetDays: 0,
        gracePeriodDays: 0,
        maxActiveEnrollmentsPerUser: 1,
        partialPaymentsAllowed: false,
        overpaymentsAllowed: false,
        eligibilityRules: {},
      },
      actorUserId,
    );

    const pairValue = Number(dto.pairValue);
    await this.binaryPolicies.updateDraft(
      current.binaryPlanVersionId!,
      {
        effectiveFrom,
        effectiveTo,
        pairPayoutAmount: dto.pairValue,
        currencyCode: settings.currencyCode,
        settlementTimezone: settings.timezone,
        capOverflowMode: dto.carryForward
          ? BinaryCapOverflowMode.CARRY
          : BinaryCapOverflowMode.FLUSH,
        dailyPairCap: Math.floor(dto.dailyCap / pairValue),
        carryForwardEnabled: dto.carryForward,
        settlementRules: {
          dailyPayoutCapAmount: dto.dailyCap.toFixed(2),
        },
      },
      actorUserId,
    );

    await this.referralPolicies.updateDraft(
      current.referralPolicyVersionId!,
      {
        effectiveFrom,
        effectiveTo,
        rewardMode: ReferralRewardMode.FIXED,
        fixedAmount: dto.directReferral,
        currencyCode: settings.currencyCode,
        roundingMode: ReferralRoundingMode.HALF_UP,
        eligibilityRules: {},
      },
      actorUserId,
    );

    await this.db.execute(
      `UPDATE owner_seasons
       SET name=?, description=?, startDate=?, endDate=?, drawDay=COALESCE(?, drawDay), eligibilityCutoff=?
       WHERE id=?`,
      [
        dto.name.trim(),
        dto.description?.trim() || null,
        dto.startDate.slice(0, 10),
        endDate,
        dto.drawDay ?? null,
        dto.eligibilityCutoff,
        id,
      ],
    );
    if (dto.prizes) {
      await this.portal.saveSeasonPrizes(id, dto.prizes, actorUserId);
    }
    await this.syncOrchestrationWindow(id, effectiveFrom, effectiveTo, actorUserId);
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerSeason',
      entityId: id,
      description: 'Owner season draft updated through authoritative season configuration',
      metadata: {
        currencyCode: settings.currencyCode,
        timezone: settings.timezone,
      },
    });
    return this.portal.getSeason(id);
  }

  async getAdvancedConfiguration(id: string) {
    const season = await this.requireSeason(id);
    this.requirePolicyMapping(season);
    const [binary, policies] = await Promise.all([
      this.binaryPolicies.getVersion(season.binaryPlanVersionId!),
      this.orchestration.listPolicies(season.programVersionId!),
    ]);
    const automatic =
      policies.find(
        (policy) =>
          policy.triggerType === 'PAYMENT_CONFIRMED' && policy.lifecycle === 'DRAFT',
      ) ??
      policies.find(
        (policy) =>
          policy.triggerType === 'PAYMENT_CONFIRMED' && policy.lifecycle === 'PUBLISHED',
      ) ??
      null;
    const rules = this.jsonObject(automatic?.eligibilityRules);

    return {
      season: {
        id: season.id,
        code: season.code,
        name: season.name,
        status: season.status,
      },
      binary: {
        lifecycle: binary.lifecycle,
        qualifyingUnit: binary.qualifyingUnit.toString(),
        leftVolumePerPair: binary.leftVolumePerPair.toString(),
        rightVolumePerPair: binary.rightVolumePerPair.toString(),
        monthlyPairCap: binary.monthlyPairCap,
        carryForwardExpiryDays: binary.carryForwardExpiryDays,
      },
      automaticRules: {
        configured: Boolean(automatic),
        lifecycle: automatic?.lifecycle ?? null,
        binaryUnitsPerEvent: Number(automatic?.binaryUnitsPerEvent ?? 0),
        referralHookEnabled: this.truthy(automatic?.referralHookEnabled),
        referralBasisMode: automatic?.referralBasisMode ?? 'PAYMENT_AMOUNT',
        drawEligibilityHookEnabled: this.truthy(automatic?.drawEligibilityHookEnabled),
        minimumPaymentAmount: this.optionalText(rules.minimumPaymentAmount),
        minimumRegistrationAllocation: this.optionalText(
          rules.minimumRegistrationAllocation,
        ),
        minimumInstallmentAllocation: this.optionalText(
          rules.minimumInstallmentAllocation,
        ),
        requiredAllocationTypes: Array.isArray(rules.requiredAllocationTypes)
          ? rules.requiredAllocationTypes.map(String)
          : [],
      },
    };
  }

  async updateAdvancedConfiguration(
    id: string,
    dto: OwnerSeasonAdvancedConfigDto,
    actorUserId: string,
  ) {
    const season = await this.requireSeason(id);
    if (!['DRAFT', 'REVIEW'].includes(season.status)) {
      throw new ConflictException(
        'Advanced policy settings are locked after season activation',
      );
    }
    this.requirePolicyMapping(season);

    await this.binaryPolicies.updateDraft(
      season.binaryPlanVersionId!,
      {
        qualifyingUnit: dto.qualifyingUnit,
        leftVolumePerPair: dto.leftVolumePerPair,
        rightVolumePerPair: dto.rightVolumePerPair,
        ...(dto.monthlyPairCap !== undefined
          ? { monthlyPairCap: dto.monthlyPairCap }
          : {}),
        ...(dto.carryForwardExpiryDays !== undefined
          ? { carryForwardExpiryDays: dto.carryForwardExpiryDays }
          : {}),
      },
      actorUserId,
    );

    const eligibilityRules: Record<string, unknown> = {};
    if (dto.minimumPaymentAmount !== undefined) {
      eligibilityRules.minimumPaymentAmount = dto.minimumPaymentAmount;
    }
    if (dto.minimumRegistrationAllocation !== undefined) {
      eligibilityRules.minimumRegistrationAllocation =
        dto.minimumRegistrationAllocation;
    }
    if (dto.minimumInstallmentAllocation !== undefined) {
      eligibilityRules.minimumInstallmentAllocation =
        dto.minimumInstallmentAllocation;
    }
    if (dto.requiredAllocationTypes.length) {
      eligibilityRules.requiredAllocationTypes = dto.requiredAllocationTypes;
    }

    const policies = await this.orchestration.listPolicies(
      season.programVersionId!,
    );
    const published = policies.find(
      (policy) =>
        policy.triggerType === 'PAYMENT_CONFIRMED' &&
        policy.lifecycle === 'PUBLISHED',
    );
    if (published) {
      throw new ConflictException(
        'Published automatic rules are immutable; duplicate the season to change them',
      );
    }
    const draft = policies.find(
      (policy) =>
        policy.triggerType === 'PAYMENT_CONFIRMED' && policy.lifecycle === 'DRAFT',
    );
    const effectiveFrom = this.dayStart(this.dateOnly(season.startDate));
    const effectiveTo = season.endDate
      ? this.dayEnd(this.dateOnly(season.endDate))
      : undefined;
    const input = {
      effectiveFrom,
      ...(effectiveTo ? { effectiveTo } : {}),
      ...(dto.binaryUnitsPerEvent > 0
        ? { binaryPlanVersionId: season.binaryPlanVersionId! }
        : {}),
      binaryUnitsPerEvent: dto.binaryUnitsPerEvent,
      referralHookEnabled: dto.referralHookEnabled,
      ...(dto.referralHookEnabled
        ? {
            referralPolicyVersionId: season.referralPolicyVersionId!,
            referralBasisMode: dto.referralBasisMode,
          }
        : {}),
      // Owner monthly draws are sourced from immutable installment tokens, not payment-time draw hooks.
      drawEligibilityHookEnabled: false,
      eligibilityRules,
    };

    if (draft) {
      await this.orchestration.updateDraft(draft.id, input, actorUserId);
    } else {
      await this.orchestration.createPolicy(
        {
          programVersionId: season.programVersionId!,
          triggerType: 'PAYMENT_CONFIRMED',
          ...input,
        },
        actorUserId,
      );
    }

    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerSeasonAdvancedConfiguration',
      entityId: id,
      description: 'Season Binary 2:2 and automatic payment rules updated',
      metadata: {
        leftVolumePerPair: dto.leftVolumePerPair,
        rightVolumePerPair: dto.rightVolumePerPair,
        binaryUnitsPerEvent: dto.binaryUnitsPerEvent,
        referralHookEnabled: dto.referralHookEnabled,
        drawEligibilityHookEnabled: false,
        drawEligibilitySource: 'INSTALLMENT_TOKEN_REGISTRY',
      },
    });
    return this.getAdvancedConfiguration(id);
  }

  async getInstallmentRecoveryPolicy(seasonId: string) {
    await this.requireSeason(seasonId);
    const rows = await this.rows<{ id:string; version:number; lifecycle:string; enabled:number|boolean; reservePercent:string }>(
      `SELECT id,version,lifecycle,enabled,reservePercent FROM installment_recovery_policy_versions
       WHERE seasonId=? ORDER BY version DESC`,[seasonId],
    );
    return { seasonId, current: rows.find(r=>r.lifecycle==='PUBLISHED')??null, versions:rows };
  }

  async updateInstallmentRecoveryPolicy(seasonId:string,enabled:boolean,percent:number,actorUserId:string) {
    if(!Number.isFinite(percent)||percent<0||percent>100)
      throw new BadRequestException('Reserve percentage must be 0–100');
    await this.db.transaction(async (c)=>{
      const found=await c.query<Array<{id:string}>>(
        'SELECT id FROM owner_seasons WHERE id=? LIMIT 1 FOR UPDATE',[seasonId]);
      if(!found.length)throw new NotFoundException('Season not found');
      const prior=await c.query<Array<{version:number}>>(
        'SELECT version FROM installment_recovery_policy_versions WHERE seasonId=? ORDER BY version DESC LIMIT 1',
        [seasonId]);
      await c.query(`UPDATE installment_recovery_policy_versions SET lifecycle='RETIRED'
        WHERE seasonId=? AND lifecycle='PUBLISHED'`,[seasonId]);
      await c.query(`INSERT INTO installment_recovery_policy_versions
        (id,seasonId,version,lifecycle,enabled,reservePercent,createdByUserId)
        VALUES(?,?,?,'PUBLISHED',?,?,?)`,
        [randomUUID(),seasonId,Number(prior[0]?.version??0)+1,enabled,percent.toFixed(2),actorUserId]);
    });
    await this.audit.log({actorUserId,action:AuditAction.UPDATE,entityType:'InstallmentRecoveryPolicy',
      entityId:seasonId,description:'Published next after-draw installment recovery policy',
      metadata:{enabled,reservePercent:percent}});
    return this.getInstallmentRecoveryPolicy(seasonId);
  }

  async changeSeasonStatus(
    id: string,
    dto: OwnerSeasonStatusDto,
    actorUserId: string,
  ) {
    const season = await this.requireSeason(id);
    const target = dto.status as SeasonStatus;
    const allowed: Record<SeasonStatus, SeasonStatus[]> = {
      DRAFT: ['REVIEW'],
      REVIEW: ['DRAFT', 'ACTIVE'],
      ACTIVE: ['PAUSED', 'CLOSED'],
      PAUSED: ['ACTIVE', 'CLOSED'],
      CLOSED: ['ARCHIVED'],
      ARCHIVED: [],
    };
    if (!allowed[season.status].includes(target)) {
      throw new ConflictException(
        `Season cannot move from ${season.status} to ${target}`,
      );
    }

    if (target === 'REVIEW' || target === 'ACTIVE') {
      await this.disableLegacyOwnerDrawHook(season, actorUserId);
    }

    if (target === 'ACTIVE' && season.status === 'REVIEW') {
      this.requirePolicyMapping(season);
      const program = await this.programs.getVersion(season.programVersionId!);
      const expectedMonths = Number(program.installmentCount);
      const coverage = await this.rows<{ months: bigint | number | string }>(
        `SELECT COUNT(DISTINCT monthNumber) AS months
         FROM owner_season_prizes
         WHERE seasonId=? AND status='ACTIVE'`,
        [id],
      );
      if (Number(coverage[0]?.months ?? 0) < expectedMonths) {
        throw new ConflictException(
          `Prize schedule must cover all ${expectedMonths} season months before activation`,
        );
      }

      const policies = await this.orchestration.listPolicies(
        season.programVersionId!,
      );
      const automatic =
        policies.find(
          (policy) =>
            policy.triggerType === 'PAYMENT_CONFIRMED' &&
            policy.lifecycle === 'DRAFT',
        ) ??
        policies.find(
          (policy) =>
            policy.triggerType === 'PAYMENT_CONFIRMED' &&
            policy.lifecycle === 'PUBLISHED',
        );
      if (!automatic) {
        throw new ConflictException(
          'Configure automatic payment rules in Season Management before activation',
        );
      }

      const binary = await this.binaryPolicies.getVersion(
        season.binaryPlanVersionId!,
      );
      const referral = await this.referralPolicies.getVersion(
        season.referralPolicyVersionId!,
      );

      // Activating a season opens registration immediately, even when the
      // season's draw/installment calendar starts in the future. Move only
      // future draft policy starts back to the activation instant so existing
      // payment/referral/binary rules can evaluate pre-start registrations.
      const registrationOpensAt = new Date();
      const registrationOpensAtIso = registrationOpensAt.toISOString();
      if (program.lifecycle === 'DRAFT' && program.effectiveFrom > registrationOpensAt) {
        await this.programs.updateDraft(
          program.id,
          { effectiveFrom: registrationOpensAtIso },
          actorUserId,
        );
      }
      if (binary.lifecycle === 'DRAFT' && binary.effectiveFrom > registrationOpensAt) {
        await this.binaryPolicies.updateDraft(
          binary.id,
          { effectiveFrom: registrationOpensAtIso },
          actorUserId,
        );
      }
      if (referral.lifecycle === 'DRAFT' && referral.effectiveFrom > registrationOpensAt) {
        await this.referralPolicies.updateDraft(
          referral.id,
          { effectiveFrom: registrationOpensAtIso },
          actorUserId,
        );
      }
      if (automatic.lifecycle === 'DRAFT' && automatic.effectiveFrom > registrationOpensAt) {
        await this.orchestration.updateDraft(
          automatic.id,
          { effectiveFrom: registrationOpensAtIso },
          actorUserId,
        );
      }

      if (program.lifecycle === 'DRAFT') {
        await this.programs.publish(program.id, actorUserId);
      } else if (program.lifecycle !== 'PUBLISHED') {
        throw new ConflictException('Season membership policy is not publishable');
      }
      if (binary.lifecycle === 'DRAFT') {
        await this.binaryPolicies.publish(binary.id, actorUserId);
      } else if (binary.lifecycle !== 'PUBLISHED') {
        throw new ConflictException('Season Binary policy is not publishable');
      }
      if (referral.lifecycle === 'DRAFT') {
        await this.referralPolicies.publish(referral.id, actorUserId);
      } else if (referral.lifecycle !== 'PUBLISHED') {
        throw new ConflictException('Season referral policy is not publishable');
      }
      if (automatic.lifecycle === 'DRAFT') {
        await this.orchestration.publish(automatic.id, actorUserId);
      } else if (automatic.lifecycle !== 'PUBLISHED') {
        throw new ConflictException('Season automatic rules are not publishable');
      }
    }

    if (target === 'CLOSED') {
      this.requirePolicyMapping(season);
      const policies = await this.orchestration.listPolicies(
        season.programVersionId!,
      );
      const automatic = policies.find(
        (policy) =>
          policy.triggerType === 'PAYMENT_CONFIRMED' &&
          policy.lifecycle === 'PUBLISHED',
      );
      if (automatic) {
        await this.orchestration.retire(automatic.id, actorUserId);
      }
      const [program, binary, referral] = await Promise.all([
        this.programs.getVersion(season.programVersionId!),
        this.binaryPolicies.getVersion(season.binaryPlanVersionId!),
        this.referralPolicies.getVersion(season.referralPolicyVersionId!),
      ]);
      if (program.lifecycle === 'PUBLISHED') {
        await this.programs.retire(program.id, actorUserId);
      }
      if (binary.lifecycle === 'PUBLISHED') {
        await this.binaryPolicies.retire(binary.id, actorUserId);
      }
      if (referral.lifecycle === 'PUBLISHED') {
        await this.referralPolicies.retire(referral.id, actorUserId);
      }
    }

    const actorColumn =
      target === 'REVIEW'
        ? 'reviewedByUserId'
        : target === 'ACTIVE'
          ? 'activatedByUserId'
          : target === 'CLOSED'
            ? 'closedByUserId'
            : null;
    await this.db.execute(
      actorColumn
        ? `UPDATE owner_seasons SET status=?, ${actorColumn}=? WHERE id=?`
        : 'UPDATE owner_seasons SET status=? WHERE id=?',
      actorColumn ? [target, actorUserId, id] : [target, id],
    );
    if(target==='ACTIVE'){
      await this.db.execute(
        `INSERT INTO installment_recovery_policy_versions
         (id,seasonId,version,lifecycle,enabled,reservePercent)
         SELECT UUID(),?,1,'PUBLISHED',TRUE,50.00
         WHERE NOT EXISTS(SELECT 1 FROM installment_recovery_policy_versions WHERE seasonId=?)`,
         [id,id]);
    }
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerSeason',
      entityId: id,
      description: `Owner season status changed to ${target}`,
      metadata: { from: season.status, to: target },
    });
    return this.portal.getSeason(id);
  }

  private async disableLegacyOwnerDrawHook(
    season: SeasonRow,
    actorUserId: string,
  ) {
    if (!season.programVersionId) return;
    const policies = await this.orchestration.listPolicies(season.programVersionId);
    const draft = policies.find(
      (policy) =>
        policy.triggerType === 'PAYMENT_CONFIRMED' && policy.lifecycle === 'DRAFT',
    );
    if (!draft || !this.truthy(draft.drawEligibilityHookEnabled)) return;
    await this.orchestration.updateDraft(
      draft.id,
      { drawEligibilityHookEnabled: false },
      actorUserId,
    );
  }

  private async syncOrchestrationWindow(
    seasonId: string,
    effectiveFrom: string,
    effectiveTo: string | undefined,
    actorUserId: string,
  ) {
    const season = await this.requireSeason(seasonId);
    if (!season.programVersionId) return;
    const policies = await this.orchestration.listPolicies(
      season.programVersionId,
    );
    const draft = policies.find(
      (policy) =>
        policy.triggerType === 'PAYMENT_CONFIRMED' && policy.lifecycle === 'DRAFT',
    );
    if (!draft) return;
    await this.orchestration.updateDraft(
      draft.id,
      {
        effectiveFrom,
        effectiveTo,
      },
      actorUserId,
    );
  }

  private async requireSeason(id: string) {
    const rows = await this.rows<SeasonRow>(
      `SELECT
         id, code, name, description, status,
         DATE_FORMAT(startDate, '%Y-%m-%d') AS startDate,
         DATE_FORMAT(endDate, '%Y-%m-%d') AS endDate,
         drawDay, eligibilityCutoff,
         programId, programVersionId,
         binaryPlanId, binaryPlanVersionId,
         referralPolicyId, referralPolicyVersionId
       FROM owner_seasons
       WHERE id=? LIMIT 1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Season not found');
    return rows[0];
  }

  private requirePolicyMapping(season: SeasonRow) {
    if (
      !season.programVersionId ||
      !season.binaryPlanVersionId ||
      !season.referralPolicyVersionId
    ) {
      throw new ConflictException('Season policy mapping is incomplete');
    }
  }

  private validateSeason(dto: CreateOwnerSeasonDto | UpdateOwnerSeasonDto) {
    const monthlyEmi = Number(dto.monthlyEmi);
    const registrationFee = Number(dto.registrationFee);
    const pairValue = Number(dto.pairValue);
    const directReferral = Number(dto.directReferral);
    if (
      ![monthlyEmi, registrationFee, pairValue, directReferral].every(
        Number.isFinite,
      )
    ) {
      throw new BadRequestException('Season monetary values must be valid numbers');
    }
    if (
      monthlyEmi < 0 ||
      registrationFee < 0 ||
      directReferral < 0 ||
      pairValue <= 0
    ) {
      throw new BadRequestException(
        'Season amounts cannot be negative and pair value must be greater than zero',
      );
    }
    if (dto.dailyCap < pairValue) {
      throw new BadRequestException(
        'Daily cap must allow at least one pair payout',
      );
    }
    const start = new Date(dto.startDate);
    if (!Number.isFinite(start.getTime())) {
      throw new BadRequestException('Season start date is invalid');
    }
    const derivedEndDate = this.deriveSeasonEndDate(dto.startDate, dto.totalMonths);
    if (dto.endDate && dto.endDate.slice(0, 10) !== derivedEndDate) {
      throw new BadRequestException(
        'Season end date is derived automatically from start date and total months',
      );
    }
  }

  private deriveSeasonEndDate(startDate: string, totalMonths: number) {
    const start = startDate.slice(0, 10);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
    if (!match) throw new BadRequestException('Season start date is invalid');
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      throw new BadRequestException('Season start date is invalid');
    }
    const end = new Date(Date.UTC(year, month - 1 + totalMonths, 0));
    return end.toISOString().slice(0, 10);
  }

  private defaultPrizes(totalMonths: number): OwnerSeasonPrizeDto[] {
    return Array.from({ length: totalMonths }, (_, index) => ({
      monthNumber: index + 1,
      prizeCode: `MONTH_${index + 1}_PRIZE_1`,
      category: 'Prize',
      name: DEFAULT_PRIZES[index] ?? `Month ${index + 1} Prize`,
      winnerCount: 1,
    }));
  }

  private normalizeSeasonCode(value: string) {
    const code = value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]+/g, '_')
      .slice(0, 50);
    if (code.length < 2) {
      throw new BadRequestException('Season code is too short');
    }
    return code;
  }

  private generatedSeasonCode() {
    const stamp = new Date().toISOString().slice(0, 7).replace('-', '');
    return `MGC_${stamp}_${randomBytes(2).toString('hex').toUpperCase()}`;
  }

  private policyCode(code: string, suffix: string) {
    const tail = `_${suffix}`;
    return `${code.slice(0, Math.max(2, 50 - tail.length))}${tail}`;
  }

  private dateOnly(value: Date | string) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw new BadRequestException('Season date is invalid');
    }
    return date.toISOString().slice(0, 10);
  }

  private dayStart(value: string) {
    return `${value.slice(0, 10)}T00:00:00.000Z`;
  }

  private dayEnd(value: string) {
    return `${value.slice(0, 10)}T23:59:59.999Z`;
  }

  private jsonObject(value: unknown): Record<string, unknown> {
    if (!value) return {};
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
      } catch {
        return {};
      }
    }
    return typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private optionalText(value: unknown): string | null {
    return value === undefined || value === null || value === ''
      ? null
      : String(value);
  }

  private truthy(value: unknown) {
    return value === true || value === 1 || value === '1';
  }

  private rows<T>(sql: string, values: SqlValue[] = []): Promise<T[]> {
    return this.db.transaction(
      async (connection) => (await connection.query(sql, values)) as T[],
    );
  }
}
