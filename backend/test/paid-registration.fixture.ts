import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'node:crypto';
import { PrismaService } from '../src/database/prisma.service';
import { PolicyLifecycle, ProgramIntervalUnit, UserStatus } from '../src/generated/prisma/enums';

export type PaidRegistrationFixture = {
  programId: string;
  programVersionId: string;
  seasonId: string;
  sponsorUserId: string;
  sponsorUsername: string;
  createEpin: (raw: string) => Promise<string>;
  cleanupUserEnrollments: (userIds: string[]) => Promise<void>;
  cleanupDomain: () => Promise<void>;
};

export async function createPaidRegistrationFixture(
  prisma: PrismaService,
  config: ConfigService,
  prefix: string,
): Promise<PaidRegistrationFixture> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const memberRole = await prisma.role.findUniqueOrThrow({ where: { name: 'MEMBER' } });
  const sponsorUsername = `${prefix}_root_${suffix}`;
  const sponsor = await prisma.user.create({
    data: {
      username: sponsorUsername,
      email: `${sponsorUsername}@example.test`,
      passwordHash: 'registration-fixture-not-used',
      firstName: 'Fixture',
      lastName: 'Sponsor',
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.userRole.create({ data: { userId: sponsor.id, roleId: memberRole.id } });
  await prisma.$executeRawUnsafe(
    `INSERT INTO member_profiles (userId, memberType, lifecycleStatus)
     VALUES (?, 'MEMBER', 'ACTIVE')`,
    sponsor.id,
  );

  const program = await prisma.program.create({
    data: {
      code: `${prefix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)}PG${suffix}`,
      name: `${prefix} paid registration fixture ${suffix}`,
    },
  });
  const effectiveFrom = new Date(Date.now() - 60_000);
  const programVersion = await prisma.programVersion.create({
    data: {
      programId: program.id,
      version: 1,
      lifecycle: PolicyLifecycle.PUBLISHED,
      effectiveFrom,
      currencyCode: 'INR',
      registrationFee: '1000.00',
      installmentAmount: '1000.00',
      installmentCount: 18,
      installmentIntervalUnit: ProgramIntervalUnit.MONTH,
      installmentIntervalCount: 1,
      firstInstallmentOffsetDays: 0,
      gracePeriodDays: 0,
      maxActiveEnrollmentsPerUser: 1,
      partialPaymentsAllowed: false,
      overpaymentsAllowed: false,
      eligibilityRules: { fixture: true },
      publishedAt: effectiveFrom,
    },
  });

  const seasonId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO owner_seasons
       (id, code, name, status, startDate, drawDay, eligibilityCutoff, programId, programVersionId)
     VALUES (?, ?, ?, 'ACTIVE', ?, 17, 'BEFORE_DRAW_DATE', ?, ?)`,
    seasonId,
    `${prefix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)}S${suffix}`,
    `${prefix} registration session ${suffix}`,
    new Date('2026-01-01T00:00:00.000Z'),
    program.id,
    programVersion.id,
  );

  async function createEpin(raw: string) {
    const id = randomUUID();
    const pinHash = createHmac(
      'sha256',
      config.getOrThrow<string>('CAPTCHA_HMAC_SECRET'),
    )
      .update(`owner-portal:epin:${raw}`)
      .digest('hex');
    await prisma.$executeRawUnsafe(
      `INSERT INTO owner_epins
         (id, pinHash, displaySuffix, seasonId, status, expiresAt,
          currencyCodeSnapshot, registrationFeeSnapshot, installmentAmountSnapshot,
          createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 'ACTIVE', ?, 'INR', 1000.00, 1000.00,
               CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      id,
      pinHash,
      raw.slice(-6),
      seasonId,
      new Date(Date.now() + 60 * 60 * 1000),
    );
    return id;
  }

  async function cleanupUserEnrollments(userIds: string[]) {
    if (!userIds.length) return;
    const enrollments = await prisma.programEnrollment.findMany({
      where: { userId: { in: userIds }, programVersionId: programVersion.id },
      select: { id: true },
    });
    const enrollmentIds = enrollments.map((item) => item.id);
    if (!enrollmentIds.length) return;
    await prisma.programBusinessEvent.deleteMany({ where: { enrollmentId: { in: enrollmentIds } } });
    await prisma.programPaymentAllocation.deleteMany({ where: { enrollmentId: { in: enrollmentIds } } });
    await prisma.programPaymentRecord.deleteMany({ where: { enrollmentId: { in: enrollmentIds } } });
    await prisma.programPaymentAttempt.deleteMany({ where: { enrollmentId: { in: enrollmentIds } } });
    await prisma.programInstallment.deleteMany({ where: { enrollmentId: { in: enrollmentIds } } });
    await prisma.programEnrollment.deleteMany({ where: { id: { in: enrollmentIds } } });
  }

  async function cleanupDomain() {
    await prisma.$executeRawUnsafe('DELETE FROM owner_seasons WHERE id=?', seasonId);
    await prisma.programVersion.delete({ where: { id: programVersion.id } });
    await prisma.program.delete({ where: { id: program.id } });
  }

  return {
    programId: program.id,
    programVersionId: programVersion.id,
    seasonId,
    sponsorUserId: sponsor.id,
    sponsorUsername,
    createEpin,
    cleanupUserEnrollments,
    cleanupDomain,
  };
}
