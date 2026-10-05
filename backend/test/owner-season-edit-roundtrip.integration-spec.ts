import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { UserStatus } from '../src/generated/prisma/enums';
import { OwnerPrizeMediaStore } from '../src/owner-portal/owner-prize-media.store';
import { OwnerSeasonDeploymentService } from '../src/owner-portal/owner-season-deployment.service';

describe('MegaGoldenClub owner season edit round-trip integration', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let prizeMedia: OwnerPrizeMediaStore;
  let seasonDeployment: OwnerSeasonDeploymentService;
  let baseUrl = '';
  let adminToken = '';
  let adminId = '';
  let seasonId = '';
  let programId = '';
  let programVersionId = '';
  let binaryPlanId = '';
  let binaryPlanVersionId = '';
  let referralPolicyId = '';
  let referralPolicyVersionId = '';
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const seasonCode = `SRT${suffix}`;

  async function request(path: string, token?: string, init: RequestInit = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    };
  }


  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    passwords = app.get(PasswordService);
    prizeMedia = app.get(OwnerPrizeMediaStore);
    seasonDeployment = app.get(OwnerSeasonDeploymentService);

    const password = 'Season-Roundtrip-123!';
    const admin = await prisma.user.create({
      data: {
        username: `season_roundtrip_admin_${suffix}`,
        passwordHash: await passwords.hash(password),
        status: UserStatus.ACTIVE,
      },
    });
    adminId = admin.id;
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: role.id } });

    const login = await request('/auth/login', undefined, {
      method: 'POST',
      body: JSON.stringify({ identifier: admin.username, password }),
    });
    expect(login.status).toBe(200);
    adminToken = String(login.body.accessToken);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({ where: { actorUserId: adminId || undefined } });

      if (seasonId) {
        await prisma.$executeRawUnsafe('DELETE FROM owner_season_prizes WHERE seasonId = ?', seasonId);
        await prisma.$executeRawUnsafe('DELETE FROM owner_seasons WHERE id = ?', seasonId);
      }
      if (referralPolicyVersionId) {
        await prisma.referralRewardPolicyVersion.deleteMany({ where: { id: referralPolicyVersionId } });
      }
      if (referralPolicyId) {
        await prisma.referralRewardPolicy.deleteMany({ where: { id: referralPolicyId } });
      }
      if (binaryPlanVersionId) {
        await prisma.binaryPlanVersion.deleteMany({ where: { id: binaryPlanVersionId } });
      }
      if (binaryPlanId) {
        await prisma.binaryPlan.deleteMany({ where: { id: binaryPlanId } });
      }
      if (programVersionId) {
        await prisma.programVersion.deleteMany({ where: { id: programVersionId } });
      }
      if (programId) {
        await prisma.program.deleteMany({ where: { id: programId } });
      }
      if (adminId) {
        await prisma.userRole.deleteMany({ where: { userId: adminId } });
        await prisma.authSession.deleteMany({ where: { userId: adminId } });
        await prisma.user.deleteMany({ where: { id: adminId } });
      }
    }
    await app?.close();
  });

  it('preserves calendar dates and business values from create through register and edit sources', async () => {
    const payload = {
      code: seasonCode,
      name: 'MegaGoldenClub 2027 Roundtrip',
      description: 'Season date and edit-value regression coverage',
      startDate: '2027-01-01',
      monthlyEmi: '1000',
      registrationFee: '1000',
      totalMonths: 18,
      pairValue: '200',
      directReferral: '250',
      dailyCap: 5000,
      carryForward: true,
      eligibilityCutoff: 'BEFORE_DRAW_DATE',
    };

    const created = await request('/admin/owner-portal/seasons', adminToken, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      code: seasonCode.toUpperCase(),
      name: payload.name,
      startDate: '2027-01-01',
      endDate: '2028-06-30',
      monthlyEmi: '1000.00',
      registrationFee: '1000.00',
      totalMonths: 18,
      pairValue: '200.00',
      directReferral: '250.00',
      dailyCap: 5000,
      carryForward: true,
      eligibilityCutoff: 'BEFORE_DRAW_DATE',
      status: 'DRAFT',
    });

    seasonId = String(created.body.id);
    programId = String(created.body.programId);
    programVersionId = String(created.body.programVersionId);
    binaryPlanId = String(created.body.binaryPlanId);
    binaryPlanVersionId = String(created.body.binaryPlanVersionId);
    referralPolicyId = String(created.body.referralPolicyId);
    referralPolicyVersionId = String(created.body.referralPolicyVersionId);

    const stored = await prisma.$queryRawUnsafe<Array<{ startDate: string; endDate: string }>>(
      "SELECT DATE_FORMAT(startDate, '%Y-%m-%d') AS startDate, DATE_FORMAT(endDate, '%Y-%m-%d') AS endDate FROM owner_seasons WHERE id = ?",
      seasonId,
    );
    expect(stored[0]).toMatchObject({
      startDate: '2027-01-01',
      endDate: '2028-06-30',
    });

    const register = await request('/admin/owner-portal/seasons', adminToken);
    expect(register.status).toBe(200);
    const listed = (register.body as unknown as Array<Record<string, unknown>>).find(
      (row) => row.id === seasonId,
    );
    expect(listed).toMatchObject({
      startDate: '2027-01-01',
      endDate: '2028-06-30',
      monthlyEmi: '1000.00',
      registrationFee: '1000.00',
      totalMonths: 18,
      pairValue: '200.00',
      directReferral: '250.00',
      dailyCap: 5000,
      carryForward: true,
    });

    const editSource = await request(`/admin/owner-portal/seasons/${seasonId}`, adminToken);
    expect(editSource.status).toBe(200);
    expect(editSource.body).toMatchObject({
      startDate: '2027-01-01',
      endDate: '2028-06-30',
      monthlyEmi: '1000.00',
      registrationFee: '1000.00',
      totalMonths: 18,
      pairValue: '200.00',
      directReferral: '250.00',
      dailyCap: 5000,
      carryForward: true,
    });

    const longPrizeDescription = [
      'The Indian electric scooter market features affordable city commuters and premium long-range models.',
      'Modern EV scooters can provide lower running costs, connected features, practical storage and different battery ranges.',
      'This catalogue description intentionally exceeds the original two-hundred-and-fifty-five-character placeholder limit',
      'so product information entered by the owner must round-trip exactly through save, database storage and reload.',
    ].join(' ');
    expect(longPrizeDescription.length).toBeGreaterThan(255);

    const savedPrizes = await request(
      `/admin/owner-portal/seasons/${seasonId}/prizes`,
      adminToken,
      {
        method: 'PUT',
        body: JSON.stringify({
          // Deliberately submit out of order. The API must return and reload
          // the deterministic prize-code sequence used by the UI and draw tiers.
          prizes: [
            {
              monthNumber: 1,
              prizeCode: 'MONTH_1_PRIZE_3',
              category: 'Prize',
              name: 'Kitchen Appliances',
              winnerCount: 1,
            },
            {
              monthNumber: 1,
              prizeCode: 'MONTH_1_PRIZE_1',
              category: 'Prize',
              name: 'EV Scooter',
              description: longPrizeDescription,
              winnerCount: 1,
            },
            {
              monthNumber: 1,
              prizeCode: 'MONTH_1_PRIZE_2',
              category: 'Prize',
              name: 'Gold Jewellery',
              winnerCount: 1,
            },
          ],
        }),
      },
    );
    expect(savedPrizes.status).toBe(200);
    expect(savedPrizes.body.map((prize: { prizeCode: string }) => prize.prizeCode)).toEqual([
      'MONTH_1_PRIZE_1',
      'MONTH_1_PRIZE_2',
      'MONTH_1_PRIZE_3',
    ]);
    expect(savedPrizes.body[0]).toMatchObject({
      seasonId,
      monthNumber: 1,
      prizeCode: 'MONTH_1_PRIZE_1',
      name: 'EV Scooter',
      description: longPrizeDescription,
      winnerCount: 1,
    });
    expect(savedPrizes.body[1]).toMatchObject({
      prizeCode: 'MONTH_1_PRIZE_2',
      name: 'Gold Jewellery',
    });
    expect(savedPrizes.body[2]).toMatchObject({
      prizeCode: 'MONTH_1_PRIZE_3',
      name: 'Kitchen Appliances',
    });

    const reloadedPrizes = await request(
      `/admin/owner-portal/seasons/${seasonId}/prizes`,
      adminToken,
    );
    expect(reloadedPrizes.status).toBe(200);
    expect(reloadedPrizes.body.map((prize: { prizeCode: string }) => prize.prizeCode)).toEqual([
      'MONTH_1_PRIZE_1',
      'MONTH_1_PRIZE_2',
      'MONTH_1_PRIZE_3',
    ]);
    expect(reloadedPrizes.body[0]).toMatchObject({
      name: 'EV Scooter',
      description: longPrizeDescription,
    });

    const storedPrizeDescription = await prisma.$queryRawUnsafe<Array<{ description: string }>>(
      'SELECT description FROM owner_season_prizes WHERE seasonId = ? AND prizeCode = ? LIMIT 1',
      seasonId,
      'MONTH_1_PRIZE_1',
    );
    expect(storedPrizeDescription[0]?.description).toBe(longPrizeDescription);
  });

  it('exports and idempotently imports a production-safe season deployment package', async () => {
    const advanced = await request(
      `/admin/owner-portal/seasons/${seasonId}/advanced-configuration`,
      adminToken,
      {
        method: 'PUT',
        body: JSON.stringify({
          qualifyingUnit: '1.0000',
          leftVolumePerPair: '1.0000',
          rightVolumePerPair: '1.0000',
          binaryUnitsPerEvent: 1,
          referralHookEnabled: true,
          referralBasisMode: 'REGISTRATION_ALLOCATION',
          drawEligibilityHookEnabled: false,
          drawStartMonth: 1,
          drawWeekOfMonth: 3,
          drawWeekday: 'SUNDAY',
          minimumPaymentAmount: '2000',
          minimumRegistrationAllocation: '1000',
          minimumInstallmentAllocation: '1000',
          requiredAllocationTypes: ['REGISTRATION_FEE', 'INSTALLMENT'],
        }),
      },
    );
    expect(advanced.status).toBe(200);
    expect(advanced.body).toMatchObject({
      drawSchedule: {
        startMonth: 1,
        weekOfMonth: 3,
        weekday: 'SUNDAY',
      },
      automaticRules: {
        configured: true,
        binaryUnitsPerEvent: 1,
        referralHookEnabled: true,
      },
    });

    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n0sAAAAASUVORK5CYII=',
      'base64',
    );
    const media = await prizeMedia.upload({
      seasonId,
      actorUserId: adminId,
      originalName: 'ev-scooter.png',
      contentType: 'image/png',
      buffer: onePixelPng,
    });

    const monthOne = await request(
      `/admin/owner-portal/seasons/${seasonId}/prizes`,
      adminToken,
    );
    expect(monthOne.status).toBe(200);
    const monthOnePrizes = (monthOne.body as unknown as Array<Record<string, any>>)
      .map((prize) => ({
        monthNumber: Number(prize.monthNumber),
        prizeCode: String(prize.prizeCode),
        category: String(prize.category),
        name: String(prize.name),
        ...(prize.description ? { description: String(prize.description) } : {}),
        winnerCount: Number(prize.winnerCount),
        ...(prize.nominalValue ? { nominalValue: String(prize.nominalValue) } : {}),
        ...(String(prize.prizeCode) === 'MONTH_1_PRIZE_1'
          ? { mediaId: media.id }
          : {}),
      }));
    const fullSchedule = [
      ...monthOnePrizes,
      ...Array.from({ length: 17 }, (_, index) => {
        const monthNumber = index + 2;
        return {
          monthNumber,
          prizeCode: `MONTH_${monthNumber}_PRIZE_1`,
          category: 'Prize',
          name: `Month ${monthNumber} Deployment Prize`,
          winnerCount: 1,
        };
      }),
    ];
    const fullScheduleSaved = await request(
      `/admin/owner-portal/seasons/${seasonId}/prizes`,
      adminToken,
      {
        method: 'PUT',
        body: JSON.stringify({ prizes: fullSchedule }),
      },
    );
    expect(fullScheduleSaved.status).toBe(200);

    const exported = await request(
      `/admin/owner-portal/seasons/${seasonId}/deployment-package`,
      adminToken,
    );
    expect(exported.status).toBe(200);
    expect(exported.body).toMatchObject({
      format: 'MEGAGOLDENCLUB_SEASON_DEPLOYMENT',
      version: 1,
      source: {
        currencyCode: 'INR',
      },
      season: {
        code: seasonCode.toUpperCase(),
        totalMonths: 18,
      },
      summary: {
        months: 18,
        configuredMonths: 18,
        prizeCount: 20,
        winnerSlots: 20,
        mediaCount: 1,
      },
    });
    expect(exported.body.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(exported.body.media).toHaveLength(1);
    expect(exported.body.media[0]).toMatchObject({
      filename: 'ev-scooter.png',
      contentType: 'image/png',
      sha256: media.sha256,
    });

    const mutatedSchedule = fullSchedule.map((prize) =>
      prize.prizeCode === 'MONTH_1_PRIZE_1'
        ? {
            ...prize,
            name: 'MUTATED LOCAL VALUE',
            mediaId: undefined,
          }
        : prize,
    );
    const mutated = await request(
      `/admin/owner-portal/seasons/${seasonId}/prizes`,
      adminToken,
      {
        method: 'PUT',
        body: JSON.stringify({ prizes: mutatedSchedule }),
      },
    );
    expect(mutated.status).toBe(200);
    expect(mutated.body[0]).toMatchObject({
      prizeCode: 'MONTH_1_PRIZE_1',
      name: 'MUTATED LOCAL VALUE',
      mediaId: null,
    });

    const packageBuffer = Buffer.from(JSON.stringify(exported.body), 'utf8');
    const importedBody = await seasonDeployment.importPackage(
      {
        buffer: packageBuffer,
        originalname: 'season-deployment-v1.mgc.json',
        mimetype: 'application/json',
        size: packageBuffer.length,
      },
      adminId,
    );
    expect(importedBody).toMatchObject({
      mode: 'UPDATED',
      checksum: exported.body.checksum,
      season: {
        id: seasonId,
        code: seasonCode.toUpperCase(),
        status: 'DRAFT',
      },
      summary: {
        months: 18,
        prizeCount: 20,
        mediaCount: 1,
      },
    });

    const restored = await request(
      `/admin/owner-portal/seasons/${seasonId}/prizes`,
      adminToken,
    );
    expect(restored.status).toBe(200);
    expect(restored.body[0]).toMatchObject({
      prizeCode: 'MONTH_1_PRIZE_1',
      name: 'EV Scooter',
      mediaMimeType: 'image/png',
    });
    const restoredMediaId = String(restored.body[0].mediaId);
    expect(restoredMediaId).toMatch(/^[a-f0-9]{24}$/);
    const restoredMedia = await prizeMedia.info(restoredMediaId);
    expect(restoredMedia).toMatchObject({
      seasonId,
      sha256: media.sha256,
      contentType: 'image/png',
    });

    const importedAgain = await seasonDeployment.importPackage(
      {
        buffer: packageBuffer,
        originalname: 'season-deployment-v1.mgc.json',
        mimetype: 'application/json',
        size: packageBuffer.length,
      },
      adminId,
    );
    expect(importedAgain.mode).toBe('UPDATED');
    const afterReplay = await request(
      `/admin/owner-portal/seasons/${seasonId}/prizes`,
      adminToken,
    );
    expect(afterReplay.status).toBe(200);
    expect(afterReplay.body[0].mediaId).toBe(restoredMediaId);
  });
});
