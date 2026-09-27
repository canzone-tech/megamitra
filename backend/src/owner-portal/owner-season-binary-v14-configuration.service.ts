import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { BinaryPolicyService } from '../binary-policy/binary-policy.service';
import { FinancialDbService } from '../database/financial-db.service';
import { PrismaService } from '../database/prisma.service';
import { ProgramOrchestrationService } from '../program/program-orchestration.service';
import { ProgramPolicyService } from '../program/program-policy.service';
import { ReferralRewardPolicyService } from '../referral-reward/referral-reward-policy.service';
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

/**
 * Client-revised binary topology enforcement.
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
    audit: AuditService,
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
      audit,
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
    if (id) await this.enforceBinaryV14(id, actorUserId);
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
    await this.enforceBinaryV14(id, actorUserId);
    return this.getAdvancedConfiguration(id);
  }

  override async changeSeasonStatus(
    id: string,
    dto: OwnerSeasonStatusDto,
    actorUserId: string,
  ) {
    if (dto.status === 'REVIEW' || dto.status === 'ACTIVE') {
      await this.enforceBinaryV14(id, actorUserId);
    }
    return super.changeSeasonStatus(id, dto, actorUserId);
  }

  override async getAdvancedConfiguration(id: string) {
    const config = await super.getAdvancedConfiguration(id);
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
    };
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
