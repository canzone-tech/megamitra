import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createHash, randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { UserIdentifierType, UserStatus } from '../src/generated/prisma/enums';
import { PasswordService } from '../src/auth/password.service';

type ExtensionSnapshot = {
  passwordResetEnabled: number | boolean;
  emailVerificationEnabled: number | boolean;
  emailVerificationRequiredForLogin: number | boolean;
  emailChangeEnabled: number | boolean;
};

describe('MegaMitra auth recovery and email verification integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let baseUrl: string;
  let userId = '';
  let originalExtension: ExtensionSnapshot;

  async function request(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: Record<string, any> }> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const body = (await response.json()) as Record<string, any>;
    return { status: response.status, body };
  }

  function tokenHash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  async function insertToken(
    purpose: 'PASSWORD_RESET' | 'EMAIL_VERIFICATION' | 'EMAIL_CHANGE',
    rawToken: string,
    targetEmail: string | null,
  ) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO auth_action_tokens (
         id, userId, purpose, tokenHash, targetEmail, expiresAt, createdAt
       ) VALUES (?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 30 MINUTE), CURRENT_TIMESTAMP(3))`,
      randomUUID(),
      userId,
      purpose,
      tokenHash(rawToken),
      targetEmail,
    );
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    passwords = app.get(PasswordService);

    const extensionRows = await prisma.$queryRawUnsafe<ExtensionSnapshot[]>(
      `SELECT passwordResetEnabled, emailVerificationEnabled,
              emailVerificationRequiredForLogin, emailChangeEnabled
       FROM system_auth_config WHERE id = 1`,
    );
    originalExtension = extensionRows[0];

    await prisma.$executeRawUnsafe(
      `UPDATE system_auth_config
       SET passwordResetEnabled = TRUE,
           emailVerificationEnabled = TRUE,
           emailVerificationRequiredForLogin = TRUE,
           emailChangeEnabled = TRUE
       WHERE id = 1`,
    );

    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    const email = `auth_${suffix}@example.test`;
    const passwordHash = await passwords.hash('Recovery-Original-123!');
    const user = await prisma.user.create({
      data: {
        username: `auth_${suffix}`,
        email,
        passwordHash,
        status: UserStatus.ACTIVE,
      },
    });
    userId = user.id;
    const memberRole = await prisma.role.findUniqueOrThrow({ where: { name: 'MEMBER' } });
    await prisma.userRole.create({ data: { userId, roleId: memberRole.id } });
    await prisma.userIdentifierClaim.create({
      data: {
        userId,
        type: UserIdentifierType.EMAIL,
        normalizedValue: email,
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      if (userId) {
        await prisma.auditLog.deleteMany({
          where: {
            OR: [{ actorUserId: userId }, { entityId: userId }],
          },
        });
        await prisma.user.deleteMany({ where: { id: userId } });
      }
      await prisma.$executeRawUnsafe(
        `UPDATE system_auth_config
         SET passwordResetEnabled = ?, emailVerificationEnabled = ?,
             emailVerificationRequiredForLogin = ?, emailChangeEnabled = ?
         WHERE id = 1`,
        originalExtension.passwordResetEnabled,
        originalExtension.emailVerificationEnabled,
        originalExtension.emailVerificationRequiredForLogin,
        originalExtension.emailChangeEnabled,
      );
    }
    if (app) await app.close();
  });

  it('enforces verification, resets password once, and changes email with immutable token consumption', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const originalEmail = String(user.email);

    const blockedLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: originalEmail, password: 'Recovery-Original-123!' }),
    });
    expect(blockedLogin.status).toBe(403);
    expect(String(blockedLogin.body.message)).toContain('verification');

    const verificationToken = `verify_${randomUUID()}_${randomUUID()}`;
    await insertToken('EMAIL_VERIFICATION', verificationToken, originalEmail);
    const verified = await request('/auth/email-verification/confirm', {
      method: 'POST',
      body: JSON.stringify({ token: verificationToken }),
    });
    expect(verified.status).toBe(200);
    expect(verified.body.emailVerified).toBe(true);

    const login = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: originalEmail, password: 'Recovery-Original-123!' }),
    });
    expect(login.status).toBe(200);
    expect(typeof login.body.accessToken).toBe('string');

    const resetToken = `reset_${randomUUID()}_${randomUUID()}`;
    await insertToken('PASSWORD_RESET', resetToken, null);
    const reset = await request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: resetToken, newPassword: 'Recovery-New-456!' }),
    });
    expect(reset.status).toBe(200);
    expect(reset.body.sessionsRevoked).toBe(true);

    const oldSession = await request('/auth/me', {
      headers: { authorization: `Bearer ${login.body.accessToken}` },
    });
    expect(oldSession.status).toBe(401);

    const resetReplay = await request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: resetToken, newPassword: 'Recovery-New-789!' }),
    });
    expect(resetReplay.status).toBe(400);

    const loginAfterReset = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: originalEmail, password: 'Recovery-New-456!' }),
    });
    expect(loginAfterReset.status).toBe(200);

    const newEmail = `changed_${randomUUID().replaceAll('-', '').slice(0, 16)}@example.test`;
    const changeToken = `change_${randomUUID()}_${randomUUID()}`;
    await insertToken('EMAIL_CHANGE', changeToken, newEmail);
    const changed = await request('/auth/email-change/confirm', {
      method: 'POST',
      body: JSON.stringify({ token: changeToken }),
    });
    expect(changed.status).toBe(200);
    expect(changed.body.emailChanged).toBe(true);
    expect(changed.body.sessionsRevoked).toBe(true);

    const changedUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(changedUser.email).toBe(newEmail);
    expect(changedUser.emailVerifiedAt).not.toBeNull();
    const emailClaim = await prisma.userIdentifierClaim.findFirst({
      where: { userId, type: UserIdentifierType.EMAIL },
    });
    expect(emailClaim?.normalizedValue).toBe(newEmail);

    const sessionBeforeEmailChange = await request('/auth/me', {
      headers: { authorization: `Bearer ${loginAfterReset.body.accessToken}` },
    });
    expect(sessionBeforeEmailChange.status).toBe(401);

    const loginWithNewEmail = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: newEmail, password: 'Recovery-New-456!' }),
    });
    expect(loginWithNewEmail.status).toBe(200);

    const verifyReplay = await request('/auth/email-verification/confirm', {
      method: 'POST',
      body: JSON.stringify({ token: verificationToken }),
    });
    expect(verifyReplay.status).toBe(400);
  });

  it('does not disclose whether a forgot-password email belongs to an account', async () => {
    const existing = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const known = await request('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: existing.email }),
    });
    const unknown = await request('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: `missing_${randomUUID()}@example.test` }),
    });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(known.body.accepted).toBe(true);
  });
});
