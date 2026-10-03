import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { BinaryPolicyService } from '../binary-policy/binary-policy.service';
import { FinancialDbService } from '../database/financial-db.service';
import { PrismaService } from '../database/prisma.service';
import { GenealogyService } from '../genealogy/genealogy.service';
import {
  AuditAction,
  BinaryCapOverflowMode,
  ProgramIntervalUnit,
  ReferralRewardMode,
  ReferralRoundingMode,
} from '../generated/prisma/enums';
import { LedgerService } from '../ledger/ledger.service';
import { LuckyDrawExecutionService } from '../lucky-draw/lucky-draw-execution.service';
import { LuckyDrawPolicyService } from '../lucky-draw/lucky-draw-policy.service';
import { ProgramPaymentService } from '../program/program-payment.service';
import { ProgramPolicyService } from '../program/program-policy.service';
import { ReferralRewardPolicyService } from '../referral-reward/referral-reward-policy.service';
import { UsersService } from '../users/users.service';
import { OwnerPrizeMediaStore } from './owner-prize-media.store';
import type {
  ApproveOwnerDrawDto,
  ConsumeOwnerAuthCodeDto,
  CreateOwnerMemberDto,
  CreateOwnerNotificationDto,
  CreateOwnerSeasonDto,
  CreateSupportTicketDto,
  GenerateEpinsDto,
  GenerateOwnerAuthCodeDto,
  OwnerSeasonPrizeDto,
  OwnerSeasonStatusDto,
  PrepareOwnerDrawDto,
  RecordOwnerPaymentDto,
  RevokeEpinDto,
  SendOwnerNotificationDto,
  UpdateOwnerPortalSettingsDto,
  UpdateOwnerSeasonDto,
  UpdateSupportTicketDto,
  VerifyOwnerWinnerDto,
} from './owner-portal.dto';

type SqlValue = string | number | bigint | boolean | Date | null;
type SeasonStatus = 'DRAFT' | 'REVIEW' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'ARCHIVED';
type PrizeMediaUpload = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

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
  registrationFee?: string | number | null;
  installmentAmount?: string | number | null;
  installmentCount?: number | null;
  pairPayoutAmount?: string | number | null;
  dailyPairCap?: number | null;
  carryForwardEnabled?: boolean | number | null;
  fixedAmount?: string | number | null;
  currencyCode?: string | null;
  settlementTimezone?: string | null;
};

type DrawRunRow = {
  id: string;
  seasonId: string;
  monthNumber: number;
  policyId: string;
  policyVersionId: string;
  drawId: string;
  status: string;
  selectionMode: 'AUTO' | 'MANUAL_EXTERNAL';
  eligibilityLockedAt: Date | null;
  verifiedAt: Date | null;
  approvedAt: Date | null;
  publishedAt: Date | null;
  approvalReference: string | null;
  approvalNote: string | null;
};

type ResolvedUser = {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
};

type OwnerPortalSettings = {
  companyName: string;
  timezone: string;
  currencyCode: string;
  defaultLanguage: string;
  updatedAt: Date | string;
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
export class OwnerPortalService {
  constructor(
    private readonly db: FinancialDbService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly genealogy: GenealogyService,
    private readonly programs: ProgramPolicyService,
    private readonly programPayments: ProgramPaymentService,
    private readonly binaryPolicies: BinaryPolicyService,
    private readonly referralPolicies: ReferralRewardPolicyService,
    private readonly drawPolicies: LuckyDrawPolicyService,
    private readonly draws: LuckyDrawExecutionService,
    private readonly ledger: LedgerService,
    private readonly prizeMedia: OwnerPrizeMediaStore,
  ) {}

  async dashboard() {
    const [members, pairs, activeSeason, openTickets, pendingNotifications] = await Promise.all([
      this.rows<{ count: bigint | number | string }>('SELECT COUNT(*) AS count FROM `users`'),
      this.rows<{ count: bigint | number | string }>(
        'SELECT COUNT(*) AS count FROM `binary_pair_matches` WHERE `payable` = TRUE',
      ),
      this.rows<SeasonRow>(
        `SELECT s.*, bpv.pairPayoutAmount, bpv.dailyPairCap, bpv.currencyCode, bpv.settlementTimezone
         FROM owner_seasons s
         LEFT JOIN binary_plan_versions bpv ON bpv.id = s.binaryPlanVersionId
         WHERE s.status IN ('ACTIVE','PAUSED')
         ORDER BY s.startDate DESC LIMIT 1`,
      ),
      this.rows<{ count: bigint | number | string }>(
        "SELECT COUNT(*) AS count FROM owner_support_tickets WHERE status IN ('OPEN','IN_PROGRESS')",
      ),
      this.rows<{ count: bigint | number | string }>(
        "SELECT COUNT(*) AS count FROM owner_notifications WHERE status IN ('DRAFT','SCHEDULED','QUEUED')",
      ),
    ]);
    const season = activeSeason[0] ?? null;
    const pairValue = Number(season?.pairPayoutAmount ?? 0);
    const pairCap = Number(season?.dailyPairCap ?? 0);
    return {
      activeSeason: season,
      memberCount: Number(members[0]?.count ?? 0),
      qualifiedPairs: Number(pairs[0]?.count ?? 0),
      dailyCap: pairValue * pairCap,
      openTickets: Number(openTickets[0]?.count ?? 0),
      pendingNotifications: Number(pendingNotifications[0]?.count ?? 0),
    };
  }

  async listMembers(query?: string) {
    const q = query?.trim();
    const values: SqlValue[] = [];
    let where = '';
    if (q) {
      where = 'WHERE u.username LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR CONCAT(COALESCE(u.firstName,\'\'), \' \', COALESCE(u.lastName,\'\')) LIKE ?';
      const like = `%${q}%`;
      values.push(like, like, like, like);
    }
    return this.rows<Record<string, unknown>>(
      `SELECT u.id, u.username, u.email, u.phone, u.firstName, u.lastName, u.status, u.createdAt,
              mp.dateOfBirth, mp.state, mp.city, mp.memberType,
              sponsor.username AS sponsorUsername,
              parent.username AS placementParentUsername,
              bp.side AS placementSide
       FROM users u
       LEFT JOIN member_profiles mp ON mp.userId = u.id
       LEFT JOIN sponsor_relationships sr ON sr.memberUserId = u.id
       LEFT JOIN users sponsor ON sponsor.id = sr.sponsorUserId
       LEFT JOIN binary_placements bp ON bp.memberUserId = u.id
       LEFT JOIN users parent ON parent.id = bp.parentUserId
       ${where}
       ORDER BY u.createdAt DESC LIMIT 100`,
      values,
    );
  }

  async createMember(dto: CreateOwnerMemberDto, actorUserId: string) {
    if (dto.epin) await this.requireUsableEpin(dto.epin);
    const nameParts = dto.fullName.trim().split(/\s+/);
    const firstName = nameParts.shift() ?? dto.fullName.trim();
    const lastName = nameParts.join(' ') || undefined;
    const user = await this.users.createManaged(
      {
        username: dto.username,
        email: dto.email,
        phone: dto.phone,
        password: dto.password,
        firstName,
        lastName,
      },
      actorUserId,
    );

    await this.db.execute(
      `INSERT INTO member_profiles (userId, dateOfBirth, state, city, memberType)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE dateOfBirth=VALUES(dateOfBirth), state=VALUES(state), city=VALUES(city), memberType=VALUES(memberType)`,
      [
        user.id,
        dto.dateOfBirth ? new Date(`${dto.dateOfBirth}T00:00:00.000Z`) : null,
        dto.state?.trim() || null,
        dto.city?.trim() || null,
        dto.memberType,
      ],
    );

    const sponsor = dto.sponsorReference
      ? await this.resolveUser(dto.sponsorReference)
      : null;
    if (sponsor) {
      await this.genealogy.assignSponsor(
        { memberUserId: user.id, sponsorUserId: sponsor.id },
        actorUserId,
      );
    }

    const placementRoot = dto.placementReference
      ? await this.resolveUser(dto.placementReference)
      : sponsor;
    if (placementRoot) {
      if (dto.placement === 'AUTO') {
        await this.autoPlace(user.id, placementRoot.id, actorUserId);
      } else {
        await this.genealogy.assignPlacement(
          {
            memberUserId: user.id,
            parentUserId: placementRoot.id,
            slot: dto.placement,
          },
          actorUserId,
        );
      }
    } else if (dto.placement !== 'AUTO') {
      throw new BadRequestException('Placement reference is required for a fixed A/B/C/D slot');
    }

    if (dto.epin) await this.consumeEpin(dto.epin, user.id, actorUserId);
    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'OwnerMemberProfile',
      entityId: user.id,
      description: 'Owner portal member registration completed',
      metadata: { memberType: dto.memberType, placement: dto.placement },
    });
    return this.memberDetail(user.id);
  }

  async memberDetail(userId: string) {
    const member = await this.genealogy.getMember(userId);
    const profile = await this.rows<Record<string, unknown>>(
      'SELECT dateOfBirth, state, city, memberType FROM member_profiles WHERE userId = ? LIMIT 1',
      [userId],
    );
    return { ...member, profile: profile[0] ?? null };
  }

  async binaryMember(reference: string) {
    const user = await this.resolveUser(reference);
    return this.memberDetail(user.id);
  }

  async assignPlacement(
    memberReference: string,
    parentReference: string,
    slot: 'A' | 'B' | 'C' | 'D' | 'AUTO',
    actorUserId: string,
  ) {
    const [member, parent] = await Promise.all([
      this.resolveUser(memberReference),
      this.resolveUser(parentReference),
    ]);
    return slot === 'AUTO'
      ? this.autoPlace(member.id, parent.id, actorUserId)
      : this.genealogy.assignPlacement(
          {
            memberUserId: member.id,
            parentUserId: parent.id,
            slot,
          },
          actorUserId,
        );
  }

  async listPairLedger(limit = 100) {
    return this.rows<Record<string, unknown>>(
      `SELECT bpm.id, bpm.pairSequence, bpm.memberUserId, u.username,
              bpm.leftUnitId, bpm.rightUnitId, bpm.payoutAmount, bpm.payable, bpm.createdAt
       FROM binary_pair_matches bpm
       JOIN users u ON u.id = bpm.memberUserId
       ORDER BY bpm.createdAt DESC LIMIT ?`,
      [Math.max(1, Math.min(500, limit))],
    );
  }

  async listSeasons() {
    const rows = await this.rows<SeasonRow>(
      this.seasonSelectSql('ORDER BY s.startDate DESC, s.createdAt DESC'),
    );
    return rows.map((row) => this.formatSeason(row));
  }

  async getSeason(id: string) {
    const rows = await this.rows<SeasonRow>(this.seasonSelectSql('WHERE s.id = ? LIMIT 1'), [id]);
    if (!rows[0]) throw new NotFoundException('Season not found');
    const prizes = await this.listSeasonPrizes(id);
    return { ...this.formatSeason(rows[0]), prizes };
  }

  async createSeason(dto: CreateOwnerSeasonDto, actorUserId: string) {
    const code = this.normalizeSeasonCode(dto.code || this.generatedSeasonCode());
    const existing = await this.rows<{ id: string }>('SELECT id FROM owner_seasons WHERE code = ? LIMIT 1', [code]);
    if (existing.length) throw new ConflictException('Season code already exists');
    this.validateSeasonMoney(dto);
    const settings = await this.requireSettings();

    const effectiveFrom = this.dayStart(dto.startDate);
    const effectiveTo = dto.endDate ? this.dayEnd(dto.endDate) : undefined;
    const program = await this.programs.createProgram(
      { code: this.policyCode(code, 'PROGRAM'), name: `${dto.name} Membership`, description: dto.description },
      actorUserId,
    );
    const programVersion = await this.programs.createVersion(
      program.id,
      {
        effectiveFrom,
        ...(effectiveTo ? { effectiveTo } : {}),
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
        eligibilityRules: { ownerSeasonCode: code, eligibilityCutoff: dto.eligibilityCutoff },
      },
      actorUserId,
    );

    const pairValue = Number(dto.pairValue);
    const dailyPairCap = pairValue > 0 ? Math.floor(dto.dailyCap / pairValue) : 0;
    const binary = await this.binaryPolicies.createPlan(
      { code: this.policyCode(code, 'BINARY'), name: `${dto.name} Binary 2:2`, description: 'AB : CD 2:2 owner season plan' },
      actorUserId,
    );
    const binaryVersion = await this.binaryPolicies.createVersion(
      binary.id,
      {
        effectiveFrom,
        ...(effectiveTo ? { effectiveTo } : {}),
        qualifyingUnit: '1.0000',
        leftVolumePerPair: '2.0000',
        rightVolumePerPair: '2.0000',
        pairPayoutAmount: dto.pairValue,
        currencyCode: settings.currencyCode,
        settlementTimezone: settings.timezone,
        capOverflowMode: dto.carryForward ? BinaryCapOverflowMode.CARRY : BinaryCapOverflowMode.FLUSH,
        dailyPairCap,
        carryForwardEnabled: dto.carryForward,
        qualificationRules: { ownerSeasonCode: code, displayModel: 'AB:CD', pairRule: 'AC+BD' },
        settlementRules: { dailyPayoutCapAmount: dto.dailyCap.toFixed(2), ownerSeasonCode: code },
      },
      actorUserId,
    );

    const referral = await this.referralPolicies.createPolicy(
      { code: this.policyCode(code, 'DIRECT'), name: `${dto.name} Direct Referral`, description: 'Qualifying direct referral reward' },
      actorUserId,
    );
    const referralVersion = await this.referralPolicies.createVersion(
      referral.id,
      {
        effectiveFrom,
        ...(effectiveTo ? { effectiveTo } : {}),
        rewardMode: ReferralRewardMode.FIXED,
        fixedAmount: dto.directReferral,
        currencyCode: settings.currencyCode,
        roundingMode: ReferralRoundingMode.HALF_UP,
        eligibilityRules: { ownerSeasonCode: code, qualifyingReferralRequired: true },
      },
      actorUserId,
    );

    const id = randomUUID();
    await this.db.execute(
      `INSERT INTO owner_seasons
       (id, code, name, description, status, startDate, endDate, drawDay, eligibilityCutoff,
        programId, programVersionId, binaryPlanId, binaryPlanVersionId, referralPolicyId, referralPolicyVersionId, createdByUserId)
       VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        code,
        dto.name.trim(),
        dto.description?.trim() || null,
        dto.startDate.slice(0, 10),
        dto.endDate ? dto.endDate.slice(0, 10) : null,
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
    await this.saveSeasonPrizesInternal(
      id,
      dto.prizes?.length ? dto.prizes : this.defaultPrizes(dto.totalMonths),
      settings.currencyCode,
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'OwnerSeason',
      entityId: id,
      description: 'Owner season draft created',
      metadata: { code, currencyCode: settings.currencyCode, timezone: settings.timezone },
    });
    return this.getSeason(id);
  }

  async updateSeason(id: string, dto: UpdateOwnerSeasonDto, actorUserId: string) {
    const current = await this.requireSeason(id);
    if (!['DRAFT', 'REVIEW'].includes(current.status)) {
      throw new ConflictException('Active or closed seasons cannot be edited; create a new season/version instead');
    }
    this.validateSeasonMoney(dto);
    if (!current.programVersionId || !current.binaryPlanVersionId || !current.referralPolicyVersionId) {
      throw new ConflictException('Season policy mapping is incomplete');
    }
    const settings = await this.requireSettings();
    const effectiveFrom = this.dayStart(dto.startDate);
    const effectiveTo = dto.endDate ? this.dayEnd(dto.endDate) : undefined;
    await this.programs.updateDraft(
      current.programVersionId,
      {
        effectiveFrom,
        ...(effectiveTo ? { effectiveTo } : {}),
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
        eligibilityRules: { ownerSeasonCode: current.code, eligibilityCutoff: dto.eligibilityCutoff },
      },
      actorUserId,
    );
    const pairValue = Number(dto.pairValue);
    await this.binaryPolicies.updateDraft(
      current.binaryPlanVersionId,
      {
        effectiveFrom,
        ...(effectiveTo ? { effectiveTo } : {}),
        qualifyingUnit: '1.0000',
        leftVolumePerPair: '2.0000',
        rightVolumePerPair: '2.0000',
        pairPayoutAmount: dto.pairValue,
        currencyCode: settings.currencyCode,
        settlementTimezone: settings.timezone,
        capOverflowMode: dto.carryForward ? BinaryCapOverflowMode.CARRY : BinaryCapOverflowMode.FLUSH,
        dailyPairCap: Math.floor(dto.dailyCap / pairValue),
        carryForwardEnabled: dto.carryForward,
        qualificationRules: { ownerSeasonCode: current.code, displayModel: 'AB:CD', pairRule: 'AC+BD' },
        settlementRules: { dailyPayoutCapAmount: dto.dailyCap.toFixed(2), ownerSeasonCode: current.code },
      },
      actorUserId,
    );
    await this.referralPolicies.updateDraft(
      current.referralPolicyVersionId,
      {
        effectiveFrom,
        ...(effectiveTo ? { effectiveTo } : {}),
        rewardMode: ReferralRewardMode.FIXED,
        fixedAmount: dto.directReferral,
        currencyCode: settings.currencyCode,
        roundingMode: ReferralRoundingMode.HALF_UP,
        eligibilityRules: { ownerSeasonCode: current.code, qualifyingReferralRequired: true },
      },
      actorUserId,
    );
    await this.db.execute(
      `UPDATE owner_seasons SET name=?, description=?, startDate=?, endDate=?, drawDay=COALESCE(?, drawDay), eligibilityCutoff=? WHERE id=?`,
      [
        dto.name.trim(),
        dto.description?.trim() || null,
        dto.startDate.slice(0, 10),
        dto.endDate ? dto.endDate.slice(0, 10) : null,
        dto.drawDay ?? null,
        dto.eligibilityCutoff,
        id,
      ],
    );
    if (dto.prizes) {
      await this.saveSeasonPrizesInternal(id, dto.prizes, settings.currencyCode);
    }
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerSeason',
      entityId: id,
      description: 'Owner season draft updated',
      metadata: { currencyCode: settings.currencyCode, timezone: settings.timezone },
    });
    return this.getSeason(id);
  }

  async changeSeasonStatus(id: string, dto: OwnerSeasonStatusDto, actorUserId: string) {
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
      throw new ConflictException(`Season cannot move from ${season.status} to ${target}`);
    }
    if (target === 'ACTIVE' && season.status === 'REVIEW') {
      if (!season.programVersionId || !season.binaryPlanVersionId || !season.referralPolicyVersionId) {
        throw new ConflictException('Season policy mapping is incomplete');
      }
      await this.programs.publish(season.programVersionId, actorUserId);
      await this.binaryPolicies.publish(season.binaryPlanVersionId, actorUserId);
      await this.referralPolicies.publish(season.referralPolicyVersionId, actorUserId);
    }
    if (target === 'CLOSED') {
      if (season.programVersionId) await this.programs.retire(season.programVersionId, actorUserId);
      if (season.binaryPlanVersionId) await this.binaryPolicies.retire(season.binaryPlanVersionId, actorUserId);
      if (season.referralPolicyVersionId) await this.referralPolicies.retire(season.referralPolicyVersionId, actorUserId);
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
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerSeason',
      entityId: id,
      description: `Owner season status changed to ${target}`,
      metadata: { from: season.status, to: target },
    });
    return this.getSeason(id);
  }

  async listSeasonPrizes(seasonId: string) {
    return this.rows<Record<string, unknown>>(
      `SELECT id, seasonId, monthNumber, prizeCode, category, name, description,
              mediaId, mediaName, mediaMimeType,
              winnerCount, nominalValue, currencyCode, status
       FROM owner_season_prizes WHERE seasonId=? ORDER BY monthNumber ASC, createdAt ASC`,
      [seasonId],
    );
  }

  async uploadSeasonPrizeMedia(
    seasonId: string,
    file: PrizeMediaUpload | undefined,
    actorUserId: string,
  ) {
    const season = await this.requireSeason(seasonId);
    if (!['DRAFT', 'REVIEW'].includes(season.status)) {
      throw new ConflictException('Prize media is locked after season activation');
    }
    if (!file?.buffer?.length) throw new BadRequestException('Choose a prize image or PDF to upload');
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException('Prize attachment must be 5 MB or smaller');
    const contentType = this.detectPrizeMediaType(file.buffer);
    if (!contentType || contentType !== file.mimetype.toLowerCase()) {
      throw new BadRequestException('Prize attachment must be a valid JPEG, PNG, WEBP or PDF file');
    }
    const media = await this.prizeMedia.upload({
      seasonId,
      actorUserId,
      originalName: file.originalname,
      contentType,
      buffer: file.buffer,
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'OwnerSeasonPrizeMedia',
      entityId: media.id,
      description: 'Prize catalogue attachment uploaded',
      metadata: { seasonId, contentType: media.contentType, length: media.length, sha256: media.sha256 },
    });
    return media;
  }

  async openPrizeMedia(mediaId: string) {
    const media = await this.prizeMedia.open(mediaId);
    if (!media) throw new NotFoundException('Prize attachment not found');
    return media;
  }

  async saveSeasonPrizes(seasonId: string, prizes: OwnerSeasonPrizeDto[], actorUserId: string) {
    const season = await this.requireSeason(seasonId);
    if (!['DRAFT', 'REVIEW'].includes(season.status)) {
      throw new ConflictException('Prize schedule is locked after season activation');
    }
    const currencyCode =
      season.currencyCode?.toUpperCase() ?? (await this.requireSettings()).currencyCode;
    await this.saveSeasonPrizesInternal(seasonId, prizes, currencyCode);
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerSeasonPrizeSchedule',
      entityId: seasonId,
      description: 'Season prize schedule updated',
      metadata: { prizeCount: prizes.length, currencyCode },
    });
    return this.listSeasonPrizes(seasonId);
  }

  async prepareDraw(seasonId: string, dto: PrepareOwnerDrawDto, actorUserId: string) {
    const season = await this.requireSeason(seasonId);
    if (season.status !== 'ACTIVE') throw new ConflictException('Only an active season can schedule a draw');
    if (!season.programVersionId) throw new ConflictException('Season program version is missing');
    const existing = await this.rows<DrawRunRow>(
      'SELECT * FROM owner_draw_runs WHERE seasonId=? AND monthNumber=? LIMIT 1',
      [seasonId, dto.monthNumber],
    );
    if (existing[0]) return this.drawRun(existing[0].id);
    const prizes = await this.rows<{
      prizeCode: string;
      name: string;
      winnerCount: number;
      nominalValue: string | null;
      currencyCode: string;
    }>(
      `SELECT prizeCode, name, winnerCount, nominalValue, currencyCode FROM owner_season_prizes
       WHERE seasonId=? AND monthNumber=? AND status='ACTIVE' ORDER BY createdAt ASC`,
      [seasonId, dto.monthNumber],
    );
    if (!prizes.length) throw new BadRequestException('Configure at least one prize for this draw month');

    const runId = randomUUID();
    const policy = await this.drawPolicies.createPolicy(
      {
        code: this.policyCode(`${season.code}M${dto.monthNumber}`, 'DRAW'),
        name: `${season.name} Month ${dto.monthNumber} Draw`,
        description: `Month ${dto.monthNumber} prize schedule`,
      },
      actorUserId,
    );
    const policyVersion = await this.drawPolicies.createVersion(
      policy.id,
      {
        programVersionId: season.programVersionId,
        effectiveFrom: dto.entryWindowStart,
        effectiveTo: dto.drawAt,
        entryMode: 'ONE_PER_USER',
        priorWinnerMode: 'ALLOW',
        allowMultipleWinsPerDraw: false,
        insufficientEntrantsMode: 'DRAW_AVAILABLE',
        prizeTiers: prizes.map((prize) => ({
          code: prize.prizeCode,
          name: prize.name,
          winnerCount: Number(prize.winnerCount),
          prizeKind: 'ITEM' as const,
          ...(prize.nominalValue
            ? {
                prizeDefinition: {
                  nominalValue: String(prize.nominalValue),
                  currencyCode: prize.currencyCode,
                },
              }
            : { prizeDefinition: {} }),
        })),
      },
      actorUserId,
    );
    await this.drawPolicies.publish(policyVersion.id, actorUserId);
    const seed = this.drawSeed(runId);
    const { draw } = await this.draws.createInstance(
      {
        sourceKey: `owner-draw:${runId}`,
        policyVersionId: policyVersion.id,
        entryWindowStart: dto.entryWindowStart,
        entryWindowEnd: dto.entryWindowEnd,
        drawAt: dto.drawAt,
        seedCommitment: createHash('sha256').update(seed).digest('hex'),
      },
      actorUserId,
    );
    await this.db.execute(
      `INSERT INTO owner_draw_runs
       (id, seasonId, monthNumber, policyId, policyVersionId, drawId, status, createdByUserId)
       VALUES (?, ?, ?, ?, ?, ?, 'SCHEDULED', ?)`,
      [runId, seasonId, dto.monthNumber, policy.id, policyVersion.id, draw.id, actorUserId],
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'OwnerDrawRun',
      entityId: runId,
      description: 'Monthly draw prepared from season prize schedule',
      metadata: { seasonId, monthNumber: dto.monthNumber, drawId: draw.id },
    });
    return this.drawRun(runId);
  }

  async listDrawRuns(seasonId?: string) {
    const values: SqlValue[] = [];
    const where = seasonId ? 'WHERE odr.seasonId=?' : '';
    if (seasonId) values.push(seasonId);
    return this.rows<Record<string, unknown>>(
      `SELECT odr.*, s.code AS seasonCode, s.name AS seasonName, ldi.drawAt, ldi.candidateCount,
              ldi.eligibleEntryCount, ldi.winnerCount, ldi.status AS engineStatus
       FROM owner_draw_runs odr
       JOIN owner_seasons s ON s.id=odr.seasonId
       JOIN lucky_draw_instances ldi ON ldi.id=odr.drawId
       ${where}
       ORDER BY ldi.drawAt DESC`,
      values,
    );
  }

  async drawRun(runId: string) {
    const runs = await this.rows<DrawRunRow & Record<string, unknown>>(
      `SELECT odr.*, s.code AS seasonCode, s.name AS seasonName, ldi.drawAt, ldi.candidateCount,
              ldi.eligibleEntryCount, ldi.excludedEntryCount, ldi.winnerCount, ldi.status AS engineStatus
       FROM owner_draw_runs odr
       JOIN owner_seasons s ON s.id=odr.seasonId
       JOIN lucky_draw_instances ldi ON ldi.id=odr.drawId
       WHERE odr.id=? LIMIT 1`,
      [runId],
    );
    if (!runs[0]) throw new NotFoundException('Draw run not found');
    const [winners, prizeTiers] = await Promise.all([
      this.drawWinners(runId),
      this.rows<Record<string, unknown>>(
        `SELECT id, tierOrder, code, name, winnerCount, prizeKind
         FROM lucky_draw_prize_tiers
         WHERE policyVersionId=? ORDER BY tierOrder ASC`,
        [runs[0].policyVersionId],
      ),
    ]);
    return { ...runs[0], winners, prizeTiers };
  }

  async lockDrawEligibility(runId: string, actorUserId: string) {
    const run = await this.requireDrawRun(runId);
    if (run.status !== 'SCHEDULED') throw new ConflictException('Eligibility can only be locked for a scheduled draw');
    await this.draws.snapshotEntrants(run.drawId, actorUserId);
    await this.db.execute(
      "UPDATE owner_draw_runs SET status='ELIGIBILITY_LOCKED', eligibilityLockedAt=CURRENT_TIMESTAMP(3) WHERE id=?",
      [runId],
    );
    return this.drawRun(runId);
  }

  async executeDraw(runId: string, actorUserId: string) {
    const run = await this.requireDrawRun(runId);
    if (run.status !== 'ELIGIBILITY_LOCKED') {
      throw new ConflictException('Lock eligibility before running winner selection');
    }
    if (run.selectionMode !== 'AUTO') {
      throw new ConflictException('This draw is configured for manual external winner recording');
    }
    await this.draws.execute(run.drawId, { selectionSeed: this.drawSeed(runId) }, actorUserId);
    await this.db.execute("UPDATE owner_draw_runs SET status='SELECTED' WHERE id=?", [runId]);
    await this.db.execute(
      `INSERT IGNORE INTO owner_winner_verifications
       (winnerId, drawRunId, eligibilityStatus, identityStatus, paymentStatus, status)
       SELECT w.id, ?, 'PASS', 'PENDING', 'PASS', 'PENDING'
       FROM lucky_draw_winners w WHERE w.drawId=?`,
      [runId, run.drawId],
    );
    return this.drawRun(runId);
  }

  async verifyWinner(runId: string, winnerId: string, dto: VerifyOwnerWinnerDto, actorUserId: string) {
    const run = await this.requireDrawRun(runId);
    if (!['SELECTED', 'VERIFICATION'].includes(run.status)) {
      throw new ConflictException('Winner verification is not available at this stage');
    }
    const status =
      dto.eligibilityStatus === 'PASS' &&
      dto.identityStatus === 'PASS' &&
      dto.paymentStatus === 'PASS'
        ? 'VERIFIED'
        : 'FAILED';
    const changed = await this.db.transaction(async (connection) => {
      const result = (await connection.query(
        `UPDATE owner_winner_verifications
         SET eligibilityStatus=?, identityStatus=?, paymentStatus=?, status=?, verifiedByUserId=?, verifiedAt=CURRENT_TIMESTAMP(3)
         WHERE winnerId=? AND drawRunId=?`,
        [
          dto.eligibilityStatus,
          dto.identityStatus,
          dto.paymentStatus,
          status,
          actorUserId,
          winnerId,
          runId,
        ],
      )) as { affectedRows?: number };
      return Number(result.affectedRows ?? 0);
    });
    if (!changed) throw new NotFoundException('Winner record not found for this draw');
    const pending = await this.rows<{ count: bigint | number | string }>(
      "SELECT COUNT(*) AS count FROM owner_winner_verifications WHERE drawRunId=? AND status='PENDING'",
      [runId],
    );
    await this.db.execute(
      `UPDATE owner_draw_runs SET status=?, verifiedAt=? WHERE id=?`,
      [Number(pending[0]?.count ?? 0) === 0 ? 'VERIFIED' : 'VERIFICATION', Number(pending[0]?.count ?? 0) === 0 ? new Date() : null, runId],
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerWinnerVerification',
      entityId: winnerId,
      description: `Winner verification recorded as ${status}`,
      metadata: dto,
    });
    return this.drawRun(runId);
  }

  async approveDraw(runId: string, dto: ApproveOwnerDrawDto, actorUserId: string) {
    const run = await this.requireDrawRun(runId);
    if (run.status !== 'VERIFIED') throw new ConflictException('Verify every selected winner before approval');
    const failed = await this.rows<{ count: bigint | number | string }>(
      "SELECT COUNT(*) AS count FROM owner_winner_verifications WHERE drawRunId=? AND status<>'VERIFIED'",
      [runId],
    );
    if (Number(failed[0]?.count ?? 0) > 0) {
      throw new ConflictException('All winners must pass verification before approval');
    }
    if (dto.authorizationCode) {
      await this.consumeAuthCode(
        { code: dto.authorizationCode, purpose: 'WINNER_APPROVAL' },
        actorUserId,
      );
    }
    await this.db.execute(
      `UPDATE owner_draw_runs
       SET status='APPROVED', approvedAt=CURRENT_TIMESTAMP(3), approvalReference=?, approvalNote=? WHERE id=?`,
      [dto.approvalReference.trim(), dto.approvalNote?.trim() || null, runId],
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerDrawRun',
      entityId: runId,
      description: 'Verified winners approved',
      metadata: { approvalReference: dto.approvalReference },
    });
    return this.drawRun(runId);
  }

  async publishDraw(runId: string, actorUserId: string) {
    const run = await this.requireDrawRun(runId);
    if (run.status !== 'APPROVED') throw new ConflictException('Approve verified winners before publication');
    await this.db.execute(
      "UPDATE owner_draw_runs SET status='PUBLISHED', publishedAt=CURRENT_TIMESTAMP(3) WHERE id=?",
      [runId],
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerDrawRun',
      entityId: runId,
      description: 'Approved winner list published',
    });
    return this.drawRun(runId);
  }

  async drawWinners(runId: string) {
    return this.rows<Record<string, unknown>>(
      `SELECT w.id, w.userId, u.username, u.firstName, u.lastName,
              t.code AS prizeCode, t.name AS prizeName, t.winnerCount AS prizeWinnerCount,
              w.overallRank, w.tierWinnerPosition, e.drawToken,
              v.eligibilityStatus, v.identityStatus, v.paymentStatus, v.status AS verificationStatus,
              c.id AS claimId, c.status AS claimStatus
       FROM owner_draw_runs r
       JOIN lucky_draw_winners w ON w.drawId=r.drawId
       JOIN lucky_draw_entries e ON e.id=w.entryId
       JOIN users u ON u.id=w.userId
       JOIN lucky_draw_prize_tiers t ON t.id=w.prizeTierId
       LEFT JOIN owner_winner_verifications v ON v.winnerId=w.id
       LEFT JOIN lucky_draw_prize_claims c ON c.winnerId=w.id
       WHERE r.id=? ORDER BY w.overallRank ASC`,
      [runId],
    );
  }

  async generateEpins(dto: GenerateEpinsDto, actorUserId: string) {
    const expiresAt = new Date(dto.expiresAt);
    if (expiresAt <= new Date()) throw new BadRequestException('E-PIN expiry must be in the future');
    const season = await this.requireSeason(dto.seasonId);
    if (season.status !== 'ACTIVE') {
      throw new ConflictException('E-PINs can only be generated for an active season');
    }
    const currencyCode = season.currencyCode?.trim().toUpperCase();
    const registrationFee = Number(season.registrationFee ?? NaN);
    const installmentAmount = Number(season.installmentAmount ?? NaN);
    if (
      !currencyCode ||
      !Number.isFinite(registrationFee) ||
      registrationFee < 0 ||
      !Number.isFinite(installmentAmount) ||
      installmentAmount <= 0
    ) {
      throw new ConflictException('Season commercial values are incomplete for E-PIN generation');
    }
    const pinType = dto.pinType ?? 'ACTIVATION';
    const registrationFeeSnapshot = pinType === 'ACTIVATION' ? registrationFee : 0;
    const assigned = dto.assignUserReference ? await this.resolveUser(dto.assignUserReference) : null;
    const generated: { id: string; pin: string; expiresAt: Date; pinType: string }[] = [];
    for (let index = 0; index < dto.quantity; index += 1) {
      const id = randomUUID();
      const raw = this.readableSecret('MGC-PIN');
      await this.db.execute(
        `INSERT INTO owner_epins
         (id, pinHash, displaySuffix, seasonId, pinType, assignedUserId, status, expiresAt,
          currencyCodeSnapshot, registrationFeeSnapshot, installmentAmountSnapshot, createdByUserId)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)`,
        [
          id,
          this.secretHash('epin', raw),
          raw.slice(-6),
          season.id,
          pinType,
          assigned?.id ?? null,
          expiresAt,
          currencyCode,
          registrationFeeSnapshot.toFixed(2),
          installmentAmount.toFixed(2),
          actorUserId,
        ],
      );
      generated.push({ id, pin: raw, expiresAt, pinType });
    }
    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'OwnerEpinBatch',
      description: 'Typed session-bound E-PIN batch generated',
      metadata: {
        quantity: dto.quantity,
        seasonId: season.id,
        pinType,
        assignedUserId: assigned?.id ?? null,
      },
    });
    return { generated };
  }

  async listEpins() {
    return this.rows<Record<string, unknown>>(
      `SELECT e.id, e.displaySuffix, e.status, e.expiresAt, e.usedAt, e.revokedAt, e.createdAt,
              s.code AS seasonCode, s.name AS seasonName,
              assigned.username AS assignedUsername, used.username AS usedByUsername
       FROM owner_epins e
       LEFT JOIN owner_seasons s ON s.id=e.seasonId
       LEFT JOIN users assigned ON assigned.id=e.assignedUserId
       LEFT JOIN users used ON used.id=e.usedByUserId
       ORDER BY e.createdAt DESC LIMIT 500`,
    );
  }

  async revokeEpin(id: string, dto: RevokeEpinDto, actorUserId: string) {
    const changed = await this.db.transaction(async (connection) => {
      const result = (await connection.query(
        "UPDATE owner_epins SET status='REVOKED', revokedAt=CURRENT_TIMESTAMP(3), revokedByUserId=? WHERE id=? AND status='ACTIVE'",
        [actorUserId, id],
      )) as { affectedRows?: number };
      return Number(result.affectedRows ?? 0);
    });
    if (!changed) throw new ConflictException('Only an active E-PIN can be revoked');
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerEpin',
      entityId: id,
      description: 'E-PIN revoked',
      metadata: { reason: dto.reason ?? null },
    });
    return { ok: true };
  }

  async generateAuthCode(dto: GenerateOwnerAuthCodeDto, actorUserId: string) {
    const raw = this.readableSecret('MGC-AUTH');
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + dto.validityMinutes * 60_000);
    await this.db.execute(
      `INSERT INTO owner_auth_codes
       (id, codeHash, displaySuffix, roleScope, purpose, operatorUserId, status, expiresAt)
       VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
      [id, this.secretHash('auth', raw), raw.slice(-6), dto.roleScope.trim().toUpperCase(), dto.purpose, actorUserId, expiresAt],
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'OwnerAuthCode',
      entityId: id,
      description: 'Purpose-bound operation authorization code generated',
      metadata: { purpose: dto.purpose, roleScope: dto.roleScope, expiresAt },
    });
    return { id, code: raw, expiresAt, purpose: dto.purpose };
  }

  async listAuthCodes() {
    return this.rows<Record<string, unknown>>(
      `SELECT id, displaySuffix, roleScope, purpose, status, expiresAt, usedAt, revokedAt, createdAt
       FROM owner_auth_codes ORDER BY createdAt DESC LIMIT 200`,
    );
  }

  async consumeAuthCode(dto: ConsumeOwnerAuthCodeDto, actorUserId: string) {
    const hash = this.secretHash('auth', dto.code);
    return this.db.transaction(async (connection) => {
      const rows = (await connection.query(
        `SELECT id, operatorUserId, expiresAt FROM owner_auth_codes
         WHERE codeHash=? AND purpose=? AND status='ACTIVE' LIMIT 1 FOR UPDATE`,
        [hash, dto.purpose],
      )) as { id: string; operatorUserId: string; expiresAt: Date }[];
      const row = rows[0];
      if (!row || new Date(row.expiresAt) <= new Date()) {
        throw new BadRequestException('Authorization code is invalid or expired');
      }
      await connection.query(
        "UPDATE owner_auth_codes SET status='USED', usedAt=CURRENT_TIMESTAMP(3) WHERE id=?",
        [row.id],
      );
      await this.audit.log({
        actorUserId,
        action: AuditAction.UPDATE,
        entityType: 'OwnerAuthCode',
        entityId: row.id,
        description: `Authorization code consumed for ${dto.purpose}`,
      });
      return { ok: true, id: row.id };
    });
  }

  async recordPayment(dto: RecordOwnerPaymentDto, actorUserId: string) {
    const user = await this.resolveUser(dto.memberReference);
    if (!dto.authorizationCode) {
      throw new BadRequestException('Admin / agent authorization code is required to record a manual payment');
    }
    await this.consumeAuthCode(
      { code: dto.authorizationCode, purpose: 'PAYMENT_AUTHORIZATION' },
      actorUserId,
    );
    const enrollment = await this.prisma.programEnrollment.findFirst({
      where: { userId: user.id, status: 'ACTIVE' },
      orderBy: { enrolledAt: 'desc' },
    });
    if (!enrollment) throw new NotFoundException('No active membership enrollment was found for this member');
    const sourceKey = `owner-payment:${randomUUID()}`;
    const { attempt } = await this.programPayments.createAttempt(
      {
        sourceKey,
        enrollmentId: enrollment.id,
        amount: dto.amount,
        currencyCode: enrollment.currencyCode,
        initiatedAt: new Date().toISOString(),
        provider: dto.paymentMode,
        providerReference: dto.transactionReference,
        metadata: { paymentType: dto.paymentType, ownerPortal: true },
      },
      actorUserId,
    );
    const payment = await this.programPayments.confirmAttempt(
      attempt.id,
      {
        sourceKey: `${sourceKey}:confirmed`,
        occurredAt: new Date().toISOString(),
        metadata: { paymentType: dto.paymentType, paymentMode: dto.paymentMode, ownerPortal: true },
      },
      actorUserId,
    );
    return { member: { id: user.id, username: user.username }, attempt, payment };
  }

  async wallet(memberReference: string, currencyCode?: string) {
    const user = await this.resolveUser(memberReference);
    const resolvedCurrency =
      currencyCode?.trim().toUpperCase() || (await this.requireSettings()).currencyCode;
    return this.ledger.getUserWallet(user.id, resolvedCurrency);
  }

  async createNotification(dto: CreateOwnerNotificationDto, actorUserId: string) {
    const id = randomUUID();
    await this.db.execute(
      `INSERT INTO owner_notifications
       (id, audience, channel, title, message, status, scheduledAt, createdByUserId)
       VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
      [id, dto.audience, dto.channel, dto.title.trim(), dto.message.trim(), dto.scheduledAt ? new Date(dto.scheduledAt) : null, actorUserId],
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'OwnerNotification',
      entityId: id,
      description: 'Notification draft created',
    });
    return this.getNotification(id);
  }

  async listNotifications() {
    return this.rows<Record<string, unknown>>(
      'SELECT * FROM owner_notifications ORDER BY createdAt DESC LIMIT 200',
    );
  }

  async sendNotification(id: string, dto: SendOwnerNotificationDto, actorUserId: string) {
    const rows = await this.rows<{ id: string; channel: string; status: string }>(
      'SELECT id, channel, status FROM owner_notifications WHERE id=? LIMIT 1',
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Notification not found');
    if (!['DRAFT', 'QUEUED', 'SCHEDULED'].includes(rows[0].status)) {
      throw new ConflictException('Notification is already finalized');
    }
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    const future = scheduledAt && scheduledAt.getTime() > Date.now();
    const status = future ? 'SCHEDULED' : rows[0].channel === 'PORTAL' ? 'SENT' : 'QUEUED';
    await this.db.execute(
      `UPDATE owner_notifications SET status=?, scheduledAt=?, sentAt=? WHERE id=?`,
      [status, scheduledAt, status === 'SENT' ? new Date() : null, id],
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerNotification',
      entityId: id,
      description:
        status === 'SENT'
          ? 'In-portal notification published'
          : status === 'SCHEDULED'
            ? 'Notification scheduled'
            : 'External-channel notification queued for provider delivery',
      metadata: { status },
    });
    return this.getNotification(id);
  }

  async createSupportTicket(dto: CreateSupportTicketDto, actorUserId: string) {
    const member = dto.memberReference ? await this.resolveUser(dto.memberReference, false) : null;
    const id = randomUUID();
    const ticketNumber = `MGC-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(3).toString('hex').toUpperCase()}`;
    await this.db.execute(
      `INSERT INTO owner_support_tickets
       (id, ticketNumber, memberUserId, memberReference, category, priority, contact, description, status, createdByUserId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
      [id, ticketNumber, member?.id ?? null, dto.memberReference?.trim() || null, dto.category.trim(), dto.priority, dto.contact?.trim() || null, dto.description.trim(), actorUserId],
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'OwnerSupportTicket',
      entityId: id,
      description: 'Support ticket created',
      metadata: { ticketNumber, priority: dto.priority },
    });
    return this.getSupportTicket(id);
  }

  async listSupportTickets() {
    return this.rows<Record<string, unknown>>(
      `SELECT t.*, u.username AS memberUsername, a.username AS assignedUsername
       FROM owner_support_tickets t
       LEFT JOIN users u ON u.id=t.memberUserId
       LEFT JOIN users a ON a.id=t.assignedUserId
       ORDER BY t.createdAt DESC LIMIT 200`,
    );
  }

  async updateSupportTicket(id: string, dto: UpdateSupportTicketDto, actorUserId: string) {
    const assigned = dto.assignedUserReference
      ? await this.resolveUser(dto.assignedUserReference)
      : null;
    const rows = await this.rows<{ id: string }>('SELECT id FROM owner_support_tickets WHERE id=? LIMIT 1', [id]);
    if (!rows[0]) throw new NotFoundException('Support ticket not found');
    await this.db.execute(
      'UPDATE owner_support_tickets SET status=?, assignedUserId=? WHERE id=?',
      [dto.status, assigned?.id ?? null, id],
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerSupportTicket',
      entityId: id,
      description: `Support ticket moved to ${dto.status}`,
      metadata: { assignedUserId: assigned?.id ?? null },
    });
    return this.getSupportTicket(id);
  }

  async settings() {
    return this.requireSettings();
  }

  async updateSettings(dto: UpdateOwnerPortalSettingsDto, actorUserId: string) {
    await this.db.execute(
      `UPDATE owner_portal_settings
       SET companyName=?, timezone=?, currencyCode=?, defaultLanguage=?, updatedByUserId=? WHERE id=1`,
      [dto.companyName.trim(), dto.timezone.trim(), dto.currencyCode.toUpperCase(), dto.defaultLanguage.trim(), actorUserId],
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerPortalSettings',
      entityId: '1',
      description: 'Owner portal organization settings updated',
    });
    return this.settings();
  }

  async recentActivity(limit = 50) {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(200, limit)),
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        description: true,
        actorUserId: true,
        createdAt: true,
      },
    });
  }

  reportCatalogue() {
    return [
      { code: 'MEMBERS', name: 'Member Registration', period: 'Current Season', formats: ['CSV', 'PDF'] },
      { code: 'BINARY', name: 'Binary 2:2 Pair Ledger', period: 'Current Month', formats: ['CSV', 'PDF'] },
      { code: 'INCOME', name: 'Income / Reward Ledger', period: 'Monthly', formats: ['CSV', 'PDF'] },
      { code: 'PAYMENTS', name: 'Payments & Reconciliation', period: 'Monthly', formats: ['CSV', 'PDF'] },
      { code: 'WINNERS', name: 'Draw Winners & Prizes', period: 'Per Draw', formats: ['CSV', 'PDF'] },
      { code: 'AUDIT', name: 'Audit Log', period: 'Custom Range', formats: ['CSV'] },
    ];
  }

  private async getNotification(id: string) {
    const rows = await this.rows<Record<string, unknown>>('SELECT * FROM owner_notifications WHERE id=? LIMIT 1', [id]);
    if (!rows[0]) throw new NotFoundException('Notification not found');
    return rows[0];
  }

  private async getSupportTicket(id: string) {
    const rows = await this.rows<Record<string, unknown>>('SELECT * FROM owner_support_tickets WHERE id=? LIMIT 1', [id]);
    if (!rows[0]) throw new NotFoundException('Support ticket not found');
    return rows[0];
  }

  private async requireSettings(): Promise<OwnerPortalSettings> {
    const rows = await this.rows<OwnerPortalSettings>(
      'SELECT companyName, timezone, currencyCode, defaultLanguage, updatedAt FROM owner_portal_settings WHERE id=1',
    );
    const settings = rows[0];
    if (!settings) throw new Error('Owner portal settings are missing');
    return {
      ...settings,
      timezone: settings.timezone.trim(),
      currencyCode: settings.currencyCode.trim().toUpperCase(),
    };
  }

  private async requireSeason(id: string) {
    const rows = await this.rows<SeasonRow>(this.seasonSelectSql('WHERE s.id=? LIMIT 1'), [id]);
    if (!rows[0]) throw new NotFoundException('Season not found');
    return rows[0];
  }

  private async requireDrawRun(id: string) {
    const rows = await this.rows<DrawRunRow>('SELECT * FROM owner_draw_runs WHERE id=? LIMIT 1', [id]);
    if (!rows[0]) throw new NotFoundException('Draw run not found');
    return rows[0];
  }

  private async resolveUser(reference: string): Promise<ResolvedUser>;
  private async resolveUser(reference: string, required: true): Promise<ResolvedUser>;
  private async resolveUser(reference: string, required: false): Promise<ResolvedUser | null>;
  private async resolveUser(reference: string, required = true): Promise<ResolvedUser | null> {
    const value = reference.trim();
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { id: value },
          { username: value },
          { email: value.toLowerCase() },
          { phone: value },
        ],
      },
      select: { id: true, username: true, email: true, phone: true },
    });
    if (!user && required) throw new NotFoundException(`Member not found: ${value}`);
    return user;
  }

  private async autoPlace(memberUserId: string, rootUserId: string, actorUserId: string) {
    return this.genealogy.autoPlace(memberUserId, rootUserId, actorUserId);
  }

  private async requireUsableEpin(raw: string) {
    const rows = await this.rows<{ id: string; assignedUserId: string | null; expiresAt: Date }>(
      "SELECT id, assignedUserId, expiresAt FROM owner_epins WHERE pinHash=? AND pinType='ACTIVATION' AND status='ACTIVE' LIMIT 1",
      [this.secretHash('epin', raw)],
    );
    const row = rows[0];
    if (!row || new Date(row.expiresAt) <= new Date()) throw new BadRequestException('E-PIN is invalid or expired');
    if (row.assignedUserId) throw new BadRequestException('This E-PIN is already assigned to an existing member');
    return row;
  }

  private async consumeEpin(raw: string, userId: string, actorUserId: string) {
    const hash = this.secretHash('epin', raw);
    const changed = await this.db.transaction(async (connection) => {
      const result = (await connection.query(
        `UPDATE owner_epins SET status='USED', usedByUserId=?, usedAt=CURRENT_TIMESTAMP(3)
         WHERE pinHash=? AND pinType='ACTIVATION' AND status='ACTIVE'
           AND expiresAt>CURRENT_TIMESTAMP(3) AND assignedUserId IS NULL`,
        [userId, hash],
      )) as { affectedRows?: number };
      return Number(result.affectedRows ?? 0);
    });
    if (!changed) throw new ConflictException('E-PIN was already used or expired during registration');
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerEpin',
      entityId: userId,
      description: 'E-PIN consumed during member registration',
    });
  }

  private async saveSeasonPrizesInternal(
    seasonId: string,
    prizes: OwnerSeasonPrizeDto[],
    currencyCode: string,
  ) {
    const normalizedCurrency = currencyCode.trim().toUpperCase();
    const season = await this.requireSeason(seasonId);
    const totalMonths = Number(season.installmentCount ?? 0);
    const prizeKeys = new Set<string>();
    for (const prize of prizes) {
      if (totalMonths > 0 && prize.monthNumber > totalMonths) {
        throw new BadRequestException(`Prize month ${prize.monthNumber} exceeds the season's ${totalMonths} configured months`);
      }
      const key = `${prize.monthNumber}:${prize.prizeCode.trim().toUpperCase()}`;
      if (prizeKeys.has(key)) {
        throw new BadRequestException(`Duplicate prize code ${prize.prizeCode} for month ${prize.monthNumber}`);
      }
      prizeKeys.add(key);
    }
    const media = new Map<string, { filename: string; contentType: string }>();
    for (const mediaId of [...new Set(prizes.flatMap((prize) => prize.mediaId ? [prize.mediaId] : []))]) {
      const info = await this.prizeMedia.info(mediaId);
      if (!info || info.seasonId !== seasonId) {
        throw new BadRequestException('Prize attachment does not belong to this season');
      }
      media.set(mediaId, { filename: info.filename, contentType: info.contentType });
    }

    await this.db.transaction(async (connection) => {
      await connection.query('DELETE FROM owner_season_prizes WHERE seasonId=?', [seasonId]);
      for (const prize of prizes) {
        const attachment = prize.mediaId ? media.get(prize.mediaId) : undefined;
        await connection.query(
          `INSERT INTO owner_season_prizes
           (id, seasonId, monthNumber, prizeCode, category, name, description,
            mediaId, mediaName, mediaMimeType,
            winnerCount, nominalValue, currencyCode, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
          [
            randomUUID(),
            seasonId,
            prize.monthNumber,
            prize.prizeCode.trim().toUpperCase(),
            prize.category.trim(),
            prize.name.trim(),
            prize.description?.trim() || null,
            prize.mediaId ?? null,
            attachment?.filename ?? null,
            attachment?.contentType ?? null,
            prize.winnerCount,
            prize.nominalValue ?? null,
            normalizedCurrency,
          ],
        );
      }
    });
  }

  private detectPrizeMediaType(buffer: Buffer): string | null {
    if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) return 'image/png';
    if (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) return 'image/webp';
    if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
    return null;
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

  private seasonSelectSql(suffix: string) {
    return `SELECT
                   s.id, s.code, s.name, s.description, s.status,
                   DATE_FORMAT(s.startDate, '%Y-%m-%d') AS startDate,
                   DATE_FORMAT(s.endDate, '%Y-%m-%d') AS endDate,
                   s.drawDay, s.drawStartMonth, s.drawWeekOfMonth, s.drawWeekday, s.drawTimezone,
                   s.eligibilityCutoff,
                   s.programId, s.programVersionId,
                   s.binaryPlanId, s.binaryPlanVersionId,
                   s.referralPolicyId, s.referralPolicyVersionId,
                   s.createdByUserId, s.reviewedByUserId, s.activatedByUserId, s.closedByUserId,
                   s.createdAt, s.updatedAt,
                   pv.registrationFee, pv.installmentAmount, pv.installmentCount, pv.currencyCode,
                   bpv.pairPayoutAmount, bpv.dailyPairCap, bpv.carryForwardEnabled, bpv.settlementTimezone,
                   rpv.fixedAmount
            FROM owner_seasons s
            LEFT JOIN program_versions pv ON pv.id=s.programVersionId
            LEFT JOIN binary_plan_versions bpv ON bpv.id=s.binaryPlanVersionId
            LEFT JOIN referral_reward_policy_versions rpv ON rpv.id=s.referralPolicyVersionId
            ${suffix}`;
  }

  private formatSeason(row: SeasonRow) {
    const pairValue = Number(row.pairPayoutAmount ?? 0);
    const totalMonths = Number(row.installmentCount ?? 0);
    return {
      ...row,
      endDate: row.endDate ?? this.deriveSeasonEndDate(row.startDate, totalMonths),
      monthlyEmi: String(row.installmentAmount ?? '0.00'),
      registrationFee: String(row.registrationFee ?? '0.00'),
      totalMonths,
      pairValue: String(row.pairPayoutAmount ?? '0.00'),
      directReferral: String(row.fixedAmount ?? '0.00'),
      dailyCap: pairValue * Number(row.dailyPairCap ?? 0),
      carryForward: Boolean(row.carryForwardEnabled),
    };
  }

  private deriveSeasonEndDate(startDate: Date | string, totalMonths: number) {
    if (!Number.isInteger(totalMonths) || totalMonths < 1) return null;
    const start = startDate instanceof Date
      ? startDate.toISOString().slice(0, 10)
      : String(startDate).slice(0, 10);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) return null;
    return new Date(Date.UTC(year, month - 1 + totalMonths, 0)).toISOString().slice(0, 10);
  }

  private validateSeasonMoney(dto: CreateOwnerSeasonDto | UpdateOwnerSeasonDto) {
    const monthlyEmi = Number(dto.monthlyEmi);
    const registrationFee = Number(dto.registrationFee);
    const pairValue = Number(dto.pairValue);
    const directReferral = Number(dto.directReferral);
    if (![monthlyEmi, registrationFee, pairValue, directReferral].every(Number.isFinite)) {
      throw new BadRequestException('Season monetary values must be valid numbers');
    }
    if (monthlyEmi < 0 || registrationFee < 0 || directReferral < 0 || pairValue <= 0) {
      throw new BadRequestException('Season amounts cannot be negative and pair value must be greater than zero');
    }
    if (dto.dailyCap < 0 || dto.dailyCap < pairValue) {
      throw new BadRequestException('Daily cap must allow at least one pair payout');
    }
  }

  private normalizeSeasonCode(value: string) {
    const code = value.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '_').slice(0, 50);
    if (code.length < 2) throw new BadRequestException('Season code is too short');
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

  private dayStart(value: string) {
    return `${value.slice(0, 10)}T00:00:00.000Z`;
  }

  private dayEnd(value: string) {
    return `${value.slice(0, 10)}T23:59:59.999Z`;
  }

  private readableSecret(prefix: string) {
    const body = randomBytes(8).toString('hex').toUpperCase();
    return `${prefix}-${body.slice(0, 8)}-${body.slice(8)}`;
  }

  private secretHash(domain: string, raw: string) {
    return createHmac('sha256', this.config.getOrThrow<string>('CAPTCHA_HMAC_SECRET'))
      .update(`owner-portal:${domain}:${raw.trim()}`)
      .digest('hex');
  }

  private drawSeed(runId: string) {
    return createHmac('sha256', this.config.getOrThrow<string>('CAPTCHA_HMAC_SECRET'))
      .update(`owner-draw-selection:${runId}`)
      .digest('hex');
  }

  private rows<T>(sql: string, values: SqlValue[] = []): Promise<T[]> {
    return this.db.transaction(async (connection) => (await connection.query(sql, values)) as T[]);
  }
}
