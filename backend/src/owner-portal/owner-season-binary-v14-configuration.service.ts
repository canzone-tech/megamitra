import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { BinaryPolicyService } from '../binary-policy/binary-policy.service';
import { FinancialDbService } from '../database/financial-db.service';
import { PrismaService } from '../database/prisma.service';
import { AuditAction } from '../generated/prisma/enums';
import { ProgramOrchestrationService } from '../program/program-orchestration.service';
import { ProgramPolicyService } from '../program/program-policy.service';
import { ReferralRewardPolicyService } from '../referral-reward/referral-reward-policy.service';
import {
  ownerDrawScheduleLabel,
  validateOwnerDrawScheduleConfig,
} from './owner-draw-schedule';
import type {
  CreateOwnerSeasonDto,
  OwnerSeasonStatusDto,
  UpdateOwnerSeasonDto,
} from './owner-portal.dto';
import { OwnerPortalService } from './owner-portal.service';
import type { OwnerSeasonAdvancedConfigDto } from './owner-season-configuration.dto';
import { OwnerSeasonConfigurationService } from './owner-season-configuration.service';

type SeasonPolicyRow = {
  id: string;
  code: string;
  name: string;
  binaryPlanId: string | null;
  binaryPlanVersionId: string | null;
};

type DrawScheduleRow = {
  drawStartMonth: number;
  drawWeekOfMonth: number;
  drawWeekday: string;
  drawTimezone: string;
};

/**
 * Client-revised binary topology and owner-season recurrence enforcement.
 *
 * The underlying policy engine still keeps LEFT/RIGHT aggregates for historical
 * settlement reporting, while the authoritative genealogy is A/B/C/D:
 * A/B = LEFT, C/D = RIGHT, and only A:C or B:D may form a pair.
 */
@Injectable()
export class OwnerSeasonBinaryV14ConfigurationService extends OwnerSeasonConfigurationService {
  constructor(
    db: FinancialDbService,
    prisma: PrismaService,
    private readonly v14Audit: AuditService,
    portal: OwnerPortalService,
    programs: ProgramPolicyService,
    private readonly v14BinaryPolicies: BinaryPolicyService,
    referralPolicies: ReferralRewardPolicyService,
    orchestration: ProgramOrchestrationService,
    private readonly v14Db: FinancialDbService,
    private readonly v14Portal: OwnerPortalService,
  ) {
    super(
      db,
      prisma,
      v14Audit,
      portal,
      programs,
      v14BinaryPolicies,
      referralPolicies,
      orchestration,
    );
  }

  override async createSeason(dto: CreateOwnerSeasonDto, actorUserId: string) {
    const created = await super.createSeason(dto, actorUserId);
    const id = String((created as { id?: unknown }).id ?? '');
    if (id) {
      await this.initializeDrawSchedule(id);
      await this.enforceBinaryV14(id, actorUserId);
    }
    return id ? this.v14Portal.getSeason(id) : created;
  }

  override async updateSeason(id: string, dto: UpdateOwnerSeasonDto, actorUserId: string) {
    await super.updateSeason(id, dto, actorUserId);
    await this.enforceBinaryV14(id, actorUserId);
    return this.v14Portal.getSeason(id);
  }

  override async updateAdvancedConfiguration(
    id: string,
    dto: OwnerSeasonAdvancedConfigDto,
    actorUserId: string,
  ) {
    if (Number(dto.leftVolumePerPair) !== 1 || Number(dto.rightVolumePerPair) !== 1) {
      throw new BadRequestException(
        'Binary 1:4 uses one qualifying unit per fixed lane side; A:C and B:D cannot be changed to a generic ratio',
      );
    }
    await super.updateAdvancedConfiguration(id, dto, actorUserId);
    if (
      dto.drawStartMonth !== undefined ||
      dto.drawWeekOfMonth !== undefined ||
      dto.drawWeekday !== undefined
    ) {
      await this.updateDrawSchedule(id, dto, actorUserId);
    }
    await this.enforceBinaryV14(id, actorUserId);
    return this.getAdvancedConfiguration(id);
  }

  override async changeSeasonStatus(
    id: string,
    dto: OwnerSeasonStatusDto,
    actorUserId: string,
  ) {
    if (dto.status === 'REVIEW' || dto.status === 'ACTIVE') {
      await this.validateStoredDrawSchedule(id);
      await this.enforceBinaryV14(id, actorUserId);
    }
    return super.changeSeasonStatus(id, dto, actorUserId);
  }

  override async getAdvancedConfiguration(id: string) {
    const config = await super.getAdvancedConfiguration(id);
    const schedule = await this.drawSchedule(id);
    return {
      ...config,
      binaryTopology: {
        model: '1:4',
        slots: {
          A: 'LEFT',
          B: 'LEFT',
          C: 'RIGHT',
          D: 'RIGHT',
        },
        pairLanes: [
          ['A', 'C'],
          ['B', 'D'],
        ],
        genericCrossPairingAllowed: false,
      },
      drawSchedule: {
        startMonth: Number(schedule.drawStartMonth),
        weekOfMonth: Number(schedule.drawWeekOfMonth),
        weekday: schedule.drawWeekday,
        timezone: schedule.drawTimezone,
        label: ownerDrawScheduleLabel(
          Number(schedule.drawStartMonth),
          Number(schedule.drawWeekOfMonth),
          schedule.drawWeekday,
        ),
      },
    };
  }

  private async initializeDrawSchedule(id: string) {
    const settings = (await this.v14Portal.settings()) as { timezone?: string };
    const timezone = String(settings.timezone || 'Asia/Kolkata');
    validateOwnerDrawScheduleConfig({
      startMonth: 1,
      weekOfMonth: 3,
      weekday: 'SUNDAY',
      timezone,
    });
    await this.v14Db.execute(
      'UPDATE owner_seasons SET drawTimezone=? WHERE id=?',
      [timezone, id],
    );
  }

  private async updateDrawSchedule(
    id: string,
    dto: OwnerSeasonAdvancedConfigDto,
    actorUserId: string,
  ) {
    const current = await this.drawSchedule(id);
    const next = {
      startMonth: dto.drawStartMonth ?? Number(current.drawStartMonth),
      weekOfMonth: dto.drawWeekOfMonth ?? Number(current.drawWeekOfMonth),
      weekday: dto.drawWeekday ?? current.drawWeekday,
      timezone: current.drawTimezone,
    };
    validateOwnerDrawScheduleConfig(next);
    await this.v14Db.execute(
      `UPDATE owner_seasons
       SET drawStartMonth=?, drawWeekOfMonth=?, drawWeekday=?
       WHERE id=?`,
      [next.startMonth, next.weekOfMonth, next.weekday, id],
    );
    await this.v14Audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerSeasonDrawSchedule',
      entityId: id,
      description: 'Versioned owner lucky draw recurrence updated',
      metadata: {
        startMonth: next.startMonth,
        weekOfMonth: next.weekOfMonth,
        weekday: next.weekday,
        timezone: next.timezone,
        label: ownerDrawScheduleLabel(next.startMonth, next.weekOfMonth, next.weekday),
      },
    });
  }

  private async validateStoredDrawSchedule(id: string) {
    const schedule = await this.drawSchedule(id);
    try {
      validateOwnerDrawScheduleConfig({
        startMonth: Number(schedule.drawStartMonth),
        weekOfMonth: Number(schedule.drawWeekOfMonth),
        weekday: schedule.drawWeekday,
        timezone: schedule.drawTimezone,
      });
    } catch (error) {
      throw new BadRequestException(
        `Lucky draw recurrence must be valid before review/activation: ${error instanceof Error ? error.message : 'invalid configuration'}`,
      );
    }
  }

  private async drawSchedule(id: string) {
    const rows = await this.v14Db.transaction(async (connection) =>
      (await connection.query(
        `SELECT drawStartMonth, drawWeekOfMonth, drawWeekday, drawTimezone
         FROM owner_seasons WHERE id=? LIMIT 1`,
        [id],
      )) as DrawScheduleRow[],
    );
    const schedule = rows[0];
    if (!schedule) throw new BadRequestException('Season draw schedule was not found');
    return schedule;
  }

  private async enforceBinaryV14(id: string, actorUserId: string) {
    const rows = await this.v14Db.transaction(async (connection) =>
      (await connection.query(
        `SELECT id, code, name, binaryPlanId, binaryPlanVersionId
         FROM owner_seasons WHERE id=? LIMIT 1`,
        [id],
      )) as SeasonPolicyRow[],
    );
    const season = rows[0];
    if (!season?.binaryPlanId || !season.binaryPlanVersionId) return;

    const binary = await this.v14BinaryPolicies.getVersion(season.binaryPlanVersionId);
    if (binary.lifecycle === 'DRAFT') {
      await this.v14BinaryPolicies.updateDraft(
        season.binaryPlanVersionId,
        {
          qualifyingUnit: '1.0000',
          leftVolumePerPair: '1.0000',
          rightVolumePerPair: '1.0000',
          qualificationRules: {
            ownerSeasonCode: season.code,
            displayModel: '1:4',
            placementSlots: {
              A: 'LEFT',
              B: 'LEFT',
              C: 'RIGHT',
              D: 'RIGHT',
            },
            pairLanes: [
              ['A', 'C'],
              ['B', 'D'],
            ],
            genericCrossPairingAllowed: false,
          },
        },
        actorUserId,
      );
    }

    await this.v14Db.execute(
      `UPDATE binary_plans
       SET name=?, description=?, updatedAt=CURRENT_TIMESTAMP(3)
       WHERE id=?`,
      [
        `${season.name} Binary 1:4`,
        'A/B Left • C/D Right • fixed qualifying pairs A:C and B:D',
        season.binaryPlanId,
      ],
    );
  }
}
