import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mariadb';
import { AuditService } from '../audit/audit.service';
import { FinancialDbService } from '../database/financial-db.service';
import { PrismaService } from '../database/prisma.service';
import { AuditAction, PolicyLifecycle, UserStatus } from '../generated/prisma/enums';

export type RankTier = {
  code: string;
  name: string;
  newDirect: number;
  newTeam: number;
  hours: number;
  cash: string;
  monthly: string;
  months: number;
  trip: string | null;
};

type RecurringRankRow = {
  id: string;
  tierCode: string;
  achievedAt: Date;
  policyTiers: unknown;
};

type EnrollmentRow = {
  id: string;
  userId: string;
  programVersionId: string;
  enrolledAt: Date;
  currencyCode: string;
  user: { id: string; username: string; status: UserStatus };
  payments: Array<{ amount: { toString(): string }; refunds: Array<{ amount: { toString(): string } }> }>;
};


const DEFAULT_TIERS: RankTier[] = [
  { code: 'LIGHTNING', name: 'Lightning Start Bonus', newDirect: 4, newTeam: 0,
    hours: 4, cash: '1000.00', monthly: '0.00', months: 0, trip: null },
  { code: 'BRONZE', name: 'Bronze Achiever', newDirect: 10, newTeam: 40,
    hours: 20 * 24, cash: '5000.00', monthly: '0.00', months: 0, trip: null },
  { code: 'SILVER', name: 'Silver Explorer', newDirect: 25, newTeam: 100,
    hours: 30 * 24, cash: '10000.00', monthly: '0.00', months: 0, trip: 'Goa family trip' },
  { code: 'GOLD', name: 'Gold Leader', newDirect: 50, newTeam: 250,
    hours: 60 * 24, cash: '20000.00', monthly: '2000.00', months: 18, trip: 'Ooty family trip' },
  { code: 'DIAMOND', name: 'Diamond Director', newDirect: 100, newTeam: 500,
    hours: 90 * 24, cash: '50000.00', monthly: '5000.00', months: 18, trip: 'Shimla family trip' },
];

@Injectable()
export class RankAchievementService {
  private readonly logger = new Logger(RankAchievementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly financialDb: FinancialDbService,
    private readonly audit: AuditService,
  ) {}

  initialFlyerTiers() {
    return DEFAULT_TIERS.map((tier) => ({ ...tier }));
  }

  validateTiers(raw: unknown): RankTier[] {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 12) {
      throw new BadRequestException('Achievement policy must have 1–12 ordered levels');
    }
    const codes = new Set<string>();
    let previousHours = 0;
    return raw.map((input: unknown) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new BadRequestException('Each level must be an object');
      }
      const item = input as Record<string, unknown>;
      const code = String(item.code ?? '').trim().toUpperCase();
      const name = String(item.name ?? '').trim();
      const newDirect = Number(item.newDirect);
      const newTeam = Number(item.newTeam);
      const hours = Number(item.hours);
      const months = Number(item.months);
      const cash = String(item.cash ?? '');
      const monthly = String(item.monthly ?? '');
      const trip = item.trip == null ? null : String(item.trip).trim();
      if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(code) || codes.has(code) ||
          !name || name.length > 120 || !Number.isSafeInteger(newDirect) ||
          newDirect < 0 || !Number.isSafeInteger(newTeam) || newTeam < 0 ||
          !Number.isSafeInteger(hours) || hours <= previousHours || hours > 24 * 366 ||
          !Number.isSafeInteger(months) || months < 0 || months > 60 ||
          !/^\d{1,12}\.\d{2}$/.test(cash) || !/^\d{1,12}\.\d{2}$/.test(monthly) ||
          (trip !== null && trip.length > 255) ||
          (Number(monthly) > 0 && months === 0) ||
          (Number(monthly) === 0 && months > 0)) {
        throw new BadRequestException('Invalid rank fields, deadline order or payout configuration');
      }
      codes.add(code);
      previousHours = hours;
      return { code, name, newDirect, newTeam, hours, cash, monthly, months, trip };
    });
  }

  async listPolicies() {
    return this.prisma.rankRewardPolicyVersion.findMany({
      orderBy: [{ createdAt: 'desc' }],
      include: { programVersion: { select: { id: true, version: true, program: { select: { code: true, name: true } } } } },
    });
  }

  async createDraft(programVersionId: string, rawTiers: unknown, actorUserId: string) {
    const programVersion = await this.prisma.programVersion.findUnique({
      where: { id: programVersionId },
      select: { id: true },
    });
    if (!programVersion) throw new NotFoundException('Program version not found');
    const tiers = this.validateTiers(rawTiers);
    const latest = await this.prisma.rankRewardPolicyVersion.findFirst({
      where: { programVersionId }, orderBy: { version: 'desc' }, select: { version: true },
    });
    return this.prisma.rankRewardPolicyVersion.create({
      data: {
        id: randomUUID(), programVersionId, version: (latest?.version ?? 0) + 1,
        lifecycle: PolicyLifecycle.DRAFT, tiers, effectiveFrom: new Date(),
        createdByUserId: actorUserId,
      },
    });
  }

  async updateDraft(policyId: string, tiersInput: unknown) {
    const current = await this.prisma.rankRewardPolicyVersion.findUnique({ where: { id: policyId } });
    if (!current) throw new NotFoundException('Rank policy not found');
    if (current.lifecycle !== PolicyLifecycle.DRAFT) throw new ConflictException('Only draft policies can be edited');
    return this.prisma.rankRewardPolicyVersion.update({
      where: { id: policyId }, data: { tiers: this.validateTiers(tiersInput) },
    });
  }

  async publish(policyId: string, actorUserId: string) {
    const current = await this.prisma.rankRewardPolicyVersion.findUnique({ where: { id: policyId } });
    if (!current) throw new NotFoundException('Rank policy not found');
    if (current.lifecycle !== PolicyLifecycle.DRAFT) throw new ConflictException('Only draft policies can be published');
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.rankRewardPolicyVersion.updateMany({
        where: { programVersionId: current.programVersionId, lifecycle: PolicyLifecycle.PUBLISHED },
        data: { lifecycle: PolicyLifecycle.RETIRED, effectiveTo: now },
      });
      const published = await tx.rankRewardPolicyVersion.update({
        where: { id: policyId },
        data: { lifecycle: PolicyLifecycle.PUBLISHED, effectiveFrom: now, publishedAt: now },
      });
      await tx.auditLog.create({
        data: {
          actorUserId, action: AuditAction.UPDATE, entityType: 'RankRewardPolicyVersion',
          entityId: policyId, description: 'Published rank bonus policy version',
          metadata: { programVersionId: current.programVersionId, version: current.version },
        },
      });
      return published;
    });
  }

  async history(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true } });
    if (!user) throw new NotFoundException('Member not found');
    const achievements = await this.prisma.rankAchievement.findMany({
      where: { userId }, orderBy: { achievedAt: 'desc' },
      include: { monthlyPayouts: { orderBy: { sequence: 'asc' } } },
    });
    return { user, achievements };
  }

  async overview() {
    const [policies, achievements] = await Promise.all([
      this.prisma.rankRewardPolicyVersion.findMany({
        where: { lifecycle: PolicyLifecycle.PUBLISHED }, orderBy: { publishedAt: 'desc' },
        include: { programVersion: { select: { program: { select: { code: true, name: true } } } } },
      }),
      this.prisma.rankAchievement.findMany({
        take: 100, orderBy: { achievedAt: 'desc' },
        include: { member: { select: { username: true } }, monthlyPayouts: { select: { id: true, sequence: true, dueAt: true, amount: true } } },
      }),
    ]);
    return { policies, achievements };
  }

  async fulfillTrip(achievementId: string, reference: string, actorUserId: string) {
    const ref = reference.trim();
    if (!ref || ref.length > 191) throw new BadRequestException('Fulfilment reference is required');
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.rankAchievement.updateMany({
        where: { id: achievementId, tripStatus: 'PENDING' },
        data: { tripStatus: 'FULFILLED', tripReference: ref, fulfilledAt: new Date(), fulfilledByUserId: actorUserId },
      });
      if (!changed.count) throw new ConflictException('Trip is not pending, or achievement does not exist');
      await tx.auditLog.create({ data: {
        actorUserId, action: AuditAction.UPDATE, entityType: 'RankAchievement', entityId: achievementId,
        description: 'Rank achievement trip fulfilled', metadata: { reference: ref },
      } });
      return tx.rankAchievement.findUniqueOrThrow({ where: { id: achievementId } });
    });
  }

  // Do not use the binary placement tree. Sponsor relationships define referral and team qualification.
  // Counts start afresh after each achieved level; every level's deadline remains relative to joining.
  async runCycle(now = new Date()) {
    const policies = await this.prisma.rankRewardPolicyVersion.findMany({
      where: { lifecycle: PolicyLifecycle.PUBLISHED, effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
      orderBy: { publishedAt: 'desc' },
    });
    if (policies.length === 0) return { policies: 0, awarded: 0, monthlyPaid: 0 };
    const byVersion = new Map(policies.map((p) => [p.programVersionId, p]));
    const enrollments = await this.prisma.programEnrollment.findMany({
      where: {
        programVersionId: { in: Array.from(byVersion.keys()) },
        status: 'ACTIVE', user: { status: 'ACTIVE' },
        payments: { some: {} },
      },
      include: {
        user: { select: { id: true, username: true, status: true } },
        payments: { select: { amount: true, refunds: { select: { amount: true } } } },
      },
      orderBy: [{ enrolledAt: 'asc' }, { id: 'asc' }],
    });
    const qualified = enrollments.filter((enrollment) => this.netPaid(enrollment) > 0);
    const parents = await this.prisma.sponsorRelationship.findMany({
      select: { memberUserId: true, sponsorUserId: true },
    });
    const children = new Map<string, string[]>();
    for (const link of parents) {
      const list = children.get(link.sponsorUserId) ?? [];
      list.push(link.memberUserId);
      children.set(link.sponsorUserId, list);
    }
    const activeByVersion = new Map<string, Map<string, EnrollmentRow>>();
    for (const enrollment of qualified) {
      const members = activeByVersion.get(enrollment.programVersionId) ?? new Map<string, EnrollmentRow>();
      const prior = members.get(enrollment.userId);
      if (!prior || prior.enrolledAt > enrollment.enrolledAt) members.set(enrollment.userId, enrollment);
      activeByVersion.set(enrollment.programVersionId, members);
    }
    let awarded = 0;
    let failed = 0;
    for (const enrollment of qualified) {
      const policy = byVersion.get(enrollment.programVersionId);
      if (!policy) continue;
      const memberIndex = activeByVersion.get(enrollment.programVersionId);
      if (!memberIndex || memberIndex.get(enrollment.userId)?.id !== enrollment.id) continue;
      try {
        const tiers = this.validateTiers(policy.tiers);
        const direct = (children.get(enrollment.userId) ?? [])
          .map((id) => memberIndex.get(id)?.enrolledAt)
          .filter((date): date is Date => Boolean(date))
          .sort((a, b) => a.getTime() - b.getTime());
        const team: Date[] = [];
        const visited = new Set([enrollment.userId]);
        const queue = [...(children.get(enrollment.userId) ?? [])];
        for (let index = 0; index < queue.length; index += 1) {
          const id = queue[index];
          if (!id || visited.has(id)) continue;
          visited.add(id);
          const date = memberIndex.get(id)?.enrolledAt;
          if (date) team.push(date);
          queue.push(...(children.get(id) ?? []));
        }
        team.sort((a, b) => a.getTime() - b.getTime());
        awarded += await this.evaluateLevels(enrollment, policy.id, tiers, direct, team, now);
      } catch (error) {
        failed++;
        this.logger.warn('Rank qualification failed for enrollment ' + enrollment.id + ': ' +
          (error instanceof Error ? error.message : String(error)));
      }
    }

    // Recurring income is EXCLUSIVE: on promotion, the higher tier replaces the lower
    // tier immediately. Previously due lower-tier installments remain eligible.
    // Rank awards are evaluated first so a same-cycle promotion closes the old income.
    // Missed installments catch up without creating simultaneous Gold/Diamond income.
    const achievements = await this.prisma.rankAchievement.findMany({
      where: { monthlyMonths: { gt: 0 }, monthlyAmount: { gt: 0 }, enrollmentId: { in: qualified.map((e) => e.id) } },
      include: { enrollment: { select: { currencyCode: true } }, monthlyPayouts: { select: { sequence: true } } },
    });
    let monthlyPaid = 0;
    for (const row of achievements) {
      try {
        const existing = new Set(row.monthlyPayouts.map((p) => p.sequence));
        for (let period = 1; period <= row.monthlyMonths; period += 1) {
          if (existing.has(period)) continue;
          const dueAt = this.monthAfter(row.achievedAt, period);
          if (dueAt > now) break;
          const posted = await this.postMonthly(row.id, row.userId, row.tierCode, row.enrollmentId, row.enrollment.currencyCode, dueAt, period, row.monthlyAmount.toString());
          if (posted) monthlyPaid++;
        }
      } catch (error) {
        failed++;
        this.logger.warn('Rank recurring payment reconciliation failed for ' + row.id + ': ' +
          (error instanceof Error ? error.message : String(error)));
      }
    }
    return { policies: policies.length, awarded, monthlyPaid, failed };
  }

  private netPaid(enrollment: EnrollmentRow) {
    return enrollment.payments.reduce((sum, payment) => {
      const refunded = payment.refunds.reduce((amount, refund) => amount + Number(refund.amount.toString()), 0);
      return sum + Number(payment.amount.toString()) - refunded;
    }, 0);
  }

  private async evaluateLevels(
    enrollment: EnrollmentRow,
    policyVersionId: string,
    tiers: RankTier[],
    direct: Date[],
    team: Date[],
    now: Date,
  ) {
    const existing = await this.prisma.rankAchievement.findMany({
      where: { enrollmentId: enrollment.id },
    });
    const existingByCode = new Map(existing.map((achievement) => [achievement.tierCode, achievement]));
    let stageStart = enrollment.enrolledAt;
    let awarded = 0;
    for (let index = 0; index < tiers.length; index += 1) {
      const tier = tiers[index];
      if (!tier) continue;
      const priorAward = existingByCode.get(tier.code);
      if (priorAward) {
        stageStart = priorAward.achievedAt;
        continue;
      }
      const deadline = new Date(enrollment.enrolledAt.getTime() + tier.hours * 60 * 60 * 1000);
      const freshDirect = direct.filter((date) => date > stageStart && date <= deadline);
      const freshTeam = team.filter((date) => date > stageStart && date <= deadline);
      const needsDirect = tier.newDirect;
      const needsTeam = tier.newTeam;
      if (freshDirect.length < needsDirect || freshTeam.length < needsTeam) {
        // Lightning is an optional fast-start bonus. Later levels are progressive.
        if (index === 0) continue;
        break;
      }
      const crossedAt = new Date(Math.max(
        stageStart.getTime(),
        needsDirect > 0 ? freshDirect[needsDirect - 1]!.getTime() : stageStart.getTime(),
        needsTeam > 0 ? freshTeam[needsTeam - 1]!.getTime() : stageStart.getTime(),
      ));
      if (crossedAt > now || crossedAt > deadline) {
        if (index === 0) continue;
        break;
      }
      await this.award(enrollment, policyVersionId, tier, freshDirect.length, freshTeam.length, deadline, crossedAt);
      awarded++;
      stageStart = crossedAt;
    }
    return awarded;
  }

  private async award(
    enrollment: EnrollmentRow,
    policyVersionId: string,
    tier: RankTier,
    directCount: number,
    teamCount: number,
    deadlineAt: Date,
    achievedAt: Date,
  ) {
    const mutex = 'RANK:' + enrollment.id;
    await this.financialDb.transaction(async (connection) => {
      await this.lock(connection, mutex);
      const found = await connection.query<Array<{ id: string }>>(
        'SELECT id FROM rank_achievements WHERE enrollmentId=? AND tierCode=? LIMIT 1',
        [enrollment.id, tier.code],
      );
      if (found.length > 0) return;
      const amount = Number(tier.cash);
      const transactionId = amount > 0 ? await this.postLedger(
        connection, 'RANK_ACHIEVEMENT:' + enrollment.id + ':' + tier.code,
        'RANK_ACHIEVEMENT', enrollment.userId, enrollment.user.username,
        enrollment.currencyCode, tier.cash, achievedAt, 'Achievement ' + tier.name,
      ) : null;
      await connection.query(
        `INSERT INTO rank_achievements
          (id,enrollmentId,userId,policyVersionId,tierCode,tierName,directCount,teamCount,deadlineAt,achievedAt,
          cashAmount,monthlyAmount,monthlyMonths,tripDescription,tripStatus,ledgerTransactionId,createdAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(3))`,
        [randomUUID(), enrollment.id, enrollment.userId, policyVersionId, tier.code, tier.name,
          directCount, teamCount, this.utcSql(deadlineAt), this.utcSql(achievedAt), tier.cash, tier.monthly, tier.months,
          tier.trip, tier.trip ? 'PENDING' : 'NOT_APPLICABLE', transactionId],
      );
    });
    await this.audit.log({
      actorUserId: enrollment.userId, action: AuditAction.CREATE, entityType: 'RankAchievement',
      description: 'Automatic joining-date rank bonus awarded',
      metadata: { enrollmentId: enrollment.id, tierCode: tier.code, newDirect: tier.newDirect,
        newTeam: tier.newTeam, cashAmount: tier.cash, deadlineAt: deadlineAt.toISOString() },
    }).catch((error: unknown) => this.logger.warn('Rank award audit retry required: ' + String(error)));
  }

  private async postMonthly(
    achievementId: string, userId: string, tierCode: string, enrollmentId: string,
    currencyCode: string, dueAt: Date, sequence: number, amount: string,
  ) {
    await this.financialDb.transaction(async (connection) => {
      await this.lock(connection, 'RANK:' + enrollmentId);
      const prior = await connection.query<Array<{ id: string }>>(
        'SELECT id FROM rank_monthly_payouts WHERE achievementId=? AND sequence=? LIMIT 1',
        [achievementId, sequence],
      );
      if (prior.length > 0) return false;
      // Recheck inside the same financial transaction and enrollment mutex as award().
      // The most recently achieved income tier is the ONLY payable tier for dueAt.
      // An older tier can still receive past-due installments from before promotion,
      // but never an installment due at or after the higher rank's achievement instant.
      const recurringRanks = await connection.query<RecurringRankRow[]>(
        `SELECT a.id, a.tierCode, a.achievedAt, v.tiers AS policyTiers
         FROM rank_achievements a
         INNER JOIN rank_reward_policy_versions v ON v.id = a.policyVersionId
         WHERE a.enrollmentId = ? AND a.monthlyMonths > 0 AND a.monthlyAmount > 0
           AND a.achievedAt <= ?`,
        [enrollmentId, this.utcSql(dueAt)],
      );
      if (this.activeRecurringRankId(recurringRanks) !== achievementId) return false;
      const member = await this.prisma.user.findUnique({
        where: { id: userId }, select: { username: true },
      });
      if (!member) throw new NotFoundException('Rank member not found');
      const transactionId = await this.postLedger(
        connection, 'RANK_MONTHLY:' + achievementId + ':' + sequence,
        'RANK_MONTHLY', userId, member.username, currencyCode, amount, dueAt,
        tierCode + ' monthly reward month ' + sequence,
      );
      await connection.query(
        'INSERT INTO rank_monthly_payouts (id,achievementId,sequence,dueAt,amount,ledgerTransactionId,createdAt) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP(3))',
        [randomUUID(), achievementId, sequence, this.utcSql(dueAt), amount, transactionId],
      );
      return true;
    });
  }

  // If milestones share an instant, the later tier in the versioned policy wins.
  // No rank-specific names or payout amounts are hardcoded into promotion logic.
  private activeRecurringRankId(rows: RecurringRankRow[]): string | null {
    let active: { id: string; at: number; priority: number } | null = null;
    for (const row of rows) {
      const raw: unknown = typeof row.policyTiers === 'string'
        ? JSON.parse(row.policyTiers) as unknown : row.policyTiers;
      const priority = this.validateTiers(raw).findIndex((tier) => tier.code === row.tierCode);
      if (priority < 0) throw new ConflictException('Rank income policy tier no longer matches achievement');
      const at = new Date(row.achievedAt).getTime();
      if (!Number.isFinite(at)) throw new ConflictException('Rank achievement instant is invalid');
      if (!active || at > active.at || (at === active.at && priority > active.priority)) {
        active = { id: row.id, at, priority };
      }
    }
    return active?.id ?? null;
  }

  private async lock(connection: PoolConnection, mutex: string) {
    await connection.query(
      'INSERT INTO system_sequences (`key`,nextValue,updatedAt) VALUES (?,0,CURRENT_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE nextValue=nextValue+1,updatedAt=CURRENT_TIMESTAMP(3)',
      [mutex],
    );
  }

  private async postLedger(
    connection: PoolConnection, sourceKey: string, type: 'RANK_ACHIEVEMENT' | 'RANK_MONTHLY',
    userId: string, username: string, currency: string, amount: string, at: Date, description: string,
  ) {
    const walletCode = 'USER_WALLET:' + userId + ':' + currency;
    const expenseCode = 'RANK_REWARD_EXPENSE:' + currency;
    for (const account of [
      { code: walletCode, name: username + ' wallet ' + currency, kind: 'USER_WALLET', owner: userId },
      { code: expenseCode, name: 'Rank achievement expense ' + currency, kind: 'RANK_REWARD_EXPENSE', owner: null },
    ]) {
      await connection.query(
        'INSERT INTO ledger_accounts (id,code,name,kind,ownerUserId,currencyCode,createdAt) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE code=VALUES(code)',
        [randomUUID(), account.code, account.name, account.kind, account.owner, currency],
      );
    }
    const accounts = await connection.query<Array<{ id: string; code: string }>>(
      'SELECT id,code FROM ledger_accounts WHERE code IN (?,?)', [walletCode, expenseCode],
    );
    const walletId = accounts.find((item) => item.code === walletCode)?.id;
    const expenseId = accounts.find((item) => item.code === expenseCode)?.id;
    if (!walletId || !expenseId) throw new ConflictException('Rank posting accounts unavailable');
    const id = randomUUID();
    await connection.query(
      'INSERT INTO ledger_transactions (id,sourceKey,type,description,occurredAt,createdByUserId,createdAt) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP(3))',
      [id, sourceKey, type, description, this.utcSql(at), userId],
    );
    await connection.query(
      `INSERT INTO ledger_entries (id,transactionId,accountId,direction,amount,currencyCode,createdAt)
       VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP(3)),(?,?,?,?,?,?,CURRENT_TIMESTAMP(3))`,
      [randomUUID(), id, expenseId, 'DEBIT', amount, currency,
        randomUUID(), id, walletId, 'CREDIT', amount, currency],
    );
    return id;
  }

  private utcSql(value: Date) {
    return value.toISOString().slice(0, 23).replace('T', ' ');
  }

  monthAfter(date: Date, months: number) {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + months;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay),
      date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
  }
}

@Injectable()
export class RankAchievementWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RankAchievementWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly ranks: RankAchievementService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const first = setTimeout(() => void this.run(), 4_000);
    first.unref();
    this.timer = setInterval(() => void this.run(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      await this.ranks.runCycle();
    } catch (error) {
      this.logger.error('Automatic rank rewards cycle failed', error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
    }
  }
}
