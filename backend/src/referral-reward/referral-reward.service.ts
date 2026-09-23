import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mariadb';
import { AuditService } from '../audit/audit.service';
import { FinancialDbService } from '../database/financial-db.service';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  AuditAction,
  LedgerAccountKind,
  LedgerEntryDirection,
  LedgerTransactionType,
  PolicyLifecycle,
  ReferralRewardEventStatus,
  ReferralRewardMode,
  ReferralRoundingMode,
  UserStatus,
} from '../generated/prisma/enums';
import { ReferralEligibilityService } from './referral-eligibility.service';
import type { CreateReferralRewardEventDto } from './referral-reward.dto';

type EventIdentityRow = {
  id: string;
  referredUserId: string;
  policyVersionId: string;
  requestFingerprint: string;
};

type ReferralMemberRow = {
  referredUserId: string;
  referredUsername: string;
  referredStatus: UserStatus;
  referredEmailVerifiedAt: Date | null;
  referredPhoneVerifiedAt: Date | null;
  sponsorUserId: string | null;
  sponsorUsername: string | null;
  sponsorStatus: UserStatus | null;
  sponsorEmailVerifiedAt: Date | null;
  sponsorPhoneVerifiedAt: Date | null;
};

type PolicyVersionRow = {
  id: string;
  lifecycle: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  rewardMode: string;
  fixedAmount: string | null;
  percentageRate: string | null;
  currencyCode: string;
  roundingMode: string;
  minimumRewardAmount: string | null;
  maximumRewardAmount: string | null;
  eligibilityRules: unknown;
};

type IdRow = { id: string };

@Injectable()
export class ReferralRewardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialDb: FinancialDbService,
    private readonly audit: AuditService,
    private readonly eligibility: ReferralEligibilityService,
  ) {}

  async createEvent(dto: CreateReferralRewardEventDto, actorUserId: string) {
    const occurredAt = new Date(dto.occurredAt);
    const basisAmount = this.nonNegativeDecimal(dto.basisAmount, 'basisAmount');
    const currencyCode = dto.currencyCode.trim().toUpperCase();
    const fingerprint = this.requestFingerprint(dto, occurredAt, basisAmount, currencyCode);

    const existing = await this.prisma.referralRewardEvent.findUnique({
      where: { sourceKey: dto.sourceKey },
      select: {
        id: true,
        referredUserId: true,
        policyVersionId: true,
        requestFingerprint: true,
      },
    });
    if (existing) {
      this.assertIdempotentMatch(existing, dto, fingerprint);
      return { event: await this.getEvent(existing.id), idempotent: true };
    }

    const mutexKey = `RR:${createHash('sha256').update(dto.sourceKey).digest('hex').slice(0, 60)}`;
    await this.financialDb.execute(
      `INSERT INTO system_sequences (\`key\`, nextValue, updatedAt)
       VALUES (?, 0, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE \`key\` = VALUES(\`key\`)`,
      [mutexKey],
    );

    let eventId: string;
    try {
      eventId = await this.financialDb.transaction((connection) =>
        this.createEventTransaction(
          connection,
          dto,
          actorUserId,
          occurredAt,
          basisAmount,
          currencyCode,
          fingerprint,
          mutexKey,
        ),
      );
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        const duplicate = await this.prisma.referralRewardEvent.findUnique({
          where: { sourceKey: dto.sourceKey },
          select: {
            id: true,
            referredUserId: true,
            policyVersionId: true,
            requestFingerprint: true,
          },
        });
        if (duplicate) {
          this.assertIdempotentMatch(duplicate, dto, fingerprint);
          return { event: await this.getEvent(duplicate.id), idempotent: true };
        }
      }
      throw error;
    }

    const event = await this.getEvent(eventId);
    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'ReferralRewardEvent',
      entityId: event.id,
      description: 'Referral reward evaluated',
      metadata: {
        sourceKey: event.sourceKey,
        sponsorUserId: event.sponsorUserId,
        referredUserId: event.referredUserId,
        policyVersionId: event.policyVersionId,
        eligible: event.eligible,
        rewardAmount: event.rewardAmount.toString(),
        currencyCode: event.currencyCode,
      },
    });
    return { event, idempotent: false };
  }

  async getEvent(id: string) {
    const event = await this.prisma.referralRewardEvent.findUnique({
      where: { id },
      include: {
        sponsor: { select: { id: true, username: true } },
        referredUser: { select: { id: true, username: true } },
        policyVersion: { include: { policy: true } },
        ledgerTransaction: { include: { entries: { include: { account: true } } } },
      },
    });
    if (!event) throw new NotFoundException('Referral reward event not found');
    return event;
  }

  async listSponsorHistory(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });
    if (!user) throw new NotFoundException('Sponsor user not found');
    const events = await this.prisma.referralRewardEvent.findMany({
      where: { sponsorUserId: userId },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        referredUser: { select: { id: true, username: true } },
        policyVersion: { include: { policy: true } },
        ledgerTransaction: true,
      },
    });
    return { user, events };
  }

  private async createEventTransaction(
    connection: PoolConnection,
    dto: CreateReferralRewardEventDto,
    actorUserId: string,
    occurredAt: Date,
    basisAmount: Prisma.Decimal,
    currencyCode: string,
    fingerprint: string,
    mutexKey: string,
  ): Promise<string> {
    await connection.query(
      `UPDATE system_sequences
       SET nextValue = nextValue + 1, updatedAt = CURRENT_TIMESTAMP(3)
       WHERE \`key\` = ?`,
      [mutexKey],
    );

    const racedRows = await connection.query<EventIdentityRow[]>(
      `SELECT id, referredUserId, policyVersionId, requestFingerprint
       FROM referral_reward_events
       WHERE sourceKey = ?
       LIMIT 1`,
      [dto.sourceKey],
    );
    const raced = racedRows[0];
    if (raced) {
      this.assertIdempotentMatch(raced, dto, fingerprint);
      return raced.id;
    }

    const memberRows = await connection.query<ReferralMemberRow[]>(
      `SELECT
         referred.id AS referredUserId,
         referred.username AS referredUsername,
         referred.status AS referredStatus,
         referred.emailVerifiedAt AS referredEmailVerifiedAt,
         referred.phoneVerifiedAt AS referredPhoneVerifiedAt,
         relationship.sponsorUserId AS sponsorUserId,
         sponsor.username AS sponsorUsername,
         sponsor.status AS sponsorStatus,
         sponsor.emailVerifiedAt AS sponsorEmailVerifiedAt,
         sponsor.phoneVerifiedAt AS sponsorPhoneVerifiedAt
       FROM users referred
       LEFT JOIN sponsor_relationships relationship ON relationship.memberUserId = referred.id
       LEFT JOIN users sponsor ON sponsor.id = relationship.sponsorUserId
       WHERE referred.id = ?
       LIMIT 1`,
      [dto.referredUserId],
    );
    const member = memberRows[0];
    if (!member) throw new NotFoundException('Referred user not found');
    if (!member.sponsorUserId || !member.sponsorUsername || !member.sponsorStatus) {
      throw new ConflictException('Referred user does not have an assigned sponsor');
    }

    const versionRows = await connection.query<PolicyVersionRow[]>(
      `SELECT id, lifecycle, effectiveFrom, effectiveTo, rewardMode,
              fixedAmount, percentageRate, currencyCode, roundingMode,
              minimumRewardAmount, maximumRewardAmount, eligibilityRules
       FROM referral_reward_policy_versions
       WHERE id = ?
       LIMIT 1`,
      [dto.policyVersionId],
    );
    const version = versionRows[0];
    if (!version) throw new NotFoundException('Referral reward policy version not found');
    if (version.lifecycle !== PolicyLifecycle.PUBLISHED) {
      throw new ConflictException('Referral reward requires a published policy version');
    }
    const effectiveFrom = new Date(version.effectiveFrom);
    const effectiveTo = version.effectiveTo ? new Date(version.effectiveTo) : null;
    if (effectiveFrom > occurredAt || (effectiveTo && effectiveTo < occurredAt)) {
      throw new ConflictException('Referral reward policy version is not effective at event time');
    }
    if (version.currencyCode.toUpperCase() !== currencyCode) {
      throw new BadRequestException('Reward basis currency must match the policy currency');
    }

    const eligibility = this.eligibility.evaluate(
      this.parseJson(version.eligibilityRules),
      {
        status: member.sponsorStatus,
        emailVerifiedAt: member.sponsorEmailVerifiedAt,
        phoneVerifiedAt: member.sponsorPhoneVerifiedAt,
      },
      {
        status: member.referredStatus,
        emailVerifiedAt: member.referredEmailVerifiedAt,
        phoneVerifiedAt: member.referredPhoneVerifiedAt,
      },
      basisAmount,
    );

    const rewardAmount = eligibility.eligible
      ? this.calculateReward(version, basisAmount)
      : new Prisma.Decimal(0);

    let ledgerTransactionId: string | null = null;
    let status = ReferralRewardEventStatus.INELIGIBLE;
    if (eligibility.eligible && rewardAmount.greaterThan(0)) {
      ledgerTransactionId = await this.postLedgerTransaction(
        connection,
        dto.sourceKey,
        actorUserId,
        occurredAt,
        member.sponsorUserId,
        member.sponsorUsername,
        rewardAmount,
        currencyCode,
      );
      status = ReferralRewardEventStatus.POSTED;
    } else if (eligibility.eligible) {
      status = ReferralRewardEventStatus.NO_PAYOUT;
    }

    const eventId = randomUUID();
    const snapshot = {
      ...eligibility,
      policy: {
        policyVersionId: dto.policyVersionId,
        rewardMode: version.rewardMode,
        fixedAmount: version.fixedAmount,
        percentageRate: version.percentageRate,
        roundingMode: version.roundingMode,
        minimumRewardAmount: version.minimumRewardAmount,
        maximumRewardAmount: version.maximumRewardAmount,
        currencyCode,
      },
    };
    await connection.query(
      `INSERT INTO referral_reward_events
         (id, sourceKey, requestFingerprint, referredUserId, sponsorUserId,
          policyVersionId, basisAmount, currencyCode, eligible, eligibilitySnapshot,
          rewardAmount, status, ledgerTransactionId, occurredAt, metadata,
          createdByUserId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        eventId,
        dto.sourceKey,
        fingerprint,
        dto.referredUserId,
        member.sponsorUserId,
        dto.policyVersionId,
        basisAmount.toFixed(2),
        currencyCode,
        eligibility.eligible,
        JSON.stringify(snapshot),
        rewardAmount.toFixed(2),
        status,
        ledgerTransactionId,
        occurredAt,
        dto.metadata ? JSON.stringify(dto.metadata) : null,
        actorUserId,
      ],
    );
    return eventId;
  }

  private calculateReward(
    version: PolicyVersionRow,
    basisAmount: Prisma.Decimal,
  ): Prisma.Decimal {
    let amount: Prisma.Decimal;
    if (version.rewardMode === ReferralRewardMode.FIXED) {
      if (version.fixedAmount === null) {
        throw new ConflictException('Published fixed referral policy has no fixed amount');
      }
      amount = new Prisma.Decimal(version.fixedAmount);
    } else if (version.rewardMode === ReferralRewardMode.PERCENTAGE) {
      if (version.percentageRate === null) {
        throw new ConflictException('Published percentage referral policy has no rate');
      }
      amount = basisAmount.mul(version.percentageRate).div(100);
    } else {
      throw new ConflictException('Published referral policy has an unsupported reward mode');
    }

    if (version.minimumRewardAmount !== null) {
      amount = Prisma.Decimal.max(amount, new Prisma.Decimal(version.minimumRewardAmount));
    }
    if (version.maximumRewardAmount !== null) {
      amount = Prisma.Decimal.min(amount, new Prisma.Decimal(version.maximumRewardAmount));
    }

    const rounding = this.roundingConstant(version.roundingMode);
    return amount.toDecimalPlaces(2, rounding);
  }

  private roundingConstant(roundingMode: string): number {
    switch (roundingMode) {
      case ReferralRoundingMode.HALF_UP:
        return Prisma.Decimal.ROUND_HALF_UP;
      case ReferralRoundingMode.DOWN:
        return Prisma.Decimal.ROUND_DOWN;
      case ReferralRoundingMode.UP:
        return Prisma.Decimal.ROUND_UP;
      default:
        throw new ConflictException('Published referral policy has an unsupported rounding mode');
    }
  }

  private async postLedgerTransaction(
    connection: PoolConnection,
    sourceKey: string,
    actorUserId: string,
    occurredAt: Date,
    sponsorUserId: string,
    sponsorUsername: string,
    rewardAmount: Prisma.Decimal,
    currencyCode: string,
  ): Promise<string> {
    const walletCode = `USER_WALLET:${sponsorUserId}:${currencyCode}`;
    const expenseCode = `REFERRAL_REWARD_EXPENSE:${currencyCode}`;
    await this.ensureLedgerAccount(
      connection,
      walletCode,
      `${sponsorUsername} wallet ${currencyCode}`,
      LedgerAccountKind.USER_WALLET,
      sponsorUserId,
      currencyCode,
    );
    await this.ensureLedgerAccount(
      connection,
      expenseCode,
      `Referral reward expense ${currencyCode}`,
      LedgerAccountKind.REFERRAL_REWARD_EXPENSE,
      null,
      currencyCode,
    );

    const walletId = await this.ledgerAccountId(connection, walletCode);
    const expenseId = await this.ledgerAccountId(connection, expenseCode);
    const transactionId = randomUUID();
    await connection.query(
      `INSERT INTO ledger_transactions
         (id, sourceKey, type, description, occurredAt, createdByUserId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        transactionId,
        `REFERRAL_REWARD:${sourceKey}`,
        LedgerTransactionType.REFERRAL_REWARD,
        `Referral reward for sponsor ${sponsorUsername}`,
        occurredAt,
        actorUserId,
      ],
    );
    await connection.query(
      `INSERT INTO ledger_entries
         (id, transactionId, accountId, direction, amount, currencyCode, createdAt)
       VALUES
         (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3)),
         (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        randomUUID(),
        transactionId,
        expenseId,
        LedgerEntryDirection.DEBIT,
        rewardAmount.toFixed(2),
        currencyCode,
        randomUUID(),
        transactionId,
        walletId,
        LedgerEntryDirection.CREDIT,
        rewardAmount.toFixed(2),
        currencyCode,
      ],
    );
    return transactionId;
  }

  private async ensureLedgerAccount(
    connection: PoolConnection,
    code: string,
    name: string,
    kind: LedgerAccountKind,
    ownerUserId: string | null,
    currencyCode: string,
  ): Promise<void> {
    await connection.query(
      `INSERT INTO ledger_accounts
         (id, code, name, kind, ownerUserId, currencyCode, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE code = VALUES(code)`,
      [randomUUID(), code, name, kind, ownerUserId, currencyCode],
    );
  }

  private async ledgerAccountId(connection: PoolConnection, code: string): Promise<string> {
    const rows = await connection.query<IdRow[]>(
      'SELECT id FROM ledger_accounts WHERE code = ? LIMIT 1',
      [code],
    );
    if (!rows[0]) throw new ConflictException('Ledger account could not be resolved');
    return rows[0].id;
  }

  private requestFingerprint(
    dto: CreateReferralRewardEventDto,
    occurredAt: Date,
    basisAmount: Prisma.Decimal,
    currencyCode: string,
  ): string {
    return createHash('sha256')
      .update(
        `${dto.referredUserId}|${dto.policyVersionId}|${basisAmount.toFixed(2)}|${currencyCode}|${occurredAt.toISOString()}`,
      )
      .digest('hex');
  }

  private assertIdempotentMatch(
    existing: EventIdentityRow,
    dto: CreateReferralRewardEventDto,
    fingerprint: string,
  ): void {
    if (
      existing.referredUserId !== dto.referredUserId ||
      existing.policyVersionId !== dto.policyVersionId ||
      existing.requestFingerprint !== fingerprint
    ) {
      throw new ConflictException('Referral reward source key already exists with a different payload');
    }
  }

  private nonNegativeDecimal(raw: string, field: string): Prisma.Decimal {
    try {
      const value = new Prisma.Decimal(raw);
      if (!value.isFinite() || value.isNegative()) throw new Error('invalid');
      return value;
    } catch {
      throw new BadRequestException(`${field} must be a non-negative number`);
    }
  }

  private parseJson(value: unknown): unknown {
    if (typeof value !== 'string') return value ?? {};
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new ConflictException('Stored referral eligibility rules are invalid JSON');
    }
  }
}
