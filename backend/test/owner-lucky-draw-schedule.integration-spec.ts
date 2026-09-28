import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import {
  PolicyLifecycle,
  ProgramIntervalUnit,
  UserStatus,
} from '../src/generated/prisma/enums';

describe('MegaGoldenClub owner lucky draw schedule integration', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let baseUrl: string;
  let adminToken: string;
  let memberToken: string;
  let seasonId = '';
  let seasonCode = '';
  const userIds: string[] = [];
  const programIds: string[] = [];
  const programVersionIds: string[] = [];

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

  async function login(username: string, password: string) {
    const response = await request('/auth/login', undefined, {
      method: 'POST',
      body: JSON.stringify({ identifier: username, password }),
    });
    expect(response.status).toBe(200);
    return String(response.body.accessToken);
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    passwords = app.get(PasswordService);

    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const password = 'Owner-Draw-UAT-Pass-123!';
    const passwordHash = await passwords.hash(password);
    const [admin, member] = await Promise.all([
      prisma.user.create({
        data: {
          username: `owner_draw_admin_${suffix}`,
          passwordHash,
          status: UserStatus.ACTIVE,
        },
      }),
      prisma.user.create({
        data: {
          username: `owner_draw_member_${suffix}`,
          passwordHash,
          status: UserStatus.ACTIVE,
        },
      }),
    ]);
    userIds.push(admin.id, member.id);
    const superAdmin = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: superAdmin.id } });
    [adminToken, memberToken] = await Promise.all([
      login(admin.username, password),
      login(member.username, password),
    ]);

    const program = await prisma.program.create({
      data: { code: `ODP${suffix}`, name: `Owner draw UAT ${suffix}` },
    });
    programIds.push(program.id);
    const programVersion = await prisma.programVersion.create({
      data: {
        programId: program.id,
        version: 1,
        lifecycle: PolicyLifecycle.PUBLISHED,
        effectiveFrom: new Date('2026-12-01T00:00:00.000Z'),
        currencyCode: 'INR',
        registrationFee: '0.00',
        installmentAmount: '0.00',
        installmentCount: 0,
        installmentIntervalUnit: ProgramIntervalUnit.MONTH,
        installmentIntervalCount: 1,
        firstInstallmentOffsetDays: 0,
        gracePeriodDays: 0,
        partialPaymentsAllowed: true,
        overpaymentsAllowed: false,
        publishedAt: new Date('2026-12-01T00:00:00.000Z'),
      },
    });
    programVersionIds.push(programVersion.id);

    seasonId = randomUUID();
    seasonCode = `ODS${suffix}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO owner_seasons
         (id, code, name, status, startDate, drawDay, eligibilityCutoff,
          programId, programVersionId, createdByUserId)
       VALUES (?, ?, ?, 'ACTIVE', ?, 25, 'BEFORE_DRAW_DATE', ?, ?, ?)`,
      seasonId,
      seasonCode,
      `Owner draw season ${suffix}`,
      new Date('2027-01-01T00:00:00.000Z'),
      program.id,
      programVersion.id,
      admin.id,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO owner_season_prizes
         (id, seasonId, monthNumber, prizeCode, category, name, winnerCount, currencyCode)
       VALUES (?, ?, 1, ?, 'UAT', 'January UAT Prize', 1, 'INR')`,
      randomUUID(),
      seasonId,
      `JAN${suffix}`,
    );
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });

      if (seasonCode) {
        const policies = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          'SELECT id FROM lucky_draw_policies WHERE code = ?',
          `${seasonCode}M1_DRAW`,
        );
        const policyIds = policies.map((row) => row.id);
        if (policyIds.length) {
          const versions = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id FROM lucky_draw_policy_versions WHERE policyId IN (${policyIds.map(() => '?').join(',')})`,
            ...policyIds,
          );
          const versionIds = versions.map((row) => row.id);
          if (versionIds.length) {
            const draws = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
              `SELECT id FROM lucky_draw_instances WHERE policyVersionId IN (${versionIds.map(() => '?').join(',')})`,
              ...versionIds,
            );
            const drawIds = draws.map((row) => row.id);
            if (seasonId) {
              await prisma.$executeRawUnsafe('DELETE FROM owner_draw_runs WHERE seasonId = ?', seasonId);
            }
            if (drawIds.length) {
              await prisma.$executeRawUnsafe(
                `DELETE FROM lucky_draw_instances WHERE id IN (${drawIds.map(() => '?').join(',')})`,
                ...drawIds,
              );
            }
            await prisma.$executeRawUnsafe(
              `DELETE FROM lucky_draw_fulfillment_rules WHERE policyVersionId IN (${versionIds.map(() => '?').join(',')})`,
              ...versionIds,
            );
            await prisma.$executeRawUnsafe(
              `DELETE FROM lucky_draw_prize_tiers WHERE policyVersionId IN (${versionIds.map(() => '?').join(',')})`,
              ...versionIds,
            );
            await prisma.$executeRawUnsafe(
              `DELETE FROM lucky_draw_policy_versions WHERE id IN (${versionIds.map(() => '?').join(',')})`,
              ...versionIds,
            );
          }
          await prisma.$executeRawUnsafe(
            `DELETE FROM lucky_draw_policies WHERE id IN (${policyIds.map(() => '?').join(',')})`,
            ...policyIds,
          );
        }
      }

      if (seasonId) {
        await prisma.$executeRawUnsafe('DELETE FROM owner_season_prizes WHERE seasonId = ?', seasonId);
        await prisma.$executeRawUnsafe('DELETE FROM owner_seasons WHERE id = ?', seasonId);
      }
      await prisma.programVersion.deleteMany({ where: { id: { in: programVersionIds } } });
      await prisma.program.deleteMany({ where: { id: { in: programIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  it('enforces January third-Sunday recurrence, admin authorization, and exact replay semantics', async () => {
    const defaults = await prisma.$queryRawUnsafe<
      Array<{
        drawStartMonth: number;
        drawWeekOfMonth: number;
        drawWeekday: string;
        drawTimezone: string;
      }>
    >(
      'SELECT drawStartMonth, drawWeekOfMonth, drawWeekday, drawTimezone FROM owner_seasons WHERE id = ?',
      seasonId,
    );
    expect(defaults[0]).toMatchObject({
      drawStartMonth: 1,
      drawWeekOfMonth: 3,
      drawWeekday: 'SUNDAY',
      drawTimezone: 'Asia/Kolkata',
    });

    const validPayload = {
      monthNumber: 1,
      entryWindowStart: '2027-01-01T00:00:00+05:30',
      entryWindowEnd: '2027-01-16T23:00:00+05:30',
      drawAt: '2027-01-17T10:00:00+05:30',
      claimWindowDays: 30,
    };

    const memberDenied = await request(
      `/admin/owner-portal/seasons/${seasonId}/draws`,
      memberToken,
      { method: 'POST', body: JSON.stringify(validPayload) },
    );
    expect(memberDenied.status).toBe(403);

    const wrongSunday = await request(
      `/admin/owner-portal/seasons/${seasonId}/draws`,
      adminToken,
      {
        method: 'POST',
        body: JSON.stringify({
          ...validPayload,
          entryWindowEnd: '2027-01-09T23:00:00+05:30',
          drawAt: '2027-01-10T10:00:00+05:30',
        }),
      },
    );
    expect(wrongSunday.status).toBe(400);
    expect(String(wrongSunday.body.message)).toContain('3rd Sunday');

    const prepared = await request(
      `/admin/owner-portal/seasons/${seasonId}/draws`,
      adminToken,
      { method: 'POST', body: JSON.stringify(validPayload) },
    );
    expect(prepared.status).toBe(201);
    expect(prepared.body).toMatchObject({
      seasonId,
      monthNumber: 1,
      status: 'SCHEDULED',
    });
    const runId = String(prepared.body.id);
    expect(runId).toBeTruthy();

    const exactReplay = await request(
      `/admin/owner-portal/seasons/${seasonId}/draws`,
      adminToken,
      { method: 'POST', body: JSON.stringify(validPayload) },
    );
    expect(exactReplay.status).toBe(201);
    expect(String(exactReplay.body.id)).toBe(runId);

    const conflictingReplay = await request(
      `/admin/owner-portal/seasons/${seasonId}/draws`,
      adminToken,
      {
        method: 'POST',
        body: JSON.stringify({ ...validPayload, claimWindowDays: 31 }),
      },
    );
    expect(conflictingReplay.status).toBe(409);
    expect(String(conflictingReplay.body.message)).toContain('already prepared');

    const runs = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
      'SELECT COUNT(*) AS count FROM owner_draw_runs WHERE seasonId = ? AND monthNumber = 1',
      seasonId,
    );
    expect(Number(runs[0]?.count ?? 0)).toBe(1);
  });
});
