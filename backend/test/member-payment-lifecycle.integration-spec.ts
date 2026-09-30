import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import {
  PasswordCreationMode,
  UserStatus,
  UsernameCreationMode,
} from '../src/generated/prisma/enums';
import {
  createPaidRegistrationFixture,
  type PaidRegistrationFixture,
} from './paid-registration.fixture';

type HttpResult = {
  status: number;
  body: Record<string, any>;
};

type AuthSnapshot = {
  loginWithUsername: boolean;
  loginWithEmail: boolean;
  loginWithMobile: boolean;
  captchaOnLoginEnabled: boolean;
  captchaOnRegistrationEnabled: boolean;
};

type RegistrationSnapshot = {
  publicRegistrationEnabled: boolean;
  emailRequired: boolean;
  mobileRequired: boolean;
  passwordMode: PasswordCreationMode;
  usernameMode: UsernameCreationMode;
  usernamePrefixEnabled: boolean;
  usernamePrefix: string | null;
  defaultRoleName: string;
  allowMultipleAccountsPerEmail: boolean;
  allowMultipleAccountsPerMobile: boolean;
};

type PaymentSettingsSnapshot = {
  upiId: string | null;
  payeeName: string | null;
  qrImageDataUrl: string | null;
  instructions: string | null;
  enabled: boolean | number;
  updatedByUserId: string | null;
};

type GeneratedEpin = {
  id: string;
  status: string;
  assignedUserId: string | null;
  seasonId: string | null;
};

describe('MegaGoldenClub member payment and E-PIN lifecycle integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: ConfigService;
  let passwords: PasswordService;
  let baseUrl = '';
  let paidRegistration: PaidRegistrationFixture;
  let originalAuth: AuthSnapshot;
  let originalRegistration: RegistrationSnapshot;
  let originalPaymentSettings: PaymentSettingsSnapshot;

  const createdUserIds: string[] = [];
  const registrationEpinIds: string[] = [];
  const submissionIds: string[] = [];
  const generatedEpinIds: string[] = [];

  async function request(path: string, init: RequestInit = {}): Promise<HttpResult> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    };
  }

  function bearer(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function login(username: string, password: string) {
    const response = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: username, password }),
    });
    expect(response.status).toBe(200);
    return String(response.body.accessToken);
  }

  async function createRoleUser(roleName: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER', prefix: string) {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const password = 'Member-Payment-Test-123!';
    const user = await prisma.user.create({
      data: {
        username: `${prefix}_${suffix}`,
        email: `${prefix}_${suffix}@example.test`,
        passwordHash: await passwords.hash(password),
        firstName: prefix,
        lastName: 'Fixture',
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    createdUserIds.push(user.id);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    if (roleName === 'MEMBER') {
      await prisma.$executeRawUnsafe(
        `INSERT INTO member_profiles (userId, memberType, lifecycleStatus)
         VALUES (?, 'MEMBER', 'ACTIVE')`,
        user.id,
      );
    }
    return { user, password };
  }

  function details(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object') return value as Record<string, unknown>;
    if (typeof value !== 'string') return {};
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    config = app.get(ConfigService);
    passwords = app.get(PasswordService);

    const [auth, registration, paymentSettings] = await Promise.all([
      prisma.systemAuthConfig.findUniqueOrThrow({ where: { id: 1 } }),
      prisma.systemRegistrationConfig.findUniqueOrThrow({ where: { id: 1 } }),
      prisma.$queryRawUnsafe<PaymentSettingsSnapshot[]>(
        `SELECT upiId, payeeName, qrImageDataUrl, instructions, enabled, updatedByUserId
         FROM owner_payment_settings WHERE id=1`,
      ),
    ]);
    originalAuth = {
      loginWithUsername: auth.loginWithUsername,
      loginWithEmail: auth.loginWithEmail,
      loginWithMobile: auth.loginWithMobile,
      captchaOnLoginEnabled: auth.captchaOnLoginEnabled,
      captchaOnRegistrationEnabled: auth.captchaOnRegistrationEnabled,
    };
    originalRegistration = {
      publicRegistrationEnabled: registration.publicRegistrationEnabled,
      emailRequired: registration.emailRequired,
      mobileRequired: registration.mobileRequired,
      passwordMode: registration.passwordMode,
      usernameMode: registration.usernameMode,
      usernamePrefixEnabled: registration.usernamePrefixEnabled,
      usernamePrefix: registration.usernamePrefix,
      defaultRoleName: registration.defaultRoleName,
      allowMultipleAccountsPerEmail: registration.allowMultipleAccountsPerEmail,
      allowMultipleAccountsPerMobile: registration.allowMultipleAccountsPerMobile,
    };
    originalPaymentSettings = paymentSettings[0];

    await Promise.all([
      prisma.systemAuthConfig.update({
        where: { id: 1 },
        data: {
          loginWithUsername: true,
          loginWithEmail: true,
          loginWithMobile: false,
          captchaOnLoginEnabled: false,
          captchaOnRegistrationEnabled: false,
        },
      }),
      prisma.systemRegistrationConfig.update({
        where: { id: 1 },
        data: {
          publicRegistrationEnabled: true,
          emailRequired: true,
          mobileRequired: false,
          passwordMode: PasswordCreationMode.MANUAL,
          usernameMode: UsernameCreationMode.MANUAL,
          usernamePrefixEnabled: false,
          usernamePrefix: null,
          defaultRoleName: 'MEMBER',
          allowMultipleAccountsPerEmail: false,
          allowMultipleAccountsPerMobile: false,
        },
      }),
    ]);

    paidRegistration = await createPaidRegistrationFixture(prisma, config, 'memberpay');
    createdUserIds.push(paidRegistration.sponsorUserId);
  });

  afterAll(async () => {
    if (prisma) {
      await Promise.all([
        prisma.systemAuthConfig.update({ where: { id: 1 }, data: originalAuth }),
        prisma.systemRegistrationConfig.update({ where: { id: 1 }, data: originalRegistration }),
      ]);
      if (originalPaymentSettings) {
        await prisma.$executeRawUnsafe(
          `UPDATE owner_payment_settings
           SET upiId=?, payeeName=?, qrImageDataUrl=?, instructions=?, enabled=?, updatedByUserId=?
           WHERE id=1`,
          originalPaymentSettings.upiId,
          originalPaymentSettings.payeeName,
          originalPaymentSettings.qrImageDataUrl,
          originalPaymentSettings.instructions,
          originalPaymentSettings.enabled,
          originalPaymentSettings.updatedByUserId,
        );
      }

      if (generatedEpinIds.length) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM owner_epins WHERE id IN (${generatedEpinIds.map(() => '?').join(',')})`,
          ...generatedEpinIds,
        );
      }
      if (submissionIds.length) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM member_payment_submissions WHERE id IN (${submissionIds.map(() => '?').join(',')})`,
          ...submissionIds,
        );
      }
      if (paidRegistration) {
        await paidRegistration.cleanupUserEnrollments(createdUserIds);
      }
      if (registrationEpinIds.length) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM owner_epins WHERE id IN (${registrationEpinIds.map(() => '?').join(',')})`,
          ...registrationEpinIds,
        );
      }

      await prisma.auditLog.deleteMany({ where: { actorUserId: { in: createdUserIds } } });
      if (createdUserIds.length) {
        const placeholders = createdUserIds.map(() => '?').join(',');
        await prisma.$executeRawUnsafe(
          `DELETE FROM binary_ancestry
           WHERE ancestorUserId IN (${placeholders}) OR descendantUserId IN (${placeholders})`,
          ...createdUserIds,
          ...createdUserIds,
        );
        await prisma.$executeRawUnsafe(
          `DELETE FROM binary_placements
           WHERE memberUserId IN (${placeholders}) OR parentUserId IN (${placeholders})`,
          ...createdUserIds,
          ...createdUserIds,
        );
        await prisma.$executeRawUnsafe(
          `DELETE FROM sponsor_relationships
           WHERE memberUserId IN (${placeholders}) OR sponsorUserId IN (${placeholders})`,
          ...createdUserIds,
          ...createdUserIds,
        );
        await prisma.$executeRawUnsafe(
          `DELETE FROM member_profiles WHERE userId IN (${placeholders})`,
          ...createdUserIds,
        );
      }
      if (paidRegistration) await paidRegistration.cleanupDomain();
      await prisma.authSession.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (app) await app.close();
  });

  it('keeps MEMBER QR/UPI receipts stable through Super Admin review and enforces E-PIN lifecycle', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const memberUsername = `memberpay_${suffix}`;
    const memberEmail = `${memberUsername}@example.test`;
    const memberPassword = 'Member-Payment-Flow-123!';
    const registrationPin = `REG-${suffix}`;
    registrationEpinIds.push(await paidRegistration.createEpin(registrationPin));

    const registered = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: memberUsername,
        email: memberEmail,
        password: memberPassword,
        fullName: 'Payment Flow Member',
        sponsorReference: paidRegistration.sponsorUsername,
        epin: registrationPin,
      }),
    });
    expect(registered.status).toBe(201);
    const memberId = String(registered.body.user.id);
    createdUserIds.push(memberId);

    const memberRole = await prisma.userRole.findFirst({
      where: { userId: memberId },
      include: { role: true },
    });
    expect(memberRole?.role.name).toBe('MEMBER');
    const memberRecord = await prisma.user.findUniqueOrThrow({ where: { id: memberId } });
    expect(memberRecord.status).toBe(UserStatus.ACTIVE);

    const superAdmin = await createRoleUser('SUPER_ADMIN', 'memberpay_owner');
    const admin = await createRoleUser('ADMIN', 'memberpay_admin');
    const targetMember = await createRoleUser('MEMBER', 'memberpay_target');
    const [memberToken, superAdminToken, adminToken] = await Promise.all([
      login(memberUsername, memberPassword),
      login(superAdmin.user.username, superAdmin.password),
      login(admin.user.username, admin.password),
    ]);

    const paymentSettings = await request('/admin/member-payments/settings', {
      method: 'PUT',
      headers: bearer(superAdminToken),
      body: JSON.stringify({
        upiId: 'megagoldenclub@test',
        payeeName: 'MegaGoldenClub Test',
        qrImageDataUrl: 'data:image/png;base64,aGVsbG8=',
        instructions: 'Integration test payment rail',
        enabled: true,
      }),
    });
    expect(paymentSettings.status).toBe(200);

    const beforePayment = await request('/member/payments/config', {
      headers: bearer(memberToken),
    });
    expect(beforePayment.status).toBe(200);
    expect(beforePayment.body.installment.paidInstallmentCount).toBe(1);
    expect(beforePayment.body.installment.remainingInstallmentCount).toBe(17);

    const installment = await request('/member/payments/installments', {
      method: 'POST',
      headers: bearer(memberToken),
      body: JSON.stringify({
        amount: '2000.00',
        utr: `INSTALL-${suffix}`,
        paymentProofDataUrl: 'data:image/png;base64,aGVsbG8=',
      }),
    });
    expect(installment.status).toBe(201);
    expect(installment.body.purpose).toBe('INSTALLMENT');
    expect(installment.body.status).toBe('PENDING_VERIFICATION');
    expect(installment.body.receiptType).toBe('PROVISIONAL');
    submissionIds.push(String(installment.body.id));

    const publicInstallmentPending = await request(String(installment.body.receiptUrl));
    expect(publicInstallmentPending.status).toBe(200);
    expect(publicInstallmentPending.body.memberId).toBe(memberId);
    expect(publicInstallmentPending.body.username).toBe(memberUsername);
    expect(publicInstallmentPending.body.status).toBe('PENDING_VERIFICATION');
    expect(details(publicInstallmentPending.body.details).installmentCount).toBe(2);

    const adminCannotVerify = await request(
      `/admin/member-payments/submissions/${installment.body.id}/review`,
      {
        method: 'PATCH',
        headers: bearer(adminToken),
        body: JSON.stringify({ decision: 'APPROVE' }),
      },
    );
    expect(adminCannotVerify.status).toBe(403);

    const installmentApproved = await request(
      `/admin/member-payments/submissions/${installment.body.id}/review`,
      {
        method: 'PATCH',
        headers: bearer(superAdminToken),
        body: JSON.stringify({ decision: 'APPROVE', note: 'Verified test installment' }),
      },
    );
    expect(installmentApproved.status).toBe(200);
    expect(installmentApproved.body.status).toBe('CONFIRMED');

    const publicInstallmentConfirmed = await request(String(installment.body.receiptUrl));
    expect(publicInstallmentConfirmed.status).toBe(200);
    expect(publicInstallmentConfirmed.body.receiptNumber).toBe(installment.body.receiptNumber);
    expect(publicInstallmentConfirmed.body.status).toBe('CONFIRMED');

    const afterPayment = await request('/member/payments/config', {
      headers: bearer(memberToken),
    });
    expect(afterPayment.status).toBe(200);
    expect(afterPayment.body.installment.paidInstallmentCount).toBe(3);
    expect(afterPayment.body.installment.nextUnpaidSequence).toBe(4);

    const epinPurchase = await request('/member/payments/epins', {
      method: 'POST',
      headers: bearer(memberToken),
      body: JSON.stringify({
        seasonId: paidRegistration.seasonId,
        quantity: 2,
        utr: `EPIN-${suffix}`,
        paymentProofDataUrl: 'data:image/png;base64,aGVsbG8=',
      }),
    });
    expect(epinPurchase.status).toBe(201);
    expect(epinPurchase.body.purpose).toBe('EPIN_PURCHASE');
    expect(epinPurchase.body.status).toBe('PENDING_VERIFICATION');
    expect(details(epinPurchase.body.details).quantity).toBe(2);
    submissionIds.push(String(epinPurchase.body.id));

    const publicEpinPending = await request(String(epinPurchase.body.receiptUrl));
    expect(publicEpinPending.status).toBe(200);
    expect(publicEpinPending.body.status).toBe('PENDING_VERIFICATION');
    expect(publicEpinPending.body.seasonCode).toBeTruthy();

    const epinApproved = await request(
      `/admin/member-payments/submissions/${epinPurchase.body.id}/review`,
      {
        method: 'PATCH',
        headers: bearer(superAdminToken),
        body: JSON.stringify({ decision: 'APPROVE' }),
      },
    );
    expect(epinApproved.status).toBe(200);
    expect(epinApproved.body.status).toBe('CONFIRMED');

    const generated = await prisma.$queryRawUnsafe<GeneratedEpin[]>(
      `SELECT id, status, assignedUserId, seasonId
       FROM owner_epins WHERE paymentSubmissionId=? ORDER BY createdAt ASC`,
      String(epinPurchase.body.id),
    );
    expect(generated).toHaveLength(2);
    generatedEpinIds.push(...generated.map((pin) => pin.id));
    expect(generated.every((pin) => pin.status === 'ACTIVE')).toBe(true);
    expect(generated.every((pin) => pin.assignedUserId === memberId)).toBe(true);
    expect(generated.every((pin) => pin.seasonId === paidRegistration.seasonId)).toBe(true);

    const ownedPins = await request('/member/payments/epins', {
      headers: bearer(memberToken),
    });
    expect(ownedPins.status).toBe(200);
    expect((ownedPins.body as unknown as GeneratedEpin[]).length).toBeGreaterThanOrEqual(2);

    const reassigned = await request(
      `/admin/member-payments/epins/${generated[0].id}/reassign`,
      {
        method: 'PATCH',
        headers: bearer(adminToken),
        body: JSON.stringify({ memberReference: targetMember.user.username }),
      },
    );
    expect(reassigned.status).toBe(200);
    expect(reassigned.body.assignedUserId).toBe(targetMember.user.id);

    await prisma.$executeRawUnsafe(
      `UPDATE owner_epins
       SET status='USED', usedByUserId=?, usedAt=CURRENT_TIMESTAMP(3), updatedAt=CURRENT_TIMESTAMP(3)
       WHERE id=?`,
      targetMember.user.id,
      generated[1].id,
    );
    const usedCannotBeReassigned = await request(
      `/admin/member-payments/epins/${generated[1].id}/reassign`,
      {
        method: 'PATCH',
        headers: bearer(adminToken),
        body: JSON.stringify({ memberReference: targetMember.user.username }),
      },
    );
    expect(usedCannotBeReassigned.status).toBe(409);

    const rejected = await request('/member/payments/installments', {
      method: 'POST',
      headers: bearer(memberToken),
      body: JSON.stringify({
        amount: '1000.00',
        utr: `REJECT-${suffix}`,
        paymentProofDataUrl: 'data:image/png;base64,aGVsbG8=',
      }),
    });
    expect(rejected.status).toBe(201);
    submissionIds.push(String(rejected.body.id));
    const rejectedReview = await request(
      `/admin/member-payments/submissions/${rejected.body.id}/review`,
      {
        method: 'PATCH',
        headers: bearer(superAdminToken),
        body: JSON.stringify({ decision: 'REJECT', note: 'UTR not verified' }),
      },
    );
    expect(rejectedReview.status).toBe(200);
    expect(rejectedReview.body.status).toBe('REJECTED');
    const publicRejected = await request(String(rejected.body.receiptUrl));
    expect(publicRejected.status).toBe(200);
    expect(publicRejected.body.receiptNumber).toBe(rejected.body.receiptNumber);
    expect(publicRejected.body.status).toBe('REJECTED');
  });
});
