import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { UserStatus } from '../src/generated/prisma/enums';

describe('MegaMitra operational completion integration', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let baseUrl: string;
  const userIds: string[] = [];

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
      body: (await response.json()) as Record<string, unknown>,
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
  });

  afterAll(async () => {
    if (prisma && userIds.length) {
      await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  it('protects and serves source-backed operational completion queues without new state', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const password = 'Operational-Completion-Pass-123!';
    const passwordHash = await passwords.hash(password);
    const [admin, member] = await Promise.all([
      prisma.user.create({
        data: {
          username: `completion_admin_${suffix}`,
          passwordHash,
          status: UserStatus.ACTIVE,
        },
      }),
      prisma.user.create({
        data: {
          username: `completion_member_${suffix}`,
          passwordHash,
          status: UserStatus.ACTIVE,
        },
      }),
    ]);
    userIds.push(admin.id, member.id);

    const superAdmin = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: superAdmin.id } });

    const [adminToken, memberToken] = await Promise.all([
      login(admin.username, password),
      login(member.username, password),
    ]);

    expect((await request('/admin/operations/completion-summary', memberToken)).status).toBe(403);

    const summary = await request('/admin/operations/completion-summary', adminToken);
    expect(summary.status).toBe(200);
    expect(summary.body).toHaveProperty('refundReconciliationAttention');
    expect(summary.body).toHaveProperty('withdrawalAttention');
    expect(summary.body).toHaveProperty('failedPayouts');
    expect(summary.body).toHaveProperty('entitlementFulfillmentAttention');
    expect(summary.body).toHaveProperty('failedProductFulfillments');

    for (const path of [
      '/admin/operations/refunds?limit=5',
      '/admin/operations/withdrawal-attention?limit=5',
      '/admin/operations/entitlement-attention?limit=5',
      '/admin/operations/history?limit=5',
    ]) {
      const response = await request(path, adminToken);
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('items');
      expect(response.body).toHaveProperty('total');
    }

    expect((await request('/admin/operations/refunds?limit=101', adminToken)).status).toBe(400);
  });
});
