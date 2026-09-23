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
  ProgramBusinessEventType,
  ProgramEnrollmentStatus,
  ProgramPaymentAllocationType,
  ProgramPaymentAttemptStatus,
} from '../generated/prisma/enums';
import type {
  ConfirmProgramPaymentAttemptDto,
  CreateProgramPaymentAttemptDto,
  CreateProgramRefundDto,
  FailProgramPaymentAttemptDto,
} from './program.dto';

type PaymentIdentityRow = {
  id: string;
  paymentAttemptId: string;
  requestFingerprint: string;
};

type RefundIdentityRow = {
  id: string;
  paymentRecordId: string;
  requestFingerprint: string;
};

type AttemptRow = {
  id: string;
  enrollmentId: string;
  amount: string;
  currencyCode: string;
  status: string;
  provider: string | null;
  providerReference: string | null;
};

type EnrollmentRow = {
  id: string;
  status: string;
  currencyCode: string;
  registrationFeeSnapshot: string;
  partialPaymentsAllowed: boolean | number;
  overpaymentsAllowed: boolean | number;
};

type InstallmentRow = {
  id: string;
  sequence: number;
  amount: string;
};

type AllocationRow = {
  id: string;
  allocationType: string;
  installmentId: string | null;
  amount: string;
  refunded: string | number | null;
};

type PaymentRow = {
  id: string;
  enrollmentId: string;
  amount: string;
  currencyCode: string;
};

type CountAmountRow = { total: string | number | null };

type PendingAllocation = {
  allocationType: ProgramPaymentAllocationType;
  installmentId: string | null;
  amount: Prisma.Decimal;
};

@Injectable()
export class ProgramPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialDb: FinancialDbService,
    private readonly audit: AuditService,
  ) {}

  async createAttempt(dto: CreateProgramPaymentAttemptDto, actorUserId: string) {
    const amount = this.positiveDecimal(dto.amount, 'amount');
    const initiatedAt = new Date(dto.initiatedAt);
    if (!Number.isFinite(initiatedAt.getTime())) {
      throw new BadRequestException('initiatedAt must be a valid date');
    }
    const currencyCode = dto.currencyCode.trim().toUpperCase();
    const fingerprint = this.attemptFingerprint(dto, amount, initiatedAt, currencyCode);

    const existing = await this.prisma.programPaymentAttempt.findUnique({
      where: { sourceKey: dto.sourceKey },
    });
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new ConflictException('Payment attempt source key already exists with a different payload');
      }
      return { attempt: existing, idempotent: true };
    }

    const enrollment = await this.prisma.programEnrollment.findUnique({
      where: { id: dto.enrollmentId },
      select: { id: true, status: true, currencyCode: true },
    });
    if (!enrollment) throw new NotFoundException('Program enrollment not found');
    if (enrollment.status !== ProgramEnrollmentStatus.ACTIVE) {
      throw new ConflictException('Payments can only be initiated for an active enrollment');
    }
    if (enrollment.currencyCode !== currencyCode) {
      throw new BadRequestException('Payment currency must match enrollment currency');
    }

    try {
      const attempt = await this.prisma.programPaymentAttempt.create({
        data: {
          sourceKey: dto.sourceKey,
          requestFingerprint: fingerprint,
          enrollmentId: dto.enrollmentId,
          amount,
          currencyCode,
          provider: dto.provider?.trim() || null,
          providerReference: dto.providerReference?.trim() || null,
          status: ProgramPaymentAttemptStatus.INITIATED,
          initiatedAt,
          metadata: dto.metadata as Prisma.InputJsonValue | undefined,
          createdByUserId: actorUserId,
        },
      });
      await this.audit.log({
        actorUserId,
        action: AuditAction.CREATE,
        entityType: 'ProgramPaymentAttempt',
        entityId: attempt.id,
        description: 'Program payment attempt initiated',
        metadata: { enrollmentId: attempt.enrollmentId, amount: attempt.amount.toString() },
      });
      return { attempt, idempotent: false };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        const raced = await this.prisma.programPaymentAttempt.findUnique({
          where: { sourceKey: dto.sourceKey },
        });
        if (raced && raced.requestFingerprint === fingerprint) {
          return { attempt: raced, idempotent: true };
        }
        throw new ConflictException('Payment attempt source key already exists');
      }
      throw error;
    }
  }

  async confirmAttempt(
    attemptId: string,
    dto: ConfirmProgramPaymentAttemptDto,
    actorUserId: string,
  ) {
    const occurredAt = new Date(dto.occurredAt);
    if (!Number.isFinite(occurredAt.getTime())) {
      throw new BadRequestException('occurredAt must be a valid date');
    }
    const fingerprint = this.confirmFingerprint(attemptId, occurredAt);
    const existing = await this.prisma.programPaymentRecord.findUnique({
      where: { sourceKey: dto.sourceKey },
      select: { id: true, paymentAttemptId: true, requestFingerprint: true },
    });
    if (existing) {
      this.assertPaymentIdempotent(existing, attemptId, fingerprint);
      return { payment: await this.getPayment(existing.id), idempotent: true };
    }

    const mutexKey = `PROGRAM_PAYMENT:${attemptId}`;
    await this.ensureMutex(mutexKey);
    let paymentId: string;
    try {
      paymentId = await this.financialDb.transaction((connection) =>
        this.confirmTransaction(
          connection,
          attemptId,
          dto,
          actorUserId,
          occurredAt,
          fingerprint,
          mutexKey,
        ),
      );
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        const duplicate = await this.prisma.programPaymentRecord.findUnique({
          where: { sourceKey: dto.sourceKey },
          select: { id: true, paymentAttemptId: true, requestFingerprint: true },
        });
        if (duplicate) {
          this.assertPaymentIdempotent(duplicate, attemptId, fingerprint);
          return { payment: await this.getPayment(duplicate.id), idempotent: true };
        }
      }
      throw error;
    }

    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'ProgramPaymentRecord',
      entityId: paymentId,
      description: 'Program payment confirmed',
      metadata: { attemptId, sourceKey: dto.sourceKey },
    });
    return { payment: await this.getPayment(paymentId), idempotent: false };
  }

  async failAttempt(attemptId: string, dto: FailProgramPaymentAttemptDto, actorUserId: string) {
    const finalizedAt = new Date(dto.finalizedAt);
    if (!Number.isFinite(finalizedAt.getTime())) {
      throw new BadRequestException('finalizedAt must be a valid date');
    }
    const attempt = await this.prisma.programPaymentAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw new NotFoundException('Program payment attempt not found');
    if (attempt.status === ProgramPaymentAttemptStatus.FAILED) return attempt;
    if (attempt.status !== ProgramPaymentAttemptStatus.INITIATED) {
      throw new ConflictException('Only initiated payment attempts can be failed');
    }

    const failed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.programPaymentAttempt.update({
        where: { id: attemptId },
        data: {
          status: ProgramPaymentAttemptStatus.FAILED,
          finalizedAt,
          failureReason: dto.reason?.trim() || null,
        },
      });
      await tx.programBusinessEvent.create({
        data: {
          sourceKey: `PROGRAM_PAYMENT_ATTEMPT:${attemptId}:FAILED`,
          type: ProgramBusinessEventType.PAYMENT_FAILED,
          enrollmentId: attempt.enrollmentId,
          occurredAt: finalizedAt,
          payload: { paymentAttemptId: attemptId, reason: dto.reason?.trim() || null },
        },
      });
      return updated;
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'ProgramPaymentAttempt',
      entityId: attemptId,
      description: 'Program payment attempt failed',
    });
    return failed;
  }

  async createRefund(dto: CreateProgramRefundDto, actorUserId: string) {
    const occurredAt = new Date(dto.occurredAt);
    if (!Number.isFinite(occurredAt.getTime())) {
      throw new BadRequestException('occurredAt must be a valid date');
    }
    const amount = this.positiveDecimal(dto.amount, 'amount');
    const currencyCode = dto.currencyCode.trim().toUpperCase();
    const fingerprint = this.refundFingerprint(dto, amount, occurredAt, currencyCode);

    const existing = await this.prisma.programRefundRecord.findUnique({
      where: { sourceKey: dto.sourceKey },
      select: { id: true, paymentRecordId: true, requestFingerprint: true },
    });
    if (existing) {
      this.assertRefundIdempotent(existing, dto.paymentRecordId, fingerprint);
      return { refund: await this.getRefund(existing.id), idempotent: true };
    }

    const mutexKey = `PROGRAM_REFUND:${dto.paymentRecordId}`;
    await this.ensureMutex(mutexKey);
    let refundId: string;
    try {
      refundId = await this.financialDb.transaction((connection) =>
        this.refundTransaction(
          connection,
          dto,
          actorUserId,
          amount,
          currencyCode,
          occurredAt,
          fingerprint,
          mutexKey,
        ),
      );
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        const duplicate = await this.prisma.programRefundRecord.findUnique({
          where: { sourceKey: dto.sourceKey },
          select: { id: true, paymentRecordId: true, requestFingerprint: true },
        });
        if (duplicate) {
          this.assertRefundIdempotent(duplicate, dto.paymentRecordId, fingerprint);
          return { refund: await this.getRefund(duplicate.id), idempotent: true };
        }
      }
      throw error;
    }

    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'ProgramRefundRecord',
      entityId: refundId,
      description: 'Program payment refund recorded',
      metadata: { paymentRecordId: dto.paymentRecordId, amount: amount.toFixed(2) },
    });
    return { refund: await this.getRefund(refundId), idempotent: false };
  }

  async getAttempt(id: string) {
    const attempt = await this.prisma.programPaymentAttempt.findUnique({
      where: { id },
      include: { paymentRecord: true },
    });
    if (!attempt) throw new NotFoundException('Program payment attempt not found');
    return attempt;
  }

  async getPayment(id: string) {
    const payment = await this.prisma.programPaymentRecord.findUnique({
      where: { id },
      include: {
        attempt: true,
        enrollment: { include: { user: { select: { id: true, username: true } } } },
        allocations: { orderBy: { createdAt: 'asc' }, include: { refundAllocations: true } },
        refunds: { orderBy: { occurredAt: 'asc' } },
      },
    });
    if (!payment) throw new NotFoundException('Program payment record not found');
    return payment;
  }

  async getRefund(id: string) {
    const refund = await this.prisma.programRefundRecord.findUnique({
      where: { id },
      include: {
        paymentRecord: true,
        enrollment: { include: { user: { select: { id: true, username: true } } } },
        allocations: { include: { paymentAllocation: true } },
      },
    });
    if (!refund) throw new NotFoundException('Program refund record not found');
    return refund;
  }

  private async confirmTransaction(
    connection: PoolConnection,
    attemptId: string,
    dto: ConfirmProgramPaymentAttemptDto,
    actorUserId: string,
    occurredAt: Date,
    fingerprint: string,
    mutexKey: string,
  ): Promise<string> {
    await this.touchMutex(connection, mutexKey);
    const duplicateRows = await connection.query<PaymentIdentityRow[]>(
      `SELECT id, paymentAttemptId, requestFingerprint
       FROM program_payment_records WHERE sourceKey = ? LIMIT 1`,
      [dto.sourceKey],
    );
    if (duplicateRows[0]) {
      this.assertPaymentIdempotent(duplicateRows[0], attemptId, fingerprint);
      return duplicateRows[0].id;
    }

    const attemptRows = await connection.query<AttemptRow[]>(
      `SELECT id, enrollmentId, amount, currencyCode, status, provider, providerReference
       FROM program_payment_attempts WHERE id = ? LIMIT 1`,
      [attemptId],
    );
    const attempt = attemptRows[0];
    if (!attempt) throw new NotFoundException('Program payment attempt not found');
    if (attempt.status !== ProgramPaymentAttemptStatus.INITIATED) {
      throw new ConflictException('Only initiated payment attempts can be confirmed');
    }

    const enrollmentRows = await connection.query<EnrollmentRow[]>(
      `SELECT e.id, e.status, e.currencyCode, e.registrationFeeSnapshot,
              v.partialPaymentsAllowed, v.overpaymentsAllowed
       FROM program_enrollments e
       INNER JOIN program_versions v ON v.id = e.programVersionId
       WHERE e.id = ? LIMIT 1`,
      [attempt.enrollmentId],
    );
    const enrollment = enrollmentRows[0];
    if (!enrollment) throw new NotFoundException('Program enrollment not found');
    if (enrollment.status !== ProgramEnrollmentStatus.ACTIVE) {
      throw new ConflictException('Payment confirmation requires an active enrollment');
    }
    if (enrollment.currencyCode !== attempt.currencyCode) {
      throw new ConflictException('Payment attempt currency no longer matches enrollment currency');
    }

    const installments = await connection.query<InstallmentRow[]>(
      `SELECT id, sequence, amount FROM program_installments
       WHERE enrollmentId = ? ORDER BY sequence ASC`,
      [enrollment.id],
    );
    const allocations = await this.loadAllocations(connection, enrollment.id);
    const pending = this.buildPendingAllocations(
      new Prisma.Decimal(attempt.amount),
      new Prisma.Decimal(enrollment.registrationFeeSnapshot),
      installments,
      allocations,
      this.truthy(enrollment.partialPaymentsAllowed),
      this.truthy(enrollment.overpaymentsAllowed),
    );

    const paymentId = randomUUID();
    await connection.query(
      `INSERT INTO program_payment_records
         (id, sourceKey, requestFingerprint, paymentAttemptId, enrollmentId, amount,
          currencyCode, provider, providerReference, occurredAt, metadata, createdByUserId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        paymentId,
        dto.sourceKey,
        fingerprint,
        attempt.id,
        enrollment.id,
        attempt.amount,
        attempt.currencyCode,
        attempt.provider,
        attempt.providerReference,
        occurredAt,
        dto.metadata ? JSON.stringify(dto.metadata) : null,
        actorUserId,
      ],
    );
    for (const allocation of pending.allocations) {
      await connection.query(
        `INSERT INTO program_payment_allocations
           (id, paymentRecordId, enrollmentId, allocationType, installmentId, amount, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
        [
          randomUUID(),
          paymentId,
          enrollment.id,
          allocation.allocationType,
          allocation.installmentId,
          allocation.amount.toFixed(2),
        ],
      );
    }
    await connection.query(
      `UPDATE program_payment_attempts
       SET status = ?, finalizedAt = ?, updatedAt = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [ProgramPaymentAttemptStatus.CONFIRMED, occurredAt, attempt.id],
    );
    await connection.query(
      `INSERT INTO program_business_events
         (id, sourceKey, type, enrollmentId, paymentRecordId, refundRecordId,
          occurredAt, payload, createdAt)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        randomUUID(),
        `PROGRAM_PAYMENT:${paymentId}:CONFIRMED`,
        ProgramBusinessEventType.PAYMENT_CONFIRMED,
        enrollment.id,
        paymentId,
        occurredAt,
        JSON.stringify({ paymentAttemptId: attempt.id, amount: attempt.amount, currencyCode: attempt.currencyCode }),
      ],
    );

    if (pending.outstandingAfter.equals(0)) {
      await connection.query(
        `UPDATE program_enrollments SET status = ?, updatedAt = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [ProgramEnrollmentStatus.COMPLETED, enrollment.id],
      );
      await connection.query(
        `INSERT INTO program_business_events
           (id, sourceKey, type, enrollmentId, paymentRecordId, refundRecordId,
            occurredAt, payload, createdAt)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, CURRENT_TIMESTAMP(3))`,
        [
          randomUUID(),
          `PROGRAM_ENROLLMENT:${enrollment.id}:COMPLETED:${paymentId}`,
          ProgramBusinessEventType.ENROLLMENT_COMPLETED,
          enrollment.id,
          paymentId,
          occurredAt,
          JSON.stringify({ reason: 'FULLY_PAID' }),
        ],
      );
    }
    return paymentId;
  }

  private async refundTransaction(
    connection: PoolConnection,
    dto: CreateProgramRefundDto,
    actorUserId: string,
    amount: Prisma.Decimal,
    currencyCode: string,
    occurredAt: Date,
    fingerprint: string,
    mutexKey: string,
  ): Promise<string> {
    await this.touchMutex(connection, mutexKey);
    const duplicateRows = await connection.query<RefundIdentityRow[]>(
      `SELECT id, paymentRecordId, requestFingerprint
       FROM program_refund_records WHERE sourceKey = ? LIMIT 1`,
      [dto.sourceKey],
    );
    if (duplicateRows[0]) {
      this.assertRefundIdempotent(duplicateRows[0], dto.paymentRecordId, fingerprint);
      return duplicateRows[0].id;
    }

    const paymentRows = await connection.query<PaymentRow[]>(
      `SELECT id, enrollmentId, amount, currencyCode
       FROM program_payment_records WHERE id = ? LIMIT 1`,
      [dto.paymentRecordId],
    );
    const payment = paymentRows[0];
    if (!payment) throw new NotFoundException('Program payment record not found');
    if (payment.currencyCode !== currencyCode) {
      throw new BadRequestException('Refund currency must match payment currency');
    }

    const refundedRows = await connection.query<CountAmountRow[]>(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM program_refund_records WHERE paymentRecordId = ?`,
      [payment.id],
    );
    const alreadyRefunded = new Prisma.Decimal(refundedRows[0]?.total ?? 0);
    const refundable = new Prisma.Decimal(payment.amount).minus(alreadyRefunded);
    if (amount.greaterThan(refundable)) {
      throw new ConflictException('Refund amount exceeds the unrefunded payment amount');
    }

    const allocationRows = await connection.query<AllocationRow[]>(
      `SELECT a.id, a.allocationType, a.installmentId, a.amount,
              COALESCE(SUM(ra.amount), 0) AS refunded
       FROM program_payment_allocations a
       LEFT JOIN program_refund_allocations ra ON ra.paymentAllocationId = a.id
       WHERE a.paymentRecordId = ?
       GROUP BY a.id, a.allocationType, a.installmentId, a.amount, a.createdAt
       ORDER BY a.createdAt DESC, a.id DESC`,
      [payment.id],
    );

    let remaining = amount;
    const refundParts: Array<{ allocation: AllocationRow; amount: Prisma.Decimal }> = [];
    for (const allocation of allocationRows) {
      if (remaining.equals(0)) break;
      const available = new Prisma.Decimal(allocation.amount).minus(allocation.refunded ?? 0);
      if (available.lessThanOrEqualTo(0)) continue;
      const applied = Prisma.Decimal.min(remaining, available);
      refundParts.push({ allocation, amount: applied });
      remaining = remaining.minus(applied);
    }
    if (!remaining.equals(0)) {
      throw new ConflictException('Refund allocations do not contain enough refundable value');
    }

    const refundId = randomUUID();
    await connection.query(
      `INSERT INTO program_refund_records
         (id, sourceKey, requestFingerprint, paymentRecordId, enrollmentId, amount,
          currencyCode, occurredAt, reason, metadata, createdByUserId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        refundId,
        dto.sourceKey,
        fingerprint,
        payment.id,
        payment.enrollmentId,
        amount.toFixed(2),
        currencyCode,
        occurredAt,
        dto.reason?.trim() || null,
        dto.metadata ? JSON.stringify(dto.metadata) : null,
        actorUserId,
      ],
    );
    for (const part of refundParts) {
      await connection.query(
        `INSERT INTO program_refund_allocations
           (id, refundRecordId, paymentAllocationId, amount, createdAt)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
        [randomUUID(), refundId, part.allocation.id, part.amount.toFixed(2)],
      );
    }
    await connection.query(
      `INSERT INTO program_business_events
         (id, sourceKey, type, enrollmentId, paymentRecordId, refundRecordId,
          occurredAt, payload, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        randomUUID(),
        `PROGRAM_REFUND:${refundId}:CONFIRMED`,
        ProgramBusinessEventType.REFUND_CONFIRMED,
        payment.enrollmentId,
        payment.id,
        refundId,
        occurredAt,
        JSON.stringify({ amount: amount.toFixed(2), currencyCode }),
      ],
    );

    const reopensEnrollment = refundParts.some(
      (part) => part.allocation.allocationType !== ProgramPaymentAllocationType.UNAPPLIED,
    );
    if (reopensEnrollment) {
      const result = await connection.query<{ affectedRows: number }>(
        `UPDATE program_enrollments
         SET status = ?, updatedAt = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND status = ?`,
        [
          ProgramEnrollmentStatus.ACTIVE,
          payment.enrollmentId,
          ProgramEnrollmentStatus.COMPLETED,
        ],
      );
      if (Number(result.affectedRows ?? 0) > 0) {
        await connection.query(
          `INSERT INTO program_business_events
             (id, sourceKey, type, enrollmentId, paymentRecordId, refundRecordId,
              occurredAt, payload, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
          [
            randomUUID(),
            `PROGRAM_ENROLLMENT:${payment.enrollmentId}:REOPENED:${refundId}`,
            ProgramBusinessEventType.ENROLLMENT_REOPENED,
            payment.enrollmentId,
            payment.id,
            refundId,
            occurredAt,
            JSON.stringify({ reason: 'REFUND_CREATED_OUTSTANDING_AMOUNT' }),
          ],
        );
      }
    }
    return refundId;
  }

  private buildPendingAllocations(
    paymentAmount: Prisma.Decimal,
    registrationFee: Prisma.Decimal,
    installments: InstallmentRow[],
    priorAllocations: AllocationRow[],
    partialPaymentsAllowed: boolean,
    overpaymentsAllowed: boolean,
  ) {
    const netByType = new Map<string, Prisma.Decimal>();
    for (const allocation of priorAllocations) {
      const key = allocation.installmentId
        ? `INSTALLMENT:${allocation.installmentId}`
        : allocation.allocationType;
      const net = new Prisma.Decimal(allocation.amount).minus(allocation.refunded ?? 0);
      netByType.set(key, (netByType.get(key) ?? new Prisma.Decimal(0)).plus(net));
    }

    const charges: Array<{
      allocationType: ProgramPaymentAllocationType;
      installmentId: string | null;
      outstanding: Prisma.Decimal;
    }> = [];
    const registrationPaid = netByType.get(ProgramPaymentAllocationType.REGISTRATION_FEE) ?? new Prisma.Decimal(0);
    const registrationOutstanding = Prisma.Decimal.max(
      registrationFee.minus(registrationPaid),
      new Prisma.Decimal(0),
    );
    if (registrationOutstanding.greaterThan(0)) {
      charges.push({
        allocationType: ProgramPaymentAllocationType.REGISTRATION_FEE,
        installmentId: null,
        outstanding: registrationOutstanding,
      });
    }
    for (const installment of installments) {
      const paid = netByType.get(`INSTALLMENT:${installment.id}`) ?? new Prisma.Decimal(0);
      const outstanding = Prisma.Decimal.max(
        new Prisma.Decimal(installment.amount).minus(paid),
        new Prisma.Decimal(0),
      );
      if (outstanding.greaterThan(0)) {
        charges.push({
          allocationType: ProgramPaymentAllocationType.INSTALLMENT,
          installmentId: installment.id,
          outstanding,
        });
      }
    }

    let remaining = paymentAmount;
    const allocations: PendingAllocation[] = [];
    for (const charge of charges) {
      if (remaining.equals(0)) break;
      if (!partialPaymentsAllowed && remaining.lessThan(charge.outstanding)) {
        throw new ConflictException('Partial payments are disabled for this program version');
      }
      const allocated = Prisma.Decimal.min(remaining, charge.outstanding);
      allocations.push({
        allocationType: charge.allocationType,
        installmentId: charge.installmentId,
        amount: allocated,
      });
      remaining = remaining.minus(allocated);
    }

    if (remaining.greaterThan(0)) {
      if (!overpaymentsAllowed) {
        throw new ConflictException('Payment amount exceeds the enrollment outstanding amount');
      }
      allocations.push({
        allocationType: ProgramPaymentAllocationType.UNAPPLIED,
        installmentId: null,
        amount: remaining,
      });
      remaining = new Prisma.Decimal(0);
    }

    const chargeAllocationTotal = allocations
      .filter((allocation) => allocation.allocationType !== ProgramPaymentAllocationType.UNAPPLIED)
      .reduce((sum, allocation) => sum.plus(allocation.amount), new Prisma.Decimal(0));
    const outstandingBefore = charges.reduce(
      (sum, charge) => sum.plus(charge.outstanding),
      new Prisma.Decimal(0),
    );
    return {
      allocations,
      outstandingAfter: Prisma.Decimal.max(
        outstandingBefore.minus(chargeAllocationTotal),
        new Prisma.Decimal(0),
      ),
    };
  }

  private async loadAllocations(connection: PoolConnection, enrollmentId: string) {
    return connection.query<AllocationRow[]>(
      `SELECT a.id, a.allocationType, a.installmentId, a.amount,
              COALESCE(SUM(ra.amount), 0) AS refunded
       FROM program_payment_allocations a
       LEFT JOIN program_refund_allocations ra ON ra.paymentAllocationId = a.id
       WHERE a.enrollmentId = ?
       GROUP BY a.id, a.allocationType, a.installmentId, a.amount, a.createdAt
       ORDER BY a.createdAt ASC, a.id ASC`,
      [enrollmentId],
    );
  }

  private async ensureMutex(key: string) {
    await this.financialDb.execute(
      `INSERT INTO system_sequences (\`key\`, nextValue, updatedAt)
       VALUES (?, 0, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE \`key\` = VALUES(\`key\`)`,
      [key],
    );
  }

  private async touchMutex(connection: PoolConnection, key: string) {
    await connection.query(
      `UPDATE system_sequences SET nextValue = nextValue + 1, updatedAt = CURRENT_TIMESTAMP(3)
       WHERE \`key\` = ?`,
      [key],
    );
  }

  private positiveDecimal(raw: string, field: string) {
    try {
      const value = new Prisma.Decimal(raw);
      if (!value.isFinite() || value.lessThanOrEqualTo(0)) throw new Error('invalid');
      return value.toDecimalPlaces(2);
    } catch {
      throw new BadRequestException(`${field} must be greater than zero`);
    }
  }

  private attemptFingerprint(
    dto: CreateProgramPaymentAttemptDto,
    amount: Prisma.Decimal,
    initiatedAt: Date,
    currencyCode: string,
  ) {
    return createHash('sha256')
      .update(
        `${dto.enrollmentId}|${amount.toFixed(2)}|${currencyCode}|${initiatedAt.toISOString()}|${dto.provider?.trim() ?? ''}|${dto.providerReference?.trim() ?? ''}`,
      )
      .digest('hex');
  }

  private confirmFingerprint(attemptId: string, occurredAt: Date) {
    return createHash('sha256').update(`${attemptId}|${occurredAt.toISOString()}`).digest('hex');
  }

  private refundFingerprint(
    dto: CreateProgramRefundDto,
    amount: Prisma.Decimal,
    occurredAt: Date,
    currencyCode: string,
  ) {
    return createHash('sha256')
      .update(`${dto.paymentRecordId}|${amount.toFixed(2)}|${currencyCode}|${occurredAt.toISOString()}`)
      .digest('hex');
  }

  private assertPaymentIdempotent(
    existing: PaymentIdentityRow,
    attemptId: string,
    fingerprint: string,
  ) {
    if (existing.paymentAttemptId !== attemptId || existing.requestFingerprint !== fingerprint) {
      throw new ConflictException('Payment record source key already exists with a different payload');
    }
  }

  private assertRefundIdempotent(
    existing: RefundIdentityRow,
    paymentRecordId: string,
    fingerprint: string,
  ) {
    if (
      existing.paymentRecordId !== paymentRecordId ||
      existing.requestFingerprint !== fingerprint
    ) {
      throw new ConflictException('Refund source key already exists with a different payload');
    }
  }

  private truthy(value: boolean | number) {
    return value === true || value === 1;
  }
}
