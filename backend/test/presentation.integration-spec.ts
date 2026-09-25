import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { UserStatus } from '../src/generated/prisma/enums';
import { DEFAULT_TEMPLATE, DEFAULT_THEME } from '../src/presentation/presentation-schema';

describe('MegaGoldenClub presentation configuration integration', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let baseUrl: string;
  let adminId = '';
  const definitionIds: string[] = [];
  const versionIds: string[] = [];

  async function request(path: string, token?: string, init: RequestInit = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
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
    if (prisma) {
      if (definitionIds.length) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM presentation_versions WHERE definitionId IN (${definitionIds.map(() => '?').join(',')})`,
          ...definitionIds,
        );
        await prisma.$executeRawUnsafe(
          `DELETE FROM presentation_definitions WHERE id IN (${definitionIds.map(() => '?').join(',')})`,
          ...definitionIds,
        );
      }
      if (adminId) {
        await prisma.auditLog.deleteMany({ where: { actorUserId: adminId } });
        await prisma.authSession.deleteMany({ where: { userId: adminId } });
        await prisma.userRole.deleteMany({ where: { userId: adminId } });
        await prisma.user.deleteMany({ where: { id: adminId } });
      }
    }
    if (versionIds.length) {
      const client = new MongoClient(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/megamitra');
      await client.connect();
      await client.db().collection('presentation_documents').deleteMany({ versionId: { $in: versionIds } });
      await client.close();
    }
    await app?.close();
  });

  it('publishes immutable versioned theme and shell configuration with public runtime fallback', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const password = 'Presentation-Test-123!';
    const admin = await prisma.user.create({
      data: {
        username: `presentation_admin_${suffix}`,
        passwordHash: await passwords.hash(password),
        status: UserStatus.ACTIVE,
      },
    });
    adminId = admin.id;
    const superAdmin = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: superAdmin.id } });

    const login = await request('/auth/login', undefined, {
      method: 'POST',
      body: JSON.stringify({ identifier: admin.username, password }),
    });
    expect(login.status).toBe(200);
    const token = String(login.body.accessToken);

    const themeDefinitionId = randomUUID();
    const templateDefinitionId = randomUUID();
    definitionIds.push(themeDefinitionId, templateDefinitionId);
    await prisma.$executeRawUnsafe(
      `INSERT INTO presentation_definitions
        (id, kind, surface, code, name, description, isDefault, createdAt, updatedAt)
       VALUES
        (?, 'THEME', 'AUTH', ?, 'Integration Theme', 'Integration-only theme', TRUE, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
        (?, 'TEMPLATE', 'AUTH', ?, 'Integration Template', 'Integration-only template', TRUE, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      themeDefinitionId,
      `AUTH_THEME_${suffix}`,
      templateDefinitionId,
      `AUTH_TEMPLATE_${suffix}`,
    );

    const initialRuntime = await request('/presentation/runtime?surface=AUTH');
    expect(initialRuntime.status).toBe(200);
    expect(initialRuntime.body.theme.source).toBe('DEFAULT');
    expect(initialRuntime.body.template.source).toBe('DEFAULT');

    const themeDraft = await request(`/admin/presentation/definitions/${themeDefinitionId}/versions`, token, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(themeDraft.status).toBe(201);
    versionIds.push(String(themeDraft.body.id));
    const themeContent = { ...DEFAULT_THEME, primary: '#123F8C', gradientFrom: '#123F8C' };
    expect(
      (
        await request(`/admin/presentation/versions/${themeDraft.body.id}`, token, {
          method: 'PUT',
          body: JSON.stringify({ content: themeContent }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(`/admin/presentation/versions/${themeDraft.body.id}/publish`, token, {
          method: 'POST',
          body: '{}',
        })
      ).status,
    ).toBe(201);

    const templateDraft = await request(`/admin/presentation/definitions/${templateDefinitionId}/versions`, token, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(templateDraft.status).toBe(201);
    versionIds.push(String(templateDraft.body.id));
    const templateContent = {
      ...DEFAULT_TEMPLATE,
      sidebarPosition: 'RIGHT',
      sidebarWidth: 'WIDE',
      sidebarStyle: 'BRAND',
      topbarStyle: 'DARK',
      topbarDensity: 'COMPACT',
    };
    await request(`/admin/presentation/versions/${templateDraft.body.id}`, token, {
      method: 'PUT',
      body: JSON.stringify({ content: templateContent }),
    });
    expect(
      (
        await request(`/admin/presentation/versions/${templateDraft.body.id}/publish`, token, {
          method: 'POST',
          body: '{}',
        })
      ).status,
    ).toBe(201);

    const runtime = await request('/presentation/runtime?surface=AUTH');
    expect(runtime.status).toBe(200);
    expect(runtime.body.theme.source).toBe('PUBLISHED');
    expect(runtime.body.theme.content.primary).toBe('#123F8C');
    expect(runtime.body.template.source).toBe('PUBLISHED');
    expect(runtime.body.template.content.sidebarPosition).toBe('RIGHT');
    expect(runtime.body.cms.source).toBe('DEFAULT');

    const immutable = await request(`/admin/presentation/versions/${themeDraft.body.id}`, token, {
      method: 'PUT',
      body: JSON.stringify({ content: { ...themeContent, accent: '#D97706' } }),
    });
    expect(immutable.status).toBe(409);

    const copiedDraft = await request(`/admin/presentation/definitions/${themeDefinitionId}/versions`, token, {
      method: 'POST',
      body: JSON.stringify({ copyFromVersionId: themeDraft.body.id }),
    });
    expect(copiedDraft.status).toBe(201);
    versionIds.push(String(copiedDraft.body.id));
    expect(copiedDraft.body.content.primary).toBe('#123F8C');
    await request(`/admin/presentation/versions/${copiedDraft.body.id}`, token, {
      method: 'PUT',
      body: JSON.stringify({ content: { ...themeContent, secondary: '#8A145B' } }),
    });
    await request(`/admin/presentation/versions/${copiedDraft.body.id}/publish`, token, {
      method: 'POST',
      body: '{}',
    });

    const versions = await request(`/admin/presentation/definitions/${themeDefinitionId}/versions`, token);
    expect(versions.status).toBe(200);
    expect(versions.body[0].lifecycle).toBe('PUBLISHED');
    expect(versions.body[1].lifecycle).toBe('RETIRED');

    const updatedRuntime = await request('/presentation/runtime?surface=AUTH');
    expect(updatedRuntime.body.theme.content.secondary).toBe('#8A145B');
    expect(updatedRuntime.body.theme.version).toBe(2);
  });
});
