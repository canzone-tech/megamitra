import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { FinancialDbService } from '../database/financial-db.service';
import { AuditAction } from '../generated/prisma/enums';
import { LuckyDrawExecutionService } from '../lucky-draw/lucky-draw-execution.service';
import { LuckyDrawFulfillmentService } from '../lucky-draw/lucky-draw-fulfillment.service';
import { LuckyDrawPolicyService } from '../lucky-draw/lucky-draw-policy.service';
import type {
  FulfillOwnerWinnerDto,
  PrepareOwnerDrawDto,
} from './owner-portal.dto';
import { OwnerPortalService } from './owner-portal.service';

type SqlValue = string | number | bigint | boolean | Date | null;

type DrawSeasonRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  programVersionId: string | null;
};

type DrawRunRow = {
  id: string;
  seasonId: string;
  monthNumber: number;
  policyId: string;
  policyVersionId: string;
  drawId: string;
  status: string;
};

@Injectable()
export class OwnerPortalDrawWorkflowService {
  constructor(
    private readonly db: FinancialDbService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly drawPolicies: LuckyDrawPolicyService,
    private readonly draws: LuckyDrawExecutionService,
    private readonly fulfillment: LuckyDrawFulfillmentService,
    private readonly portal: OwnerPortalService,
  ) {}

  async prepareDraw(
    seasonId: string,
    dto: PrepareOwnerDrawDto,
    actorUserId: string,
  ) {
    const seasonRows = await this.rows<DrawSeasonRow>(
      `SELECT id, code, name, status, programVersionId
       FROM owner_seasons WHERE id=? LIMIT 1`,
      [seasonId],
    );
    const season = seasonRows[0];
    if (!season) throw new NotFoundException('Season not found');
    if (season.status !== 'ACTIVE') {
      throw new ConflictException('Only an active season can schedule a draw');
    }
    if (!season.programVersionId) {
      throw new ConflictException('Season program version is missing');
    }

    const existing = await this.rows<DrawRunRow>(
      'SELECT id, seasonId, monthNumber, policyId, policyVersionId, drawId, status FROM owner_draw_runs WHERE seasonId=? AND monthNumber=? LIMIT 1',
      [seasonId, dto.monthNumber],
    );
    if (existing[0]) return this.portal.drawRun(existing[0].id);

    const prizes = await this.rows<{
      prizeCode: string;
      name: string;
      winnerCount: number;
      nominalValue: string | null;
    }>(
      `SELECT prizeCode, name, winnerCount, nominalValue
       FROM owner_season_prizes
       WHERE seasonId=? AND monthNumber=? AND status='ACTIVE'
       ORDER BY createdAt ASC`,
      [seasonId, dto.monthNumber],
    );
    if (!prizes.length) {
      throw new BadRequestException('Configure at least one prize for this draw month');
    }

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
                  currencyCode: 'INR',
                },
              }
            : { prizeDefinition: {} }),
        })),
      },
      actorUserId,
    );

    // The final client workflow requires claim → fulfilment after publication.
    // The source does not define a duration, so the owner supplies the window
    // for each prepared draw rather than the application inventing a default.
    await this.fulfillment.configureRule(
      policyVersion.id,
      { claimWindowDays: dto.claimWindowDays },
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
      [
        runId,
        seasonId,
        dto.monthNumber,
        policy.id,
        policyVersion.id,
        draw.id,
        actorUserId,
      ],
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'OwnerDrawRun',
      entityId: runId,
      description: 'Monthly draw prepared from season prize schedule',
      metadata: {
        seasonId,
        monthNumber: dto.monthNumber,
        drawId: draw.id,
        claimWindowDays: dto.claimWindowDays,
      },
    });
    return this.portal.drawRun(runId);
  }

  async publishDraw(runId: string, actorUserId: string) {
    const run = await this.requireRun(runId);
    if (run.status === 'PUBLISHED') return this.portal.drawRun(runId);
    if (run.status !== 'APPROVED') {
      throw new ConflictException('Approve verified winners before publication');
    }

    await this.fulfillment.initializeClaims(run.drawId, actorUserId);
    await this.db.execute(
      "UPDATE owner_draw_runs SET status='PUBLISHED', publishedAt=CURRENT_TIMESTAMP(3) WHERE id=?",
      [runId],
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerDrawRun',
      entityId: runId,
      description: 'Approved winner list published and prize claims opened',
      metadata: { drawId: run.drawId },
    });
    return this.portal.drawRun(runId);
  }

  async claimWinner(runId: string, winnerId: string, actorUserId: string) {
    const run = await this.requirePublishedRun(runId);
    const claim = await this.requireWinnerClaim(run, winnerId);
    await this.fulfillment.claim(
      claim.claimId,
      {
        occurredAt: new Date().toISOString(),
        metadata: { ownerPortal: true, drawRunId: runId },
      },
      actorUserId,
    );
    return this.portal.drawRun(runId);
  }

  async fulfillWinner(
    runId: string,
    winnerId: string,
    dto: FulfillOwnerWinnerDto,
    actorUserId: string,
  ) {
    const run = await this.requirePublishedRun(runId);
    const claim = await this.requireWinnerClaim(run, winnerId);
    const occurredAt = new Date().toISOString();
    await this.fulfillment.fulfill(
      claim.claimId,
      {
        sourceKey: `owner-winner-fulfillment:${runId}:${winnerId}`,
        occurredAt,
        ...(dto.externalReference?.trim()
          ? { externalReference: dto.externalReference.trim() }
          : {}),
        metadata: {
          ownerPortal: true,
          drawRunId: runId,
          ...(dto.note?.trim() ? { note: dto.note.trim() } : {}),
        },
      },
      actorUserId,
    );
    return this.portal.drawRun(runId);
  }

  private async requirePublishedRun(runId: string) {
    const run = await this.requireRun(runId);
    if (run.status !== 'PUBLISHED') {
      throw new ConflictException('Prize claims are available only after winners are published');
    }
    return run;
  }

  private async requireRun(runId: string) {
    const rows = await this.rows<DrawRunRow>(
      'SELECT id, seasonId, monthNumber, policyId, policyVersionId, drawId, status FROM owner_draw_runs WHERE id=? LIMIT 1',
      [runId],
    );
    if (!rows[0]) throw new NotFoundException('Draw run not found');
    return rows[0];
  }

  private async requireWinnerClaim(run: DrawRunRow, winnerId: string) {
    const rows = await this.rows<{ claimId: string; claimStatus: string }>(
      `SELECT c.id AS claimId, c.status AS claimStatus
       FROM lucky_draw_winners w
       JOIN lucky_draw_prize_claims c ON c.winnerId=w.id
       WHERE w.id=? AND w.drawId=? LIMIT 1`,
      [winnerId, run.drawId],
    );
    if (!rows[0]) {
      throw new NotFoundException('Prize claim was not found for this winner');
    }
    return rows[0];
  }

  private drawSeed(runId: string) {
    return createHmac(
      'sha256',
      this.config.getOrThrow<string>('CAPTCHA_HMAC_SECRET'),
    )
      .update(`owner-draw-selection:${runId}`)
      .digest('hex');
  }

  private policyCode(code: string, suffix: string) {
    const tail = `_${suffix}`;
    return `${code.slice(0, Math.max(2, 50 - tail.length))}${tail}`;
  }

  private rows<T>(sql: string, values: SqlValue[] = []): Promise<T[]> {
    return this.db.transaction(
      async (connection) => (await connection.query(sql, values)) as T[],
    );
  }
}
