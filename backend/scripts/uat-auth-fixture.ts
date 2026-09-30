import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { NestFactory } from '@nestjs/core';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { PrismaService } from '../src/database/prisma.service';
import { RoleStatus, UserStatus } from '../src/generated/prisma/enums';

const FIXTURE_KIND = 'megagoldenclub-uat-auth-v1';

type FixturePrincipal = {
  userId: string;
  sessionId: string;
  accessToken: string;
};

type FixtureState = {
  kind: typeof FIXTURE_KIND;
  admin: FixturePrincipal;
  member: FixturePrincipal;
};

function refreshHash() {
  return createHash('sha256').update(randomBytes(32)).digest('hex');
}

async function loadState(path: string): Promise<FixtureState> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<FixtureState>;
  if (
    parsed.kind !== FIXTURE_KIND ||
    !parsed.admin?.userId ||
    !parsed.admin.sessionId ||
    !parsed.member?.userId ||
    !parsed.member.sessionId
  ) {
    throw new Error('Invalid MegaGoldenClub UAT auth fixture state');
  }
  return parsed as FixtureState;
}

async function run() {
  const action = process.argv[2];
  const statePath = process.argv[3];
  if (!statePath || (action !== 'create' && action !== 'cleanup')) {
    throw new Error('Usage: ts-node scripts/uat-auth-fixture.ts <create|cleanup> <state-file>');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);

  try {
    if (action === 'cleanup') {
      const state = await loadState(statePath);
      const userIds = [state.admin.userId, state.member.userId];
      const sessionIds = [state.admin.sessionId, state.member.sessionId];
      await prisma.$transaction([
        prisma.authSession.deleteMany({ where: { id: { in: sessionIds } } }),
        prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }),
        prisma.user.deleteMany({ where: { id: { in: userIds } } }),
      ]);
      console.log('MegaGoldenClub authenticated UAT fixture cleaned');
      return;
    }

    const jwt = app.get(JwtService);
    const config = app.get(ConfigService);
    const passwords = app.get(PasswordService);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60_000);
    const createdUserIds: string[] = [];

    try {
      const [superAdminRole, memberRole] = await Promise.all([
        prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } }),
        prisma.role.findUnique({ where: { name: 'MEMBER' } }),
      ]);
      if (!superAdminRole || superAdminRole.status !== RoleStatus.ACTIVE) {
        throw new Error('Active SUPER_ADMIN role is required for authenticated UAT');
      }
      if (!memberRole || memberRole.status !== RoleStatus.ACTIVE) {
        throw new Error('Active MEMBER role is required for authenticated UAT');
      }

      const [adminPasswordHash, memberPasswordHash] = await Promise.all([
        passwords.hash(randomBytes(32).toString('base64url')),
        passwords.hash(randomBytes(32).toString('base64url')),
      ]);
      const adminSessionId = randomUUID();
      const memberSessionId = randomUUID();

      const created = await prisma.$transaction(async (tx) => {
        const admin = await tx.user.create({
          data: {
            username: `__uat_verify_admin_${suffix}`,
            email: `uat-verify-admin-${suffix}@example.test`,
            passwordHash: adminPasswordHash,
            firstName: 'UAT',
            lastName: 'Admin',
            status: UserStatus.ACTIVE,
            emailVerifiedAt: now,
          },
        });
        createdUserIds.push(admin.id);
        const member = await tx.user.create({
          data: {
            username: `__uat_verify_member_${suffix}`,
            email: `uat-verify-member-${suffix}@example.test`,
            passwordHash: memberPasswordHash,
            firstName: 'UAT',
            lastName: 'Member',
            status: UserStatus.ACTIVE,
            emailVerifiedAt: now,
          },
        });
        createdUserIds.push(member.id);

        await tx.userRole.createMany({
          data: [
            { userId: admin.id, roleId: superAdminRole.id },
            { userId: member.id, roleId: memberRole.id },
          ],
        });
        await tx.authSession.createMany({
          data: [
            {
              id: adminSessionId,
              userId: admin.id,
              refreshTokenHash: refreshHash(),
              expiresAt,
              lastSeenAt: now,
              absoluteExpiresAt: expiresAt,
            },
            {
              id: memberSessionId,
              userId: member.id,
              refreshTokenHash: refreshHash(),
              expiresAt,
              lastSeenAt: now,
              absoluteExpiresAt: expiresAt,
            },
          ],
        });
        return { admin, member };
      });

      const signAccess = (userId: string, sessionId: string) =>
        jwt.signAsync(
          { sub: userId, sid: sessionId, typ: 'access' },
          {
            secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
            issuer: 'megagoldenclub-api',
            audience: 'megagoldenclub-clients',
            expiresIn: 10 * 60,
          },
        );
      const [adminAccessToken, memberAccessToken] = await Promise.all([
        signAccess(created.admin.id, adminSessionId),
        signAccess(created.member.id, memberSessionId),
      ]);

      const state: FixtureState = {
        kind: FIXTURE_KIND,
        admin: {
          userId: created.admin.id,
          sessionId: adminSessionId,
          accessToken: adminAccessToken,
        },
        member: {
          userId: created.member.id,
          sessionId: memberSessionId,
          accessToken: memberAccessToken,
        },
      };
      await writeFile(statePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
      console.log('MegaGoldenClub authenticated UAT fixture ready');
    } catch (error) {
      if (createdUserIds.length) {
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
      throw error;
    }
  } finally {
    await app.close();
  }
}

void run();
