import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { UserStatus } from '../src/generated/prisma/enums';

describe('MegaGoldenClub owner season edit round-trip integration', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let prisma: PrismaService;
  let passwords: PasswordService;
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
      code: seasonCode,
      name: payload.name,
      startDate: '2027-01-01',
      endDate: null,
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

    const stored = await prisma.$queryRawUnsafe<Array<{ startDate: string }>>(
      "SELECT DATE_FORMAT(startDate, '%Y-%m-%d') AS startDate FROM owner_seasons WHERE id = ?",
      seasonId,
    );
    expect(stored[0]?.startDate).toBe('2027-01-01');

    const register = await request('/admin/owner-portal/seasons', adminToken);
    expect(register.status).toBe(200);
    const listed = (register.body as unknown as Array<Record<string, unknown>>).find(
      (row) => row.id === seasonId,
    );
    expect(listed).toMatchObject({
      startDate: '2027-01-01',
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
      monthlyEmi: '1000.00',
      registrationFee: '1000.00',
      totalMonths: 18,
      pairValue: '200.00',
      directReferral: '250.00',
      dailyCap: 5000,
      carryForward: true,
    });
  });
});
