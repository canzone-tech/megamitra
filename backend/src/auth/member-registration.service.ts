import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { CaptchaService } from '../captcha/captcha.service';
import { PrismaService } from '../database/prisma.service';
import { GenealogyService } from '../genealogy/genealogy.service';
import { LuckyDrawTokenService } from '../lucky-draw/lucky-draw-token.service';
import {
  AuditAction,
  PasswordCreationMode,
  RoleStatus,
  UserIdentifierType,
  UserStatus,
  UsernameCreationMode,
} from '../generated/prisma/enums';
import { ReferralRewardService } from '../referral-reward/referral-reward.service';
import type { RegisterDto } from './auth.dto';
import { AuthRecoveryService } from './auth-recovery.service';
import { PasswordService } from './password.service';

type SponsorLookupRow = {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
};

type EpinRow = {
  id: string;
  status: string;
  assignedUserId: string | null;
  expiresAt: Date;
  seasonId: string | null;
  paymentSubmissionId: string | null;
  currencyCodeSnapshot: string | null;
  registrationFeeSnapshot: string | null;
  installmentAmountSnapshot: string | null;
  seasonStatus: string | null;
  seasonStartDate: Date | string | null;
  programVersionId: string | null;
  referralPolicyVersionId: string | null;
  programLifecycle: string | null;
  programCurrencyCode: string | null;
  installmentCount: number | null;
  installmentIntervalUnit: string | null;
  installmentIntervalCount: number | null;
  firstInstallmentOffsetDays: number | null;
  gracePeriodDays: number | null;
  eligibilityRules: unknown;
};

type ActivationResult = {
  enrollmentId: string;
  paymentRecordId: string;
  seasonId: string;
  referralPolicyVersionId: string | null;
  currencyCode: string;
  paidAmount: string;
  epinId: string;
  seasonStartDate: string;
};

@Injectable()
export class MemberRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly captcha: CaptchaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly recovery: AuthRecoveryService,
    private readonly genealogy: GenealogyService,
    private readonly referralRewards: ReferralRewardService,
    private readonly drawTokens: LuckyDrawTokenService,
  ) {}

  async registrationConfig() {
    const [registration, auth, security] = await Promise.all([
      this.prisma.systemRegistrationConfig.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.systemAuthConfig.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.systemSecurityConfig.findUniqueOrThrow({ where: { id: 1 } }),
    ]);
    return {
      publicRegistrationEnabled: registration.publicRegistrationEnabled,
      captchaOnRegistrationEnabled: auth.captchaOnRegistrationEnabled,
      emailRequired: registration.emailRequired,
      mobileRequired: registration.mobileRequired,
      passwordMode: registration.passwordMode,
      usernameMode: registration.usernameMode,
      usernamePrefixEnabled: registration.usernamePrefixEnabled,
      usernamePrefix: registration.usernamePrefix,
      passwordMinLength: security.passwordMinLength,
      passwordMaxLength: security.passwordMaxLength,
      epinRequired: true,
      sponsorRequired: true,
      sponsorLookupEnabled: true,
      accountRole: 'MEMBER',
      paidActivation: {
        registrationFeeAndFirstInstallmentFromEpin: true,
        sessionBound: true,
      },
    };
  }

  async sponsor(reference: string) {
    const value = reference.trim();
    if (value.length < 3) {
      throw new BadRequestException('Enter at least 3 characters to find a sponsor');
    }
    const rows = await this.prisma.$queryRawUnsafe<SponsorLookupRow[]>(
      `SELECT u.id, u.username, u.firstName, u.lastName, u.status
       FROM users u
       WHERE u.status='ACTIVE'
         AND EXISTS (
           SELECT 1
           FROM user_roles ur
           INNER JOIN roles r ON r.id=ur.roleId
           WHERE ur.userId=u.id AND r.name='MEMBER' AND r.status='ACTIVE'
         )
         AND EXISTS (
           SELECT 1 FROM member_profiles mp
           WHERE mp.userId=u.id AND COALESCE(mp.lifecycleStatus, 'ACTIVE')='ACTIVE'
         )
         AND (u.id=? OR u.username=? OR LOWER(u.email)=LOWER(?) OR u.phone=?)
       LIMIT 1`,
      value,
      value,
      value,
      value,
    );
    const sponsor = rows[0];
    if (!sponsor) throw new NotFoundException('Sponsor was not found');
    const fullName = [sponsor.firstName, sponsor.lastName].filter(Boolean).join(' ').trim();
    return {
      id: sponsor.id,
      username: sponsor.username,
      fullName: fullName || sponsor.username,
      role: 'MEMBER',
      status: sponsor.status,
    };
  }

  async register(dto: RegisterDto) {
    const [registration, auth, security] = await Promise.all([
      this.prisma.systemRegistrationConfig.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.systemAuthConfig.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.systemSecurityConfig.findUniqueOrThrow({ where: { id: 1 } }),
    ]);
    if (!registration.publicRegistrationEnabled) {
      throw new ForbiddenException('Public registration is disabled');
    }
    if (
      auth.captchaOnRegistrationEnabled &&
      !(await this.captcha.verify(dto.captchaId, dto.captchaAnswer))
    ) {
      throw new BadRequestException('Registration security check is required or invalid');
    }

    const rawEpin = dto.epin.trim();
    if (!rawEpin) throw new BadRequestException('E-PIN is required');
    if (!dto.sponsorReference?.trim()) {
      throw new BadRequestException('Sponsor is required for member registration');
    }
    const email = dto.email?.trim().toLowerCase() || null;
    const phone = dto.phone?.trim() || null;
    if (registration.emailRequired && !email) throw new BadRequestException('Email is required');
    if (registration.mobileRequired && !phone) throw new BadRequestException('Mobile is required');
    if (registration.usernameMode === UsernameCreationMode.MANUAL && !dto.username?.trim()) {
      throw new BadRequestException('Username is required');
    }

    const generatedPassword =
      registration.passwordMode === PasswordCreationMode.AUTO ||
      (registration.passwordMode === PasswordCreationMode.AUTO_OR_MANUAL && !dto.password);
    const password = generatedPassword ? randomBytes(18).toString('base64url') : dto.password;
    if (!password) throw new BadRequestException('Password is required');
    const passwordLength = Array.from(password).length;
    if (passwordLength < security.passwordMinLength || passwordLength > security.passwordMaxLength) {
      throw new BadRequestException(
        `Password length must be between ${security.passwordMinLength} and ${security.passwordMaxLength} characters`,
      );
    }
    const passwordHash = await this.passwords.hash(password);

    const sponsor = await this.requireSponsor(dto.sponsorReference);
    const nameParts = dto.fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
    const firstName = nameParts.length ? nameParts[0] : dto.firstName?.trim() || null;
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : dto.lastName?.trim() || null;
    const epinHash = this.epinHash(rawEpin);
    const activationAt = new Date();

    try {
      const registered = await this.prisma.$transaction(async (tx) => {
        const epins = await tx.$queryRawUnsafe<EpinRow[]>(
          `SELECT e.id, e.status, e.assignedUserId, e.expiresAt, e.seasonId,
                  e.paymentSubmissionId, e.currencyCodeSnapshot, e.registrationFeeSnapshot,
                  e.installmentAmountSnapshot, s.status AS seasonStatus,
                  s.startDate AS seasonStartDate, s.programVersionId, s.referralPolicyVersionId,
                  pv.lifecycle AS programLifecycle, pv.currencyCode AS programCurrencyCode,
                  pv.installmentCount, pv.installmentIntervalUnit, pv.installmentIntervalCount,
                  pv.firstInstallmentOffsetDays, pv.gracePeriodDays, pv.eligibilityRules
           FROM owner_epins e
           LEFT JOIN owner_seasons s ON s.id=e.seasonId
           LEFT JOIN program_versions pv ON pv.id=s.programVersionId
           WHERE e.pinHash=?
           LIMIT 1
           FOR UPDATE`,
          epinHash,
        );
        const epin = epins[0];
        this.assertPaidEpin(epin, activationAt);

        let username = dto.username?.trim();
        const mustAutoUsername =
          registration.usernameMode === UsernameCreationMode.AUTO ||
          (registration.usernameMode === UsernameCreationMode.AUTO_OR_MANUAL && !username);
        if (mustAutoUsername) {
          const sequence = await tx.systemSequence.update({
            where: { key: 'username' },
            data: { nextValue: { increment: 1 } },
            select: { nextValue: true },
          });
          username = `${registration.usernamePrefixEnabled ? (registration.usernamePrefix ?? '') : ''}${sequence.nextValue.toString()}`;
        }
        if (!username) throw new BadRequestException('Username is required');

        const defaultRole = await tx.role.findUnique({ where: { name: 'MEMBER' } });
        if (!defaultRole || defaultRole.status !== RoleStatus.ACTIVE) {
          throw new BadRequestException('MEMBER registration role is unavailable');
        }

        const created = await tx.user.create({
          data: {
            username,
            email,
            phone,
            passwordHash,
            firstName,
            lastName,
            status: UserStatus.ACTIVE,
            mustChangePassword: generatedPassword,
          },
        });
        await tx.userRole.create({ data: { userId: created.id, roleId: defaultRole.id } });
        if (email && !registration.allowMultipleAccountsPerEmail) {
          await tx.userIdentifierClaim.create({
            data: { userId: created.id, type: UserIdentifierType.EMAIL, normalizedValue: email },
          });
        }
        if (phone && !registration.allowMultipleAccountsPerMobile) {
          await tx.userIdentifierClaim.create({
            data: { userId: created.id, type: UserIdentifierType.MOBILE, normalizedValue: phone },
          });
        }

        await tx.$executeRawUnsafe(
          `INSERT INTO member_profiles (userId, dateOfBirth, state, city, memberType, lifecycleStatus)
           VALUES (?, ?, ?, ?, 'MEMBER', 'ACTIVE')`,
          created.id,
          dto.dateOfBirth ? new Date(`${dto.dateOfBirth}T00:00:00.000Z`) : null,
          dto.state?.trim() || null,
          dto.city?.trim() || null,
        );
        await tx.sponsorRelationship.create({
          data: {
            memberUserId: created.id,
            sponsorUserId: sponsor.id,
            createdByUserId: created.id,
          },
        });

        const activation = await this.createPaidEnrollment(tx, created.id, epin!, activationAt);
        const consumed = await tx.$executeRawUnsafe(
          `UPDATE owner_epins
           SET status='USED', usedByUserId=?, usedAt=?, updatedAt=CURRENT_TIMESTAMP(3)
           WHERE id=? AND status='ACTIVE' AND usedByUserId IS NULL AND expiresAt>?`,
          created.id,
          activationAt,
          epin!.id,
          activationAt,
        );
        if (consumed !== 1) throw new ConflictException('E-PIN was already used during registration');
        return { user: created, activation };
      });

      const placement = await this.autoPlaceWithRetry(registered.user.id, sponsor.id);
      let installmentDrawTokens: Array<{
        token: string;
        installmentSequence: number | null;
        status: string;
        drawId: string | null;
        entryId: string | null;
      }> = [];
      try {
        installmentDrawTokens = await this.drawTokens.ensurePaymentRecordInstallmentTokens(
          registered.activation.paymentRecordId,
        );
      } catch (error) {
        await this.audit.log({
          actorUserId: registered.user.id,
          action: AuditAction.UPDATE,
          entityType: 'ProgramEnrollment',
          entityId: registered.activation.enrollmentId,
          description: 'Paid registration draw token allocation requires reconciliation',
          metadata: {
            paymentRecordId: registered.activation.paymentRecordId,
            reason: error instanceof Error ? error.message.slice(0, 500) : 'Unknown token allocation error',
          },
        });
      }
      let referralRewardId: string | null = null;
      if (registered.activation.referralPolicyVersionId) {
        const reward = await this.referralRewards.createEvent(
          {
            sourceKey: `epin-activation:${registered.activation.epinId}:direct-referral`,
            referredUserId: registered.user.id,
            policyVersionId: registered.activation.referralPolicyVersionId,
            basisAmount: registered.activation.paidAmount,
            currencyCode: registered.activation.currencyCode,
            occurredAt: activationAt.toISOString(),
            metadata: {
              seasonId: registered.activation.seasonId,
              enrollmentId: registered.activation.enrollmentId,
              activationType: 'PAID_EPIN_REGISTRATION',
            },
          },
          registered.user.id,
        );
        referralRewardId = reward.event.id;
      }

      await this.audit.log({
        actorUserId: registered.user.id,
        action: AuditAction.CREATE,
        entityType: 'User',
        entityId: registered.user.id,
        description: 'Paid member registration activated from a session-bound E-PIN',
        metadata: {
          accountRole: 'MEMBER',
          sponsorUserId: sponsor.id,
          placementSlot: placement.slot ?? null,
          seasonId: registered.activation.seasonId,
          enrollmentId: registered.activation.enrollmentId,
          paymentRecordId: registered.activation.paymentRecordId,
          referralRewardId,
          epinRequired: true,
        },
      });
      await this.recovery.sendRegistrationVerification(registered.user.id);
      return {
        user: {
          id: registered.user.id,
          username: registered.user.username,
          email: registered.user.email,
          phone: registered.user.phone,
          status: registered.user.status,
          emailVerifiedAt: registered.user.emailVerifiedAt,
        },
        sponsor: { id: sponsor.id, username: sponsor.username, fullName: sponsor.fullName },
        placement,
        enrollment: {
          id: registered.activation.enrollmentId,
          seasonId: registered.activation.seasonId,
          paidActivationAmount: registered.activation.paidAmount,
          currencyCode: registered.activation.currencyCode,
          registrationFeePaid: true,
          firstInstallmentPaid: true,
          seasonStartDate: registered.activation.seasonStartDate,
          drawTokens: installmentDrawTokens.map((item) => ({
            token: item.token,
            installmentSequence: item.installmentSequence,
            status: item.status,
          })),
        },
        ...(generatedPassword ? { initialPassword: password } : {}),
      };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Username, email, or mobile is already in use');
      }
      throw error;
    }
  }

  private assertPaidEpin(epin: EpinRow | undefined, now: Date) {
    if (!epin || epin.status !== 'ACTIVE' || new Date(epin.expiresAt).getTime() <= now.getTime()) {
      throw new BadRequestException('E-PIN is invalid, used, cancelled, or expired');
    }
    if (
      !epin.seasonId ||
      !epin.programVersionId ||
      epin.seasonStatus !== 'ACTIVE' ||
      epin.programLifecycle !== 'PUBLISHED'
    ) {
      throw new BadRequestException('E-PIN is not bound to an active published session');
    }
    if (
      !epin.currencyCodeSnapshot ||
      epin.registrationFeeSnapshot === null ||
      epin.installmentAmountSnapshot === null
    ) {
      throw new BadRequestException('E-PIN commercial snapshot is incomplete');
    }
    if (epin.programCurrencyCode !== epin.currencyCodeSnapshot) {
      throw new ConflictException('E-PIN currency does not match its bound session');
    }
    if (!epin.installmentCount || epin.installmentCount < 1) {
      throw new ConflictException('E-PIN session installment schedule is invalid');
    }
    if (!epin.seasonStartDate || !Number.isFinite(new Date(epin.seasonStartDate).getTime())) {
      throw new ConflictException('E-PIN session start date is invalid');
    }
  }

  private async createPaidEnrollment(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    userId: string,
    epin: EpinRow,
    occurredAt: Date,
  ): Promise<ActivationResult> {
    const enrollmentId = randomUUID();
    const paymentAttemptId = randomUUID();
    const paymentRecordId = randomUUID();
    const registrationFee = Number(epin.registrationFeeSnapshot);
    const installmentAmount = Number(epin.installmentAmountSnapshot);
    const paidAmount = registrationFee + installmentAmount;
    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
      throw new ConflictException('E-PIN paid activation amount is invalid');
    }
    const enrollmentDate = occurredAt.toISOString().slice(0, 10);
    const seasonStartAt = new Date(`${String(epin.seasonStartDate).slice(0, 10)}T00:00:00.000Z`);
    const seasonStartDate = seasonStartAt.toISOString().slice(0, 10);
    const enrollmentSource = `epin-enrollment:${epin.id}`;
    const enrollmentFingerprint = this.fingerprint({
      epinId: epin.id,
      userId,
      programVersionId: epin.programVersionId,
      registrationFee: this.money(registrationFee),
      installmentAmount: this.money(installmentAmount),
    });

    await tx.$executeRawUnsafe(
      `INSERT INTO program_enrollments
       (id, sourceKey, requestFingerprint, userId, programVersionId, enrolledAt, enrollmentDate,
        status, eligibilitySnapshot, currencyCode, registrationFeeSnapshot, installmentAmountSnapshot,
        installmentCountSnapshot, gracePeriodDaysSnapshot, metadata, createdByUserId)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?)`,
      enrollmentId,
      enrollmentSource,
      enrollmentFingerprint,
      userId,
      epin.programVersionId,
      occurredAt,
      enrollmentDate,
      JSON.stringify({
        source: 'SESSION_BOUND_EPIN',
        seasonId: epin.seasonId,
        epinId: epin.id,
        rules: epin.eligibilityRules ?? {},
        seasonStartDate,
      }),
      epin.currencyCodeSnapshot,
      this.money(registrationFee),
      this.money(installmentAmount),
      Number(epin.installmentCount),
      Number(epin.gracePeriodDays ?? 0),
      JSON.stringify({
        seasonId: epin.seasonId,
        epinId: epin.id,
        paymentSubmissionId: epin.paymentSubmissionId,
        paidActivation: true,
        seasonStartDate,
        installmentScheduleAnchor: 'SEASON_START',
      }),
      userId,
    );

    const installmentIds: string[] = [];
    for (let sequence = 1; sequence <= Number(epin.installmentCount); sequence += 1) {
      const installmentId = randomUUID();
      installmentIds.push(installmentId);
      await tx.$executeRawUnsafe(
        `INSERT INTO program_installments
         (id, enrollmentId, sequence, dueDate, amount)
         VALUES (?, ?, ?, ?, ?)`,
        installmentId,
        enrollmentId,
        sequence,
        this.installmentDueDate(
          seasonStartAt,
          Number(epin.firstInstallmentOffsetDays ?? 0),
          epin.installmentIntervalUnit ?? 'MONTH',
          Number(epin.installmentIntervalCount ?? 1),
          sequence,
        ),
        this.money(installmentAmount),
      );
    }

    const providerReference = epin.paymentSubmissionId ?? epin.id;
    await tx.$executeRawUnsafe(
      `INSERT INTO program_payment_attempts
       (id, sourceKey, requestFingerprint, enrollmentId, amount, currencyCode, provider,
        providerReference, status, initiatedAt, finalizedAt, metadata, createdByUserId)
       VALUES (?, ?, ?, ?, ?, ?, 'EPIN_PREPAID', ?, 'CONFIRMED', ?, ?, ?, ?)`,
      paymentAttemptId,
      `epin-activation-payment:${epin.id}`,
      this.fingerprint({ epinId: epin.id, enrollmentId, paidAmount: this.money(paidAmount) }),
      enrollmentId,
      this.money(paidAmount),
      epin.currencyCodeSnapshot,
      providerReference,
      occurredAt,
      occurredAt,
      JSON.stringify({ seasonId: epin.seasonId, epinId: epin.id, paymentSubmissionId: epin.paymentSubmissionId }),
      userId,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO program_payment_records
       (id, sourceKey, requestFingerprint, paymentAttemptId, enrollmentId, amount, currencyCode,
        provider, providerReference, occurredAt, metadata, createdByUserId)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'EPIN_PREPAID', ?, ?, ?, ?)`,
      paymentRecordId,
      `epin-activation-payment:${epin.id}:confirmed`,
      this.fingerprint({ epinId: epin.id, paymentAttemptId, confirmed: true }),
      paymentAttemptId,
      enrollmentId,
      this.money(paidAmount),
      epin.currencyCodeSnapshot,
      providerReference,
      occurredAt,
      JSON.stringify({ seasonId: epin.seasonId, epinId: epin.id, paidActivation: true }),
      userId,
    );
    if (registrationFee > 0) {
      await tx.$executeRawUnsafe(
        `INSERT INTO program_payment_allocations
         (id, paymentRecordId, enrollmentId, allocationType, installmentId, amount)
         VALUES (?, ?, ?, 'REGISTRATION_FEE', NULL, ?)`,
        randomUUID(),
        paymentRecordId,
        enrollmentId,
        this.money(registrationFee),
      );
    }
    if (installmentAmount > 0) {
      await tx.$executeRawUnsafe(
        `INSERT INTO program_payment_allocations
         (id, paymentRecordId, enrollmentId, allocationType, installmentId, amount)
         VALUES (?, ?, ?, 'INSTALLMENT', ?, ?)`,
        randomUUID(),
        paymentRecordId,
        enrollmentId,
        installmentIds[0],
        this.money(installmentAmount),
      );
    }

    await tx.$executeRawUnsafe(
      `INSERT INTO program_business_events
       (id, sourceKey, type, enrollmentId, occurredAt, payload)
       VALUES (?, ?, 'ENROLLMENT_CREATED', ?, ?, ?)`,
      randomUUID(),
      `PROGRAM_ENROLLMENT:${enrollmentId}:CREATED`,
      enrollmentId,
      occurredAt,
      JSON.stringify({
        source: 'SESSION_BOUND_EPIN',
        seasonId: epin.seasonId,
        epinId: epin.id,
        activationAt: occurredAt.toISOString(),
        seasonStartDate,
        installmentScheduleAnchor: 'SEASON_START',
      }),
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO program_business_events
       (id, sourceKey, type, enrollmentId, paymentRecordId, occurredAt, payload)
       VALUES (?, ?, 'PAYMENT_CONFIRMED', ?, ?, ?, ?)`,
      randomUUID(),
      `PROGRAM_PAYMENT:${paymentRecordId}:CONFIRMED`,
      enrollmentId,
      paymentRecordId,
      occurredAt,
      JSON.stringify({
        paymentAttemptId,
        amount: this.money(paidAmount),
        currencyCode: epin.currencyCodeSnapshot,
        paidActivation: true,
        registrationFeePaid: true,
        firstInstallmentPaid: true,
      }),
    );

    return {
      enrollmentId,
      paymentRecordId,
      seasonId: epin.seasonId!,
      referralPolicyVersionId: epin.referralPolicyVersionId,
      currencyCode: epin.currencyCodeSnapshot!,
      paidAmount: this.money(paidAmount),
      epinId: epin.id,
      seasonStartDate,
    };
  }

  private installmentDueDate(
    enrolledAt: Date,
    firstOffsetDays: number,
    intervalUnit: string,
    intervalCount: number,
    sequence: number,
  ) {
    const due = new Date(
      Date.UTC(enrolledAt.getUTCFullYear(), enrolledAt.getUTCMonth(), enrolledAt.getUTCDate()),
    );
    due.setUTCDate(due.getUTCDate() + firstOffsetDays);
    const multiplier = Math.max(0, sequence - 1) * intervalCount;
    if (intervalUnit === 'DAY') due.setUTCDate(due.getUTCDate() + multiplier);
    else if (intervalUnit === 'WEEK') due.setUTCDate(due.getUTCDate() + multiplier * 7);
    else due.setUTCMonth(due.getUTCMonth() + multiplier);
    return due.toISOString().slice(0, 10);
  }

  private async requireSponsor(reference: string) {
    return this.sponsor(reference);
  }

  private async autoPlaceWithRetry(memberUserId: string, sponsorUserId: string) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const placed = await this.genealogy.autoPlace(memberUserId, sponsorUserId, memberUserId);
        return { slot: placed.slot, side: placed.side };
      } catch (error) {
        lastError = error;
        if (!(error instanceof ConflictException)) throw error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new ConflictException('No available sponsor placement slot was found');
  }

  private epinHash(raw: string) {
    return createHmac('sha256', this.config.getOrThrow<string>('CAPTCHA_HMAC_SECRET'))
      .update(`owner-portal:epin:${raw.trim()}`)
      .digest('hex');
  }

  private fingerprint(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private money(value: number) {
    return value.toFixed(2);
  }
}
