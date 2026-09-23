import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  AuditAction,
  PolicyLifecycle,
  ProgramBusinessEventType,
  ProgramEnrollmentStatus,
  ProgramIntervalUnit,
} from '../generated/prisma/enums';
import type { CreateProgramEnrollmentDto } from './program.dto';
import { ProgramEligibilityService } from './program-eligibility.service';

@Injectable()
export class ProgramEnrollmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly eligibility: ProgramEligibilityService,
  ) {}

  async createEnrollment(dto: CreateProgramEnrollmentDto, actorUserId: string) {
    const enrolledAt = new Date(dto.enrolledAt);
    if (!Number.isFinite(enrolledAt.getTime())) {
      throw new BadRequestException('enrolledAt must be a valid date');
    }
    this.parseDateOnly(dto.enrollmentDate);
    const fingerprint = this.fingerprint(dto, enrolledAt);

    const existing = await this.prisma.programEnrollment.findUnique({
      where: { sourceKey: dto.sourceKey },
    });
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new ConflictException('Enrollment source key already exists with a different payload');
      }
      return { enrollment: await this.getEnrollment(existing.id), idempotent: true };
    }

    const [user, version] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: dto.userId },
        select: {
          id: true,
          username: true,
          status: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
        },
      }),
      this.prisma.programVersion.findUnique({
        where: { id: dto.programVersionId },
        include: { program: true },
      }),
    ]);
    if (!user) throw new NotFoundException('Enrollment user not found');
    if (!version) throw new NotFoundException('Program version not found');
    if (version.lifecycle !== PolicyLifecycle.PUBLISHED) {
      throw new ConflictException('Enrollment requires a published program version');
    }
    if (
      version.effectiveFrom > enrolledAt ||
      (version.effectiveTo !== null && version.effectiveTo < enrolledAt)
    ) {
      throw new ConflictException('Program version is not effective at enrollment time');
    }

    const evaluation = this.eligibility.evaluate(version.eligibilityRules, user);
    if (!evaluation.eligible) {
      throw new ConflictException({
        message: 'User is not eligible for this program version',
        eligibility: evaluation,
      });
    }

    if (version.maxActiveEnrollmentsPerUser !== null) {
      const activeCount = await this.prisma.programEnrollment.count({
        where: {
          userId: user.id,
          status: ProgramEnrollmentStatus.ACTIVE,
          programVersion: { programId: version.programId },
        },
      });
      if (activeCount >= version.maxActiveEnrollmentsPerUser) {
        throw new ConflictException('Maximum active enrollments for this program reached');
      }
    }

    const installments = this.buildInstallments(
      dto.enrollmentDate,
      version.installmentCount,
      version.installmentAmount,
      version.firstInstallmentOffsetDays,
      version.installmentIntervalUnit,
      version.installmentIntervalCount,
    );
    const totalDue = version.registrationFee.plus(
      version.installmentAmount.mul(version.installmentCount),
    );
    const initialStatus = totalDue.equals(0)
      ? ProgramEnrollmentStatus.COMPLETED
      : ProgramEnrollmentStatus.ACTIVE;
    const enrollmentId = randomUUID();

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.programEnrollment.create({
          data: {
            id: enrollmentId,
            sourceKey: dto.sourceKey,
            requestFingerprint: fingerprint,
            userId: user.id,
            programVersionId: version.id,
            enrolledAt,
            enrollmentDate: dto.enrollmentDate,
            status: initialStatus,
            eligibilitySnapshot: evaluation as unknown as Prisma.InputJsonValue,
            currencyCode: version.currencyCode,
            registrationFeeSnapshot: version.registrationFee,
            installmentAmountSnapshot: version.installmentAmount,
            installmentCountSnapshot: version.installmentCount,
            gracePeriodDaysSnapshot: version.gracePeriodDays,
            metadata: dto.metadata as Prisma.InputJsonValue | undefined,
            createdByUserId: actorUserId,
          },
        });
        if (installments.length > 0) {
          await tx.programInstallment.createMany({
            data: installments.map((installment) => ({
              id: randomUUID(),
              enrollmentId,
              sequence: installment.sequence,
              dueDate: installment.dueDate,
              amount: installment.amount,
              createdAt: new Date(),
            })),
          });
        }
        await tx.programBusinessEvent.create({
          data: {
            sourceKey: `PROGRAM_ENROLLMENT:${enrollmentId}:CREATED`,
            type: ProgramBusinessEventType.ENROLLMENT_CREATED,
            enrollmentId,
            occurredAt: enrolledAt,
            payload: {
              programId: version.programId,
              programVersionId: version.id,
              userId: user.id,
              enrollmentDate: dto.enrollmentDate,
            },
          },
        });
        if (initialStatus === ProgramEnrollmentStatus.COMPLETED) {
          await tx.programBusinessEvent.create({
            data: {
              sourceKey: `PROGRAM_ENROLLMENT:${enrollmentId}:COMPLETED:INITIAL`,
              type: ProgramBusinessEventType.ENROLLMENT_COMPLETED,
              enrollmentId,
              occurredAt: enrolledAt,
              payload: { reason: 'NO_AMOUNT_DUE' },
            },
          });
        }
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        const raced = await this.prisma.programEnrollment.findUnique({
          where: { sourceKey: dto.sourceKey },
        });
        if (raced && raced.requestFingerprint === fingerprint) {
          return { enrollment: await this.getEnrollment(raced.id), idempotent: true };
        }
        throw new ConflictException('Enrollment source key already exists');
      }
      throw error;
    }

    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'ProgramEnrollment',
      entityId: enrollmentId,
      description: 'Program enrollment created',
      metadata: {
        userId: user.id,
        programVersionId: version.id,
        installmentCount: version.installmentCount,
      },
    });
    return { enrollment: await this.getEnrollment(enrollmentId), idempotent: false };
  }

  async getEnrollment(id: string) {
    const enrollment = await this.prisma.programEnrollment.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true } },
        programVersion: { include: { program: true } },
        installments: { orderBy: { sequence: 'asc' } },
        paymentAllocations: {
          include: { refundAllocations: true },
          orderBy: { createdAt: 'asc' },
        },
        payments: { orderBy: { occurredAt: 'asc' } },
        refunds: { orderBy: { occurredAt: 'asc' } },
        businessEvents: { orderBy: { occurredAt: 'asc' } },
      },
    });
    if (!enrollment) throw new NotFoundException('Program enrollment not found');

    const registration = this.allocationSummary(
      enrollment.paymentAllocations.filter(
        (allocation) => allocation.allocationType === 'REGISTRATION_FEE',
      ),
      enrollment.registrationFeeSnapshot,
    );
    const installmentSummaries = enrollment.installments.map((installment) => {
      const summary = this.allocationSummary(
        enrollment.paymentAllocations.filter(
          (allocation) => allocation.installmentId === installment.id,
        ),
        installment.amount,
      );
      const overdueDate = this.addDays(installment.dueDate, enrollment.gracePeriodDaysSnapshot);
      const today = new Date().toISOString().slice(0, 10);
      const status = summary.outstanding.equals(0)
        ? 'PAID'
        : summary.netPaid.greaterThan(0)
          ? 'PARTIALLY_PAID'
          : today > overdueDate
            ? 'OVERDUE'
            : 'PENDING';
      return { ...installment, ...summary, status, overdueAfter: overdueDate };
    });
    const unapplied = enrollment.paymentAllocations
      .filter((allocation) => allocation.allocationType === 'UNAPPLIED')
      .reduce((sum, allocation) => {
        const refunded = allocation.refundAllocations.reduce(
          (refundSum, refund) => refundSum.plus(refund.amount),
          new Prisma.Decimal(0),
        );
        return sum.plus(allocation.amount.minus(refunded));
      }, new Prisma.Decimal(0));
    const outstanding = installmentSummaries.reduce(
      (sum, installment) => sum.plus(installment.outstanding),
      registration.outstanding,
    );

    return {
      ...enrollment,
      financials: {
        registration,
        installments: installmentSummaries,
        unapplied,
        outstanding,
      },
    };
  }

  async listUserEnrollments(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const enrollments = await this.prisma.programEnrollment.findMany({
      where: { userId },
      orderBy: { enrolledAt: 'desc' },
      include: { programVersion: { include: { program: true } } },
    });
    return { user, enrollments };
  }

  private allocationSummary(
    allocations: Array<{
      amount: Prisma.Decimal;
      refundAllocations: Array<{ amount: Prisma.Decimal }>;
    }>,
    due: Prisma.Decimal,
  ) {
    const grossPaid = allocations.reduce(
      (sum, allocation) => sum.plus(allocation.amount),
      new Prisma.Decimal(0),
    );
    const refunded = allocations.reduce(
      (sum, allocation) =>
        sum.plus(
          allocation.refundAllocations.reduce(
            (refundSum, refund) => refundSum.plus(refund.amount),
            new Prisma.Decimal(0),
          ),
        ),
      new Prisma.Decimal(0),
    );
    const netPaid = grossPaid.minus(refunded);
    return {
      due,
      grossPaid,
      refunded,
      netPaid,
      outstanding: Prisma.Decimal.max(due.minus(netPaid), new Prisma.Decimal(0)),
    };
  }

  private buildInstallments(
    enrollmentDate: string,
    count: number,
    amount: Prisma.Decimal,
    firstOffsetDays: number,
    unit: ProgramIntervalUnit,
    intervalCount: number,
  ) {
    if (count === 0) return [];
    const firstDueDate = this.addDays(enrollmentDate, firstOffsetDays);
    return Array.from({ length: count }, (_, index) => ({
      sequence: index + 1,
      dueDate: this.addInterval(firstDueDate, unit, intervalCount * index),
      amount,
    }));
  }

  private addInterval(baseDate: string, unit: ProgramIntervalUnit, count: number): string {
    if (unit === ProgramIntervalUnit.DAY) return this.addDays(baseDate, count);
    if (unit === ProgramIntervalUnit.WEEK) return this.addDays(baseDate, count * 7);
    const base = this.parseDateOnly(baseDate);
    const anchorDay = base.getUTCDate();
    const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
    target.setUTCMonth(target.getUTCMonth() + count);
    const lastDay = new Date(
      Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
    ).getUTCDate();
    target.setUTCDate(Math.min(anchorDay, lastDay));
    return target.toISOString().slice(0, 10);
  }

  private addDays(baseDate: string, days: number): string {
    const date = this.parseDateOnly(baseDate);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  private parseDateOnly(raw: string): Date {
    const date = new Date(`${raw}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
      throw new BadRequestException('enrollmentDate must be a valid YYYY-MM-DD date');
    }
    return date;
  }

  private fingerprint(dto: CreateProgramEnrollmentDto, enrolledAt: Date): string {
    return createHash('sha256')
      .update(`${dto.userId}|${dto.programVersionId}|${enrolledAt.toISOString()}|${dto.enrollmentDate}`)
      .digest('hex');
  }
}
