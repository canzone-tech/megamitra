import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { FinancialDbService } from '../database/financial-db.service';
import { PrismaService } from '../database/prisma.service';
import { AuditAction } from '../generated/prisma/enums';
import { ProgramPaymentService } from '../program/program-payment.service';
import type { AuthUser } from '../auth/auth-user';
import type {
  CancelMemberEnrollmentDto,
  CancelUnusedEpinDto,
  ReassignEpinDto,
  ReviewMemberPaymentDto,
  SubmitEpinPaymentDto,
  SubmitInstallmentPaymentDto,
  UpdatePaymentSettingsDto,
} from './member-payment.dto';

type SqlValue = string | number | bigint | boolean | Date | null;

type PaymentSettingsRow = {
  id: number;
  upiId: string | null;
  payeeName: string | null;
  qrImageDataUrl: string | null;
  instructions: string | null;
  enabled: boolean | number;
  updatedAt: Date;
};

type SeasonCommercialRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  startDate: Date;
  endDate: Date | null;
  registrationClosesAt: Date | null;
  programVersionId: string;
  currencyCode: string;
  registrationFee: string;
  installmentAmount: string;
  installmentCount: number;
  lifecycle: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

type SubmissionRow = {
  id: string;
  receiptNumber: string;
  publicToken: string;
  purpose: 'INSTALLMENT' | 'EPIN_PURCHASE';
  requesterUserId: string;
  seasonId: string;
  enrollmentId: string | null;
  epinQuantity: number | null;
  amount: string;
  currencyCode: string;
  providerReference: string;
  paymentProofDataUrl: string;
  status: string;
  details: unknown;
  reviewedByUserId: string | null;
  reviewNote: string | null;
  programPaymentAttemptId: string | null;
  programPaymentRecordId: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
};

type EnrollmentRow = {
  id: string;
  status: string;
  programVersionId: string;
  currencyCode: string;
  registrationFeeSnapshot: string;
  installmentAmountSnapshot: string;
  installmentCountSnapshot: number;
  seasonId: string;
  seasonCode: string;
  seasonName: string;
};

type InstallmentRow = {
  id: string;
  sequence: number;
  amount: string;
  paid: string | number | null;
};

type EpinRow = {
  id: string;
  pinCiphertext: string | null;
  displaySuffix: string;
  status: string;
  assignedUserId: string | null;
  usedByUserId: string | null;
  seasonId: string | null;
  paymentSubmissionId: string | null;
  currencyCodeSnapshot: string | null;
  registrationFeeSnapshot: string | null;
  installmentAmountSnapshot: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  assignedAt: Date | null;
  cancelledAt: Date | null;
  refundAmount: string | null;
  refundReference: string | null;
};

@Injectable()
export class MemberPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly db: FinancialDbService,
    private readonly programPayments: ProgramPaymentService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async memberPaymentConfig(userId: string) {
    const [settings, seasons, enrollment] = await Promise.all([
      this.paymentSettings(),
      this.rows<SeasonCommercialRow>(
        `SELECT s.id, s.code, s.name, s.status, s.startDate, s.endDate, s.registrationClosesAt,
                s.programVersionId, pv.currencyCode, pv.registrationFee, pv.installmentAmount,
                pv.installmentCount, pv.lifecycle, pv.effectiveFrom, pv.effectiveTo
         FROM owner_seasons s
         JOIN program_versions pv ON pv.id=s.programVersionId
         WHERE s.status='ACTIVE' AND pv.lifecycle='PUBLISHED'
           AND (s.registrationClosesAt IS NULL OR s.registrationClosesAt>CURRENT_TIMESTAMP(3))
         ORDER BY s.startDate ASC, s.createdAt ASC`,
      ),
      this.findEnrollment(userId, false),
    ]);
    return {
      paymentRail: {
        enabled: this.truthy(settings.enabled),
        upiId: settings.upiId,
        payeeName: settings.payeeName,
        qrImageDataUrl: settings.qrImageDataUrl,
        instructions: settings.instructions,
      },
      seasons: seasons.map((season) => ({
        id: season.id,
        code: season.code,
        name: season.name,
        currencyCode: season.currencyCode,
        registrationFee: season.registrationFee,
        installmentAmount: season.installmentAmount,
        joiningAmount: this.money(
          Number(season.registrationFee) + Number(season.installmentAmount),
        ),
        installmentCount: Number(season.installmentCount),
        registrationClosesAt: season.registrationClosesAt,
      })),
      installment: enrollment ? await this.installmentSummary(enrollment) : null,
    };
  }

  async paymentSettings() {
    const rows = await this.rows<PaymentSettingsRow>(
      `SELECT id, upiId, payeeName, qrImageDataUrl, instructions, enabled, updatedAt
       FROM owner_payment_settings WHERE id=1 LIMIT 1`,
    );
    if (!rows[0]) throw new NotFoundException('Payment settings are not initialized');
    return rows[0];
  }

  async updatePaymentSettings(dto: UpdatePaymentSettingsDto, actorUserId: string) {
    this.validatePaymentProof(dto.qrImageDataUrl, true);
    await this.db.execute(
      `UPDATE owner_payment_settings
       SET upiId=?, payeeName=?, qrImageDataUrl=?, instructions=?, enabled=?, updatedByUserId=?
       WHERE id=1`,
      [
        dto.upiId?.trim() || null,
        dto.payeeName?.trim() || null,
        dto.qrImageDataUrl?.trim() || null,
        dto.instructions?.trim() || null,
        dto.enabled,
        actorUserId,
      ],
    );
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerPaymentSettings',
      entityId: '1',
      description: 'Member QR/UPI payment settings updated',
      metadata: { enabled: dto.enabled, upiIdConfigured: Boolean(dto.upiId?.trim()) },
    });
    return this.paymentSettings();
  }

  async submitInstallment(userId: string, dto: SubmitInstallmentPaymentDto) {
    await this.requirePaymentRail();
    this.validatePaymentProof(dto.paymentProofDataUrl);
    const amount = this.positiveMoney(dto.amount, 'amount');
    const enrollment = await this.findEnrollment(userId, true);
    const summary = await this.installmentSummary(enrollment);
    const installmentAmount = Number(enrollment.installmentAmountSnapshot);
    const requestedCount = amount / installmentAmount;
    if (!Number.isInteger(requestedCount) || requestedCount < 1) {
      throw new BadRequestException(
        `Installment payment must be an exact multiple of ${this.money(installmentAmount)} ${enrollment.currencyCode}`,
      );
    }
    if (requestedCount > summary.remainingInstallmentCount) {
      throw new ConflictException('Payment exceeds the remaining installment balance');
    }
    const submission = await this.createSubmission({
      purpose: 'INSTALLMENT',
      requesterUserId: userId,
      seasonId: enrollment.seasonId,
      enrollmentId: enrollment.id,
      epinQuantity: null,
      amount,
      currencyCode: enrollment.currencyCode,
      providerReference: dto.utr,
      paymentProofDataUrl: dto.paymentProofDataUrl,
      details: {
        installmentAmount: this.money(installmentAmount),
        installmentCount: requestedCount,
        allocationMode: 'NEXT_UNPAID_SEQUENTIAL',
      },
    });
    return this.receiptEnvelope(submission);
  }

  async submitEpinPurchase(userId: string, dto: SubmitEpinPaymentDto) {
    await this.requirePaymentRail();
    this.validatePaymentProof(dto.paymentProofDataUrl);
    const season = await this.requireOpenSeason(dto.seasonId);
    const pinValue = Number(season.registrationFee) + Number(season.installmentAmount);
    const amount = pinValue * dto.quantity;
    const submission = await this.createSubmission({
      purpose: 'EPIN_PURCHASE',
      requesterUserId: userId,
      seasonId: season.id,
      enrollmentId: null,
      epinQuantity: dto.quantity,
      amount,
      currencyCode: season.currencyCode,
      providerReference: dto.utr,
      paymentProofDataUrl: dto.paymentProofDataUrl,
      details: {
        quantity: dto.quantity,
        registrationFeePerPin: this.money(Number(season.registrationFee)),
        firstInstallmentPerPin: this.money(Number(season.installmentAmount)),
        valuePerPin: this.money(pinValue),
      },
    });
    return this.receiptEnvelope(submission);
  }

  async memberSubmissions(userId: string) {
    const rows = await this.rows<SubmissionRow & { seasonCode: string; seasonName: string }>(
      `SELECT p.*, s.code AS seasonCode, s.name AS seasonName
       FROM member_payment_submissions p
       JOIN owner_seasons s ON s.id=p.seasonId
       WHERE p.requesterUserId=?
       ORDER BY p.submittedAt DESC LIMIT 200`,
      [userId],
    );
    return rows.map((row) => this.receiptEnvelope(row));
  }

  async adminSubmissions(status?: string, purpose?: string) {
    const conditions: string[] = [];
    const values: SqlValue[] = [];
    if (status?.trim()) {
      conditions.push('p.status=?');
      values.push(status.trim().toUpperCase());
    }
    if (purpose?.trim()) {
      conditions.push('p.purpose=?');
      values.push(purpose.trim().toUpperCase());
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return this.rows<Record<string, unknown>>(
      `SELECT p.id, p.receiptNumber, p.publicToken, p.purpose, p.amount, p.currencyCode,
              p.providerReference, p.paymentProofDataUrl, p.status, p.details, p.submittedAt,
              p.reviewedAt, p.reviewNote, p.epinQuantity,
              u.id AS memberId, u.username, u.firstName, u.lastName,
              s.code AS seasonCode, s.name AS seasonName,
              reviewer.username AS reviewedByUsername
       FROM member_payment_submissions p
       JOIN users u ON u.id=p.requesterUserId
       JOIN owner_seasons s ON s.id=p.seasonId
       LEFT JOIN users reviewer ON reviewer.id=p.reviewedByUserId
       ${where}
       ORDER BY CASE p.status WHEN 'PENDING_VERIFICATION' THEN 0 WHEN 'PROCESSING' THEN 1 ELSE 2 END,
                p.submittedAt DESC LIMIT 500`,
      values,
    );
  }

  async reviewSubmission(
    submissionId: string,
    dto: ReviewMemberPaymentDto,
    actor: AuthUser,
  ) {
    const claimed = await this.claimForReview(submissionId, actor, dto.decision);
    if (dto.decision === 'REJECT') {
      await this.rejectSubmission(claimed, actor.id, dto.note);
      return this.adminReceipt(submissionId);
    }

    try {
      if (claimed.purpose === 'INSTALLMENT') {
        await this.approveInstallment(claimed, actor.id);
      } else if (claimed.purpose === 'EPIN_PURCHASE') {
        await this.approveEpinPurchase(claimed, actor.id);
      } else {
        throw new ConflictException('Unsupported payment purpose');
      }
      if (dto.note?.trim()) {
        await this.db.execute(
          'UPDATE member_payment_submissions SET reviewNote=? WHERE id=?',
          [dto.note.trim(), submissionId],
        );
      }
    } catch (error) {
      await this.db.execute(
        `UPDATE member_payment_submissions SET status='PENDING_VERIFICATION', reviewedByUserId=NULL,
                reviewedAt=NULL WHERE id=? AND status='PROCESSING'`,
        [submissionId],
      );
      throw error;
    }
    return this.adminReceipt(submissionId);
  }

  async memberEpins(userId: string) {
    const rows = await this.rows<EpinRow & { seasonCode: string | null; seasonName: string | null }>(
      `SELECT e.id, e.pinCiphertext, e.displaySuffix, e.status, e.assignedUserId, e.usedByUserId,
              e.seasonId, e.paymentSubmissionId, e.currencyCodeSnapshot, e.registrationFeeSnapshot,
              e.installmentAmountSnapshot, e.expiresAt, e.usedAt, e.assignedAt, e.cancelledAt,
              e.refundAmount, e.refundReference, s.code AS seasonCode, s.name AS seasonName
       FROM owner_epins e
       LEFT JOIN owner_seasons s ON s.id=e.seasonId
       WHERE e.assignedUserId=? ORDER BY e.createdAt DESC LIMIT 500`,
      [userId],
    );
    return rows.map((row) => {
      const expired = row.status === 'ACTIVE' && new Date(row.expiresAt).getTime() <= Date.now();
      return {
        id: row.id,
        pin: !expired && row.status === 'ACTIVE' && row.pinCiphertext
          ? this.decryptPin(row.pinCiphertext)
          : null,
        displaySuffix: row.displaySuffix,
        status: expired ? 'EXPIRED' : row.status,
        seasonId: row.seasonId,
        seasonCode: row.seasonCode,
        seasonName: row.seasonName,
        currencyCode: row.currencyCodeSnapshot,
        registrationFee: row.registrationFeeSnapshot,
        firstInstallment: row.installmentAmountSnapshot,
        expiresAt: row.expiresAt,
        usedAt: row.usedAt,
        assignedAt: row.assignedAt,
      };
    });
  }

  async reassignUnusedEpin(id: string, dto: ReassignEpinDto, actorUserId: string) {
    const member = await this.resolveActiveMember(dto.memberReference);
    const changed = await this.db.transaction(async (connection) => {
      const rows = await connection.query<EpinRow[]>(
        `SELECT id, pinCiphertext, displaySuffix, status, assignedUserId, usedByUserId, seasonId,
                paymentSubmissionId, currencyCodeSnapshot, registrationFeeSnapshot,
                installmentAmountSnapshot, expiresAt, usedAt, assignedAt, cancelledAt,
                refundAmount, refundReference
         FROM owner_epins WHERE id=? LIMIT 1 FOR UPDATE`,
        [id],
      );
      const pin = rows[0];
      if (!pin) throw new NotFoundException('E-PIN not found');
      if (pin.status !== 'ACTIVE' || pin.usedByUserId || new Date(pin.expiresAt) <= new Date()) {
        throw new ConflictException('Only an unused, unexpired E-PIN can be reassigned');
      }
      await connection.query(
        `UPDATE owner_epins SET assignedUserId=?, assignedAt=CURRENT_TIMESTAMP(3), updatedAt=CURRENT_TIMESTAMP(3)
         WHERE id=?`,
        [member.id, id],
      );
      return true;
    });
    if (changed) {
      await this.audit.log({
        actorUserId,
        action: AuditAction.UPDATE,
        entityType: 'OwnerEpin',
        entityId: id,
        description: 'Unused E-PIN reassigned',
        metadata: { assignedUserId: member.id },
      });
    }
    return { ok: true, assignedUserId: member.id, username: member.username };
  }

  async cancelUnusedEpin(id: string, dto: CancelUnusedEpinDto, actorUserId: string) {
    const refundAmount = this.nonNegativeMoney(dto.refundAmount, 'refundAmount');
    const cancelled = await this.db.transaction(async (connection) => {
      const rows = await connection.query<EpinRow[]>(
        `SELECT id, pinCiphertext, displaySuffix, status, assignedUserId, usedByUserId, seasonId,
                paymentSubmissionId, currencyCodeSnapshot, registrationFeeSnapshot,
                installmentAmountSnapshot, expiresAt, usedAt, assignedAt, cancelledAt,
                refundAmount, refundReference
         FROM owner_epins WHERE id=? LIMIT 1 FOR UPDATE`,
        [id],
      );
      const pin = rows[0];
      if (!pin) throw new NotFoundException('E-PIN not found');
      if (pin.status !== 'ACTIVE' || pin.usedByUserId) {
        throw new ConflictException('Only an unused E-PIN can be cancelled');
      }
      const maximumRefund = Number(pin.registrationFeeSnapshot ?? 0) + Number(pin.installmentAmountSnapshot ?? 0);
      if (refundAmount > maximumRefund) {
        throw new BadRequestException('Refund amount exceeds the E-PIN commercial value');
      }
      await connection.query(
        `UPDATE owner_epins
         SET status='CANCELLED', cancelledAt=CURRENT_TIMESTAMP(3), cancelledByUserId=?,
             cancellationReason=?, refundAmount=?, refundReference=?, updatedAt=CURRENT_TIMESTAMP(3)
         WHERE id=?`,
        [actorUserId, dto.reason.trim(), this.money(refundAmount), dto.refundReference.trim(), id],
      );
      if (pin.paymentSubmissionId) {
        await connection.query(
          `INSERT INTO member_payment_submission_events
           (id, submissionId, eventType, actorUserId, metadata)
           VALUES (?, ?, 'EPIN_CANCELLED_REFUND_RECORDED', ?, ?)`,
          [
            randomUUID(),
            pin.paymentSubmissionId,
            actorUserId,
            JSON.stringify({ epinId: id, refundAmount: this.money(refundAmount), refundReference: dto.refundReference.trim() }),
          ],
        );
      }
      return pin;
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerEpin',
      entityId: id,
      description: 'Unused E-PIN cancelled with refund adjustment trail',
      metadata: {
        refundAmount: this.money(refundAmount),
        refundReference: dto.refundReference.trim(),
        paymentSubmissionId: cancelled.paymentSubmissionId,
      },
    });
    return { ok: true };
  }

  async cancelMember(
    memberUserId: string,
    dto: CancelMemberEnrollmentDto,
    actorUserId: string,
  ) {
    const refundTarget = this.nonNegativeMoney(dto.refundAmount, 'refundAmount');
    const enrollment = await this.findEnrollment(memberUserId, true, true);
    const payments = await this.prisma.programPaymentRecord.findMany({
      where: { enrollmentId: enrollment.id },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      include: { refunds: true },
    });
    const refundable = payments.reduce(
      (sum, payment) =>
        sum +
        Number(payment.amount) -
        payment.refunds.reduce((refundSum, refund) => refundSum + Number(refund.amount), 0),
      0,
    );
    if (refundTarget > refundable + 0.0001) {
      throw new BadRequestException('Refund amount exceeds confirmed refundable payments');
    }

    let remaining = refundTarget;
    const refunds: Array<{ paymentRecordId: string; refundId: string; amount: string }> = [];
    for (const payment of payments) {
      if (remaining <= 0.0001) break;
      const alreadyRefunded = payment.refunds.reduce(
        (sum, refund) => sum + Number(refund.amount),
        0,
      );
      const available = Number(payment.amount) - alreadyRefunded;
      if (available <= 0) continue;
      const amount = Math.min(available, remaining);
      const sourceKey = `member-cancellation:${enrollment.id}:${payment.id}:${randomUUID()}`;
      const result = await this.programPayments.createRefund(
        {
          sourceKey,
          paymentRecordId: payment.id,
          amount: this.money(amount),
          currencyCode: payment.currencyCode,
          occurredAt: new Date().toISOString(),
          reason: dto.reason?.trim() || 'MEMBER_CANCELLATION',
          metadata: {
            ownerMemberCancellation: true,
            refundReference: dto.refundReference?.trim() || null,
          },
        },
        actorUserId,
      );
      refunds.push({
        paymentRecordId: payment.id,
        refundId: result.refund.id,
        amount: this.money(amount),
      });
      remaining -= amount;
    }
    if (remaining > 0.0001) {
      throw new ConflictException('Unable to allocate the requested refund amount');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.programEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'CANCELLED' },
      });
      await tx.user.update({
        where: { id: memberUserId },
        data: { status: 'SUSPENDED' },
      });
      await tx.$executeRawUnsafe(
        `UPDATE member_profiles
         SET lifecycleStatus='CANCELLED', cancelledAt=CURRENT_TIMESTAMP(3), cancellationReason=?
         WHERE userId=?`,
        dto.reason?.trim() || 'MEMBER_CANCELLATION',
        memberUserId,
      );
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'MemberCancellation',
      entityId: memberUserId,
      description: 'Member cancelled and excluded from paid-program eligibility',
      metadata: {
        enrollmentId: enrollment.id,
        refundAmount: this.money(refundTarget),
        refundReference: dto.refundReference?.trim() || null,
        refunds,
      },
    });
    return { ok: true, memberUserId, enrollmentId: enrollment.id, refunds };
  }

  async publicReceipt(token: string) {
    const rows = await this.rows<Record<string, unknown>>(
      `SELECT p.receiptNumber, p.purpose, p.amount, p.currencyCode, p.providerReference,
              p.status, p.details, p.submittedAt, p.reviewedAt,
              u.id AS memberId, u.username, u.firstName, u.lastName,
              s.code AS seasonCode, s.name AS seasonName
       FROM member_payment_submissions p
       JOIN users u ON u.id=p.requesterUserId
       JOIN owner_seasons s ON s.id=p.seasonId
       WHERE p.publicToken=? LIMIT 1`,
      [token],
    );
    if (!rows[0]) throw new NotFoundException('Receipt not found');
    return rows[0];
  }

  async adminReceipt(id: string) {
    const rows = await this.rows<Record<string, unknown>>(
      `SELECT p.*, u.username, u.firstName, u.lastName, s.code AS seasonCode, s.name AS seasonName,
              reviewer.username AS reviewedByUsername
       FROM member_payment_submissions p
       JOIN users u ON u.id=p.requesterUserId
       JOIN owner_seasons s ON s.id=p.seasonId
       LEFT JOIN users reviewer ON reviewer.id=p.reviewedByUserId
       WHERE p.id=? LIMIT 1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Payment submission not found');
    return rows[0];
  }

  private async createSubmission(input: {
    purpose: 'INSTALLMENT' | 'EPIN_PURCHASE';
    requesterUserId: string;
    seasonId: string;
    enrollmentId: string | null;
    epinQuantity: number | null;
    amount: number;
    currencyCode: string;
    providerReference: string;
    paymentProofDataUrl: string;
    details: Record<string, unknown>;
  }) {
    const id = randomUUID();
    const receiptNumber = this.receiptNumber();
    const publicToken = randomBytes(32).toString('hex');
    const providerReference = input.providerReference.trim();
    try {
      await this.db.transaction(async (connection) => {
        await connection.query(
          `INSERT INTO member_payment_submissions
           (id, receiptNumber, publicToken, purpose, requesterUserId, seasonId, enrollmentId,
            epinQuantity, amount, currencyCode, providerReference, paymentProofDataUrl, status, details)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_VERIFICATION', ?)`,
          [
            id,
            receiptNumber,
            publicToken,
            input.purpose,
            input.requesterUserId,
            input.seasonId,
            input.enrollmentId,
            input.epinQuantity,
            this.money(input.amount),
            input.currencyCode,
            providerReference,
            input.paymentProofDataUrl.trim(),
            JSON.stringify(input.details),
          ],
        );
        await connection.query(
          `INSERT INTO member_payment_submission_events
           (id, submissionId, eventType, actorUserId, metadata)
           VALUES (?, ?, 'SUBMITTED', ?, ?)`,
          [randomUUID(), id, input.requesterUserId, JSON.stringify({ purpose: input.purpose })],
        );
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw new ConflictException('This UTR / transaction reference has already been submitted');
      }
      throw error;
    }
    const rows = await this.rows<SubmissionRow>(
      'SELECT * FROM member_payment_submissions WHERE id=? LIMIT 1',
      [id],
    );
    return rows[0];
  }

  private async claimForReview(
    submissionId: string,
    actor: AuthUser,
    decision: 'APPROVE' | 'REJECT',
  ) {
    return this.db.transaction(async (connection) => {
      const rows = await connection.query<SubmissionRow[]>(
        'SELECT * FROM member_payment_submissions WHERE id=? LIMIT 1 FOR UPDATE',
        [submissionId],
      );
      const submission = rows[0];
      if (!submission) throw new NotFoundException('Payment submission not found');
      if (submission.status !== 'PENDING_VERIFICATION') {
        throw new ConflictException('Only a pending payment submission can be reviewed');
      }
      const superAdmin = actor.roles.includes('SUPER_ADMIN');
      if (!superAdmin) {
        throw new ForbiddenException('Payment verification is restricted to SUPER_ADMIN');
      }
      await connection.query(
        `UPDATE member_payment_submissions
         SET status='PROCESSING', reviewedByUserId=?, reviewedAt=CURRENT_TIMESTAMP(3)
         WHERE id=?`,
        [actor.id, submissionId],
      );
      await connection.query(
        `INSERT INTO member_payment_submission_events
         (id, submissionId, eventType, actorUserId, metadata)
         VALUES (?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          submissionId,
          decision === 'APPROVE' ? 'VERIFICATION_STARTED' : 'REJECTION_STARTED',
          actor.id,
          JSON.stringify({ decision }),
        ],
      );
      return submission;
    });
  }

  private async rejectSubmission(submission: SubmissionRow, actorUserId: string, note?: string) {
    await this.db.transaction(async (connection) => {
      await connection.query(
        `UPDATE member_payment_submissions
         SET status='REJECTED', reviewNote=?, reviewedByUserId=?, reviewedAt=CURRENT_TIMESTAMP(3)
         WHERE id=? AND status='PROCESSING'`,
        [note?.trim() || null, actorUserId, submission.id],
      );
      await connection.query(
        `INSERT INTO member_payment_submission_events
         (id, submissionId, eventType, actorUserId, metadata)
         VALUES (?, ?, 'REJECTED', ?, ?)`,
        [randomUUID(), submission.id, actorUserId, JSON.stringify({ note: note?.trim() || null })],
      );
    });
  }

  private async approveInstallment(submission: SubmissionRow, actorUserId: string) {
    if (!submission.enrollmentId) throw new ConflictException('Installment submission has no enrollment');
    const enrollment = await this.prisma.programEnrollment.findUnique({
      where: { id: submission.enrollmentId },
    });
    if (!enrollment || !['ACTIVE', 'COMPLETED'].includes(enrollment.status)) {
      throw new ConflictException('Enrollment is not available for installment payment');
    }
    if (enrollment.status === 'COMPLETED') {
      throw new ConflictException('Enrollment is already fully paid');
    }
    const sourceKey = `member-payment-submission:${submission.id}`;
    const { attempt } = await this.programPayments.createAttempt(
      {
        sourceKey,
        enrollmentId: submission.enrollmentId,
        amount: String(submission.amount),
        currencyCode: submission.currencyCode,
        initiatedAt: new Date(submission.submittedAt).toISOString(),
        provider: 'UPI_MANUAL',
        providerReference: submission.providerReference,
        metadata: { memberPaymentSubmissionId: submission.id, purpose: 'INSTALLMENT' },
      },
      actorUserId,
    );
    const result = await this.programPayments.confirmAttempt(
      attempt.id,
      {
        sourceKey: `${sourceKey}:confirmed`,
        occurredAt: new Date().toISOString(),
        metadata: { memberPaymentSubmissionId: submission.id, verifiedBySuperAdmin: true },
      },
      actorUserId,
    );
    await this.db.transaction(async (connection) => {
      await connection.query(
        `UPDATE member_payment_submissions
         SET status='CONFIRMED', programPaymentAttemptId=?, programPaymentRecordId=?,
             reviewedByUserId=?, reviewedAt=CURRENT_TIMESTAMP(3)
         WHERE id=? AND status='PROCESSING'`,
        [attempt.id, result.payment.id, actorUserId, submission.id],
      );
      await connection.query(
        `INSERT INTO member_payment_submission_events
         (id, submissionId, eventType, actorUserId, metadata)
         VALUES (?, ?, 'CONFIRMED', ?, ?)`,
        [
          randomUUID(),
          submission.id,
          actorUserId,
          JSON.stringify({ paymentAttemptId: attempt.id, paymentRecordId: result.payment.id }),
        ],
      );
    });
  }

  private async approveEpinPurchase(submission: SubmissionRow, actorUserId: string) {
    const quantity = Number(submission.epinQuantity ?? 0);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new ConflictException('E-PIN purchase quantity is invalid');
    }
    const season = await this.requireOpenSeason(submission.seasonId);
    const expected =
      quantity * (Number(season.registrationFee) + Number(season.installmentAmount));
    if (Math.abs(expected - Number(submission.amount)) > 0.001) {
      throw new ConflictException('E-PIN purchase amount no longer matches the submitted commercial snapshot');
    }
    const expiresAt = await this.resolveRegistrationClose(season);
    const generated = await this.db.transaction(async (connection) => {
      const currentRows = await connection.query<SubmissionRow[]>(
        'SELECT * FROM member_payment_submissions WHERE id=? LIMIT 1 FOR UPDATE',
        [submission.id],
      );
      if (currentRows[0]?.status !== 'PROCESSING') {
        throw new ConflictException('Payment submission is no longer being processed');
      }
      const pins: Array<{ id: string; pin: string; expiresAt: Date }> = [];
      for (let index = 0; index < quantity; index += 1) {
        const id = randomUUID();
        const raw = this.readablePin();
        await connection.query(
          `INSERT INTO owner_epins
           (id, pinHash, displaySuffix, paymentSubmissionId, pinCiphertext, seasonId,
            currencyCodeSnapshot, registrationFeeSnapshot, installmentAmountSnapshot,
            assignedUserId, assignedAt, status, expiresAt, createdByUserId)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), 'ACTIVE', ?, ?)`,
          [
            id,
            this.epinHash(raw),
            raw.slice(-6),
            submission.id,
            this.encryptPin(raw),
            season.id,
            season.currencyCode,
            this.money(Number(season.registrationFee)),
            this.money(Number(season.installmentAmount)),
            submission.requesterUserId,
            expiresAt,
            actorUserId,
          ],
        );
        pins.push({ id, pin: raw, expiresAt });
      }
      await connection.query(
        `UPDATE member_payment_submissions
         SET status='CONFIRMED', reviewedByUserId=?, reviewedAt=CURRENT_TIMESTAMP(3)
         WHERE id=?`,
        [actorUserId, submission.id],
      );
      await connection.query(
        `INSERT INTO member_payment_submission_events
         (id, submissionId, eventType, actorUserId, metadata)
         VALUES (?, ?, 'CONFIRMED', ?, ?)`,
        [
          randomUUID(),
          submission.id,
          actorUserId,
          JSON.stringify({ generatedEpinIds: pins.map((pin) => pin.id), quantity }),
        ],
      );
      return pins;
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'OwnerEpinBatch',
      entityId: submission.id,
      description: 'Paid E-PIN purchase verified and assigned to requesting member',
      metadata: {
        memberUserId: submission.requesterUserId,
        seasonId: submission.seasonId,
        quantity,
        generatedEpinIds: generated.map((pin) => pin.id),
      },
    });
  }

  private findEnrollment(
    userId: string,
    required: true,
    includeCompleted?: boolean,
  ): Promise<EnrollmentRow>;
  private findEnrollment(
    userId: string,
    required: false,
    includeCompleted?: boolean,
  ): Promise<EnrollmentRow | null>;
  private async findEnrollment(
    userId: string,
    required: boolean,
    includeCompleted = false,
  ): Promise<EnrollmentRow | null> {
    const statuses = includeCompleted ? "('ACTIVE','COMPLETED')" : "('ACTIVE')";
    const rows = await this.rows<EnrollmentRow>(
      `SELECT e.id, e.status, e.programVersionId, e.currencyCode, e.registrationFeeSnapshot,
              e.installmentAmountSnapshot, e.installmentCountSnapshot,
              s.id AS seasonId, s.code AS seasonCode, s.name AS seasonName
       FROM program_enrollments e
       JOIN owner_seasons s ON s.programVersionId=e.programVersionId
       WHERE e.userId=? AND e.status IN ${statuses}
       ORDER BY e.enrolledAt DESC LIMIT 1`,
      [userId],
    );
    if (!rows[0] && required) throw new NotFoundException('No active session enrollment was found');
    return rows[0] ?? null;
  }

  private async installmentSummary(enrollment: EnrollmentRow) {
    const installments = await this.rows<InstallmentRow>(
      `SELECT i.id, i.sequence, i.amount,
              COALESCE(SUM(a.amount - COALESCE(ra.refunded, 0)), 0) AS paid
       FROM program_installments i
       LEFT JOIN program_payment_allocations a
         ON a.installmentId=i.id AND a.allocationType='INSTALLMENT'
       LEFT JOIN (
         SELECT paymentAllocationId, SUM(amount) AS refunded
         FROM program_refund_allocations GROUP BY paymentAllocationId
       ) ra ON ra.paymentAllocationId=a.id
       WHERE i.enrollmentId=?
       GROUP BY i.id, i.sequence, i.amount
       ORDER BY i.sequence ASC`,
      [enrollment.id],
    );
    const normalized = installments.map((item) => ({
      sequence: Number(item.sequence),
      amount: Number(item.amount),
      paid: Number(item.paid ?? 0),
      complete: Number(item.paid ?? 0) + 0.0001 >= Number(item.amount),
    }));
    const paidInstallmentCount = normalized.filter((item) => item.complete).length;
    const remaining = normalized.filter((item) => !item.complete);
    return {
      enrollmentId: enrollment.id,
      seasonId: enrollment.seasonId,
      seasonCode: enrollment.seasonCode,
      seasonName: enrollment.seasonName,
      currencyCode: enrollment.currencyCode,
      installmentAmount: enrollment.installmentAmountSnapshot,
      installmentCount: Number(enrollment.installmentCountSnapshot),
      paidInstallmentCount,
      remainingInstallmentCount: remaining.length,
      nextUnpaidSequence: remaining[0]?.sequence ?? null,
      fullyPaid: remaining.length === 0,
    };
  }

  private async requireOpenSeason(seasonId: string) {
    const rows = await this.rows<SeasonCommercialRow>(
      `SELECT s.id, s.code, s.name, s.status, s.startDate, s.endDate, s.registrationClosesAt,
              s.programVersionId, pv.currencyCode, pv.registrationFee, pv.installmentAmount,
              pv.installmentCount, pv.lifecycle, pv.effectiveFrom, pv.effectiveTo
       FROM owner_seasons s
       JOIN program_versions pv ON pv.id=s.programVersionId
       WHERE s.id=? LIMIT 1`,
      [seasonId],
    );
    const season = rows[0];
    if (!season) throw new NotFoundException('Session not found');
    if (season.status !== 'ACTIVE' || season.lifecycle !== 'PUBLISHED') {
      throw new ConflictException('Session is not open for paid joining');
    }
    const close = await this.resolveRegistrationClose(season, false);
    if (close && close.getTime() <= Date.now()) {
      throw new ConflictException('Session registration is closed');
    }
    return season;
  }

  private resolveRegistrationClose(
    season: SeasonCommercialRow,
    required?: true,
  ): Promise<Date>;
  private resolveRegistrationClose(
    season: SeasonCommercialRow,
    required: false,
  ): Promise<Date | null>;
  private async resolveRegistrationClose(
    season: SeasonCommercialRow,
    required = true,
  ): Promise<Date | null> {
    if (season.registrationClosesAt) return new Date(season.registrationClosesAt);
    const drawRows = await this.rows<{ drawAt: Date }>(
      `SELECT ldi.drawAt
       FROM owner_draw_runs odr
       JOIN lucky_draw_instances ldi ON ldi.id=odr.drawId
       WHERE odr.seasonId=? AND odr.monthNumber=? LIMIT 1`,
      [season.id, Number(season.installmentCount)],
    );
    if (drawRows[0]?.drawAt) return new Date(drawRows[0].drawAt);
    if (season.endDate) {
      const close = new Date(season.endDate);
      close.setUTCHours(23, 59, 59, 999);
      return close;
    }
    if (season.effectiveTo) return new Date(season.effectiveTo);
    if (required) {
      throw new ConflictException(
        'Session registration close is not configured; set the session end/registration boundary first',
      );
    }
    return null;
  }

  private async resolveActiveMember(reference: string) {
    const value = reference.trim();
    const rows = await this.rows<{ id: string; username: string }>(
      `SELECT u.id, u.username
       FROM users u
       WHERE u.status='ACTIVE'
         AND (u.id=? OR u.username=? OR LOWER(u.email)=LOWER(?) OR u.phone=?)
         AND EXISTS (
           SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.roleId
           WHERE ur.userId=u.id AND r.name='MEMBER' AND r.status='ACTIVE'
         )
       LIMIT 1`,
      [value, value, value, value],
    );
    if (!rows[0]) throw new NotFoundException('Active MEMBER was not found');
    return rows[0];
  }

  private async requirePaymentRail() {
    const settings = await this.paymentSettings();
    if (!this.truthy(settings.enabled) || !settings.upiId || !settings.qrImageDataUrl) {
      throw new ConflictException('QR / UPI payment is not currently available');
    }
    return settings;
  }

  private receiptEnvelope(row: Partial<SubmissionRow> & Record<string, unknown>) {
    return {
      ...row,
      receiptUrl: row.publicToken ? `/receipts/${String(row.publicToken)}` : null,
      receiptType:
        row.status === 'PENDING_VERIFICATION' || row.status === 'PROCESSING'
          ? 'PROVISIONAL'
          : row.status === 'CONFIRMED'
            ? 'FINAL'
            : 'REJECTED',
    };
  }

  private receiptNumber() {
    const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    return `MGC-${day}-${randomBytes(5).toString('hex').toUpperCase()}`;
  }

  private readablePin() {
    return `MGC-PIN-${randomBytes(9).toString('base64url').toUpperCase()}`;
  }

  private epinHash(raw: string) {
    return createHmac('sha256', this.config.getOrThrow<string>('CAPTCHA_HMAC_SECRET'))
      .update(`owner-portal:epin:${raw.trim()}`)
      .digest('hex');
  }

  private encryptionKey() {
    return createHash('sha256')
      .update(`owner-portal:epin:cipher:${this.config.getOrThrow<string>('CAPTCHA_HMAC_SECRET')}`)
      .digest();
  }

  private encryptPin(raw: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
  }

  private decryptPin(payload: string) {
    try {
      const [ivRaw, tagRaw, encryptedRaw] = payload.split('.');
      if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error('invalid payload');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey(),
        Buffer.from(ivRaw, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(encryptedRaw, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new ConflictException('E-PIN secret cannot be decrypted with the current server key');
    }
  }

  private validatePaymentProof(value?: string, optional = false) {
    const proof = value?.trim();
    if (!proof) {
      if (optional) return;
      throw new BadRequestException('Payment screenshot is required');
    }
    if (!proof.startsWith('data:image/') && !proof.startsWith('https://')) {
      throw new BadRequestException('Payment screenshot must be an image data URL or HTTPS URL');
    }
    if (proof.length > 120_000) {
      throw new BadRequestException('Payment screenshot is too large; upload a compressed screenshot');
    }
  }

  private positiveMoney(raw: string, field: string) {
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(Math.round(amount * 100) - amount * 100) > 1e-8) {
      throw new BadRequestException(`${field} must be a positive amount with at most 2 decimals`);
    }
    return amount;
  }

  private nonNegativeMoney(raw: string, field: string) {
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0 || Math.abs(Math.round(amount * 100) - amount * 100) > 1e-8) {
      throw new BadRequestException(`${field} must be a non-negative amount with at most 2 decimals`);
    }
    return amount;
  }

  private money(value: number) {
    return value.toFixed(2);
  }

  private truthy(value: boolean | number) {
    return value === true || value === 1;
  }

  private async rows<T>(sql: string, values: SqlValue[] = []) {
    return this.prisma.$queryRawUnsafe<T[]>(sql, ...values);
  }
}
