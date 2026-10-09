import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { FinancialDbService } from '../database/financial-db.service';
import { PrismaService } from '../database/prisma.service';
import { LuckyDrawTokenService } from '../lucky-draw/lucky-draw-token.service';
import { ProgramPaymentService } from '../program/program-payment.service';
import { ProgramAutomationService } from '../program/program-automation.service';
import { MemberPaymentService } from './member-payment.service';

type ReceiptRecord = Record<string, unknown> & {
  id?: string;
  purpose?: string;
  status?: string;
  details?: unknown;
};

type ReceiptToken = {
  token: string;
  installmentSequence: number | null;
  status: string;
  drawId: string | null;
  entryId: string | null;
};

type MemberSubmissionRows = Awaited<ReturnType<MemberPaymentService['memberSubmissions']>>;

@Injectable()
export class TokenizedMemberPaymentService extends MemberPaymentService {
  private readonly logger = new Logger(TokenizedMemberPaymentService.name);

  constructor(
    prisma: PrismaService,
    db: FinancialDbService,
    programPayments: ProgramPaymentService,
    config: ConfigService,
    audit: AuditService,
    private readonly drawTokens: LuckyDrawTokenService,
    private readonly automation: ProgramAutomationService,
  ) {
    super(prisma, db, programPayments, config, audit);
  }

  async redeemInstallmentEpin(userId: string, epinId: string) {
    const result = await super.redeemInstallmentEpin(userId, epinId);
    let reconciliationPending = false;
    let drawTokens: Awaited<ReturnType<LuckyDrawTokenService['ensurePaymentRecordInstallmentTokens']>> = [];
    try {
      drawTokens = await this.drawTokens.ensurePaymentRecordInstallmentTokens(result.paymentRecordId);
    } catch (error) {
      reconciliationPending = true;
      this.logger.warn('Installment E-PIN draw token provisioning requires reconciliation: ' +
        (error instanceof Error ? error.message : String(error)));
    }
    try {
      await this.automation.processEvent(result.businessEventId, userId);
    } catch (error) {
      reconciliationPending = true;
      this.logger.warn('Installment E-PIN business event requires retry: ' +
        (error instanceof Error ? error.message : String(error)));
    }
    return {
      ...result,
      drawTokens: drawTokens.map((item) => ({ token: item.token, installmentSequence: item.installmentSequence })),
      reconciliationPending,
    };
  }

  async reviewSubmission(...args: Parameters<MemberPaymentService['reviewSubmission']>) {
    const [submissionId] = args;
    const receipt = (await super.reviewSubmission(...args)) as ReceiptRecord;
    if (receipt.purpose === 'INSTALLMENT' && receipt.status === 'CONFIRMED') {
      await this.drawTokens.ensureConfirmedInstallmentSubmission(submissionId);
    }
    return this.adminReceipt(submissionId);
  }

  async adminReceipt(id: string) {
    const receipt = (await super.adminReceipt(id)) as ReceiptRecord;
    return this.withDrawTokens(receipt, await this.tokensForReceipt(receipt, id));
  }

  async publicReceipt(publicToken: string) {
    const receipt = (await super.publicReceipt(publicToken)) as ReceiptRecord;
    const tokens =
      receipt.purpose === 'INSTALLMENT' && receipt.status === 'CONFIRMED'
        ? await this.drawTokens.tokensForPublicReceipt(publicToken)
        : [];
    return this.withDrawTokens(receipt, tokens);
  }

  async memberSubmissions(userId: string): Promise<MemberSubmissionRows> {
    const receipts = (await super.memberSubmissions(userId)) as ReceiptRecord[];
    return Promise.all(
      receipts.map(async (receipt) => {
        const id = typeof receipt.id === 'string' ? receipt.id : null;
        return this.withDrawTokens(
          receipt,
          id ? await this.tokensForReceipt(receipt, id) : [],
        );
      }),
    ) as Promise<MemberSubmissionRows>;
  }

  async adminSubmissions(...args: Parameters<MemberPaymentService['adminSubmissions']>) {
    const receipts = (await super.adminSubmissions(...args)) as ReceiptRecord[];
    return Promise.all(
      receipts.map(async (receipt) => {
        const id = typeof receipt.id === 'string' ? receipt.id : null;
        return this.withDrawTokens(
          receipt,
          id ? await this.tokensForReceipt(receipt, id) : [],
        );
      }),
    );
  }

  private async tokensForReceipt(receipt: ReceiptRecord, submissionId: string) {
    if (receipt.purpose !== 'INSTALLMENT' || receipt.status !== 'CONFIRMED') return [];
    return this.drawTokens.tokensForSubmission(submissionId);
  }

  private withDrawTokens(receipt: ReceiptRecord, tokens: ReceiptToken[]) {
    if (receipt.purpose !== 'INSTALLMENT') return receipt;
    return {
      ...receipt,
      details: {
        ...this.detailsObject(receipt.details),
        drawTokens: tokens.map((item) => ({
          token: item.token,
          installmentSequence: item.installmentSequence,
          status: item.status,
          drawId: item.drawId,
        })),
      },
    };
  }

  private detailsObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Preserve receipt rendering even if historical metadata is malformed.
      }
    }
    return {};
  }
}
