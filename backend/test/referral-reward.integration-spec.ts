import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import {
  ReferralRewardMode,
  ReferralRoundingMode,
  UserStatus,
} from '../src/generated/prisma/enums';

describe('MegaGoldenClub referral reward integration', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let baseUrl: string;
  let accessToken: string;
  const userIds: string[] = [];
  const policyIds: string[] = [];
  const versionIds: string[] = [];
  const eventIds: string[] = [];
  const ledgerTransactionIds: string[] = [];

  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  }

  function authenticated(init: RequestInit = {}): RequestInit {
    return {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(init.headers ?? {}),
      },
    };
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    passwords = app.get(PasswordService);

    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const username = `referral_admin_${suffix}`;
    const password = 'Referral-Integration-Pass-123!';
    const admin = await prisma.user.create({
      data: {
        username,
        passwordHash: await passwords.hash(password),
        status: UserStatus.ACTIVE,
      },
    });
    userIds.push(admin.id);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: role.id } });

    const login = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: username, password }),
    });
    expect(login.status).toBe(200);
    accessToken = String(login.body.accessToken);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { actorUserId: { in: userIds } },
            { entityId: { in: [...userIds, ...policyIds, ...versionIds, ...eventIds] } },
          ],
        },
      });
      await prisma.referralRewardEvent.deleteMany({ where: { id: { in: eventIds } } });
      await prisma.ledgerEntry.deleteMany({
        where: { transactionId: { in: ledgerTransactionIds } },
      });
      await prisma.ledgerTransaction.deleteMany({
        where: { id: { in: ledgerTransactionIds } },
      });
      await prisma.ledgerAccount.deleteMany({ where: { ownerUserId: { in: userIds } } });
      await prisma.referralRewardPolicyVersion.deleteMany({
        where: { id: { in: versionIds } },
      });
      await prisma.referralRewardPolicy.deleteMany({ where: { id: { in: policyIds } } });
      await prisma.sponsorRelationship.deleteMany({
        where: {
          OR: [{ memberUserId: { in: userIds } }, { sponsorUserId: { in: userIds } }],
        },
      });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  it('versions referral rules and posts only eligible rewards through balanced ledger entries', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const [sponsor, referred, pendingReferred, fixedReferred] = await Promise.all([
      prisma.user.create({
        data: {
          username: `sponsor_${suffix}`,
          passwordHash: 'integration-not-used',
          status: UserStatus.ACTIVE,
        },
      }),
      prisma.user.create({
        data: {
          username: `referred_${suffix}`,
          passwordHash: 'integration-not-used',
          status: UserStatus.ACTIVE,
        },
      }),
      prisma.user.create({
        data: {
          username: `pending_${suffix}`,
          passwordHash: 'integration-not-used',
          status: UserStatus.PENDING,
        },
      }),
      prisma.user.create({
        data: {
          username: `fixed_${suffix}`,
          passwordHash: 'integration-not-used',
          status: UserStatus.ACTIVE,
        },
      }),
    ]);
    userIds.push(sponsor.id, referred.id, pendingReferred.id, fixedReferred.id);

    for (const memberUserId of [referred.id, pendingReferred.id, fixedReferred.id]) {
      const assigned = await request(
        '/admin/genealogy/sponsors',
        authenticated({
          method: 'POST',
          body: JSON.stringify({ memberUserId, sponsorUserId: sponsor.id }),
        }),
      );
      expect(assigned.status).toBe(201);
    }

    const percentagePolicy = await request(
      '/admin/referral-reward-policies',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          code: `RP${suffix}`,
          name: `Referral percentage ${suffix}`,
        }),
      }),
    );
    expect(percentagePolicy.status).toBe(201);
    const percentagePolicyId = String(percentagePolicy.body.id);
    policyIds.push(percentagePolicyId);

    const percentageDraft = await request(
      `/admin/referral-reward-policies/${percentagePolicyId}/versions`,
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
          rewardMode: ReferralRewardMode.PERCENTAGE,
          percentageRate: '7.5000',
          currencyCode: 'INR',
          roundingMode: ReferralRoundingMode.HALF_UP,
          eligibilityRules: {
            sponsorStatuses: [UserStatus.ACTIVE],
            referredStatuses: [UserStatus.ACTIVE],
            minimumBasisAmount: '100.00',
          },
        }),
      }),
    );
    expect(percentageDraft.status).toBe(201);
    const percentageVersionId = String(percentageDraft.body.id);
    versionIds.push(percentageVersionId);

    const published = await request(
      `/admin/referral-reward-policies/versions/${percentageVersionId}/publish`,
      authenticated({ method: 'POST' }),
    );
    expect(published.status).toBe(201);
    expect(published.body.lifecycle).toBe('PUBLISHED');

    const immutable = await request(
      `/admin/referral-reward-policies/versions/${percentageVersionId}`,
      authenticated({
        method: 'PATCH',
        body: JSON.stringify({ percentageRate: '99.0000' }),
      }),
    );
    expect(immutable.status).toBe(409);

    const occurredAt = new Date().toISOString();
    const sourceKey = `referral-percentage-${suffix}`;
    const reward = await request(
      '/admin/referral-rewards/events',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey,
          referredUserId: referred.id,
          policyVersionId: percentageVersionId,
          basisAmount: '333.33',
          currencyCode: 'INR',
          occurredAt,
        }),
      }),
    );
    expect(reward.status).toBe(201);
    expect(reward.body.idempotent).toBe(false);
    const rewardEvent = reward.body.event as {
      id: string;
      sponsorUserId: string;
      referredUserId: string;
      eligible: boolean;
      status: string;
      rewardAmount: string;
      ledgerTransactionId: string;
    };
    eventIds.push(rewardEvent.id);
    ledgerTransactionIds.push(rewardEvent.ledgerTransactionId);
    expect(rewardEvent.sponsorUserId).toBe(sponsor.id);
    expect(rewardEvent.referredUserId).toBe(referred.id);
    expect(rewardEvent.eligible).toBe(true);
    expect(rewardEvent.status).toBe('POSTED');
    expect(Number(rewardEvent.rewardAmount)).toBe(25);

    const duplicate = await request(
      '/admin/referral-rewards/events',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey,
          referredUserId: referred.id,
          policyVersionId: percentageVersionId,
          basisAmount: '333.33',
          currencyCode: 'INR',
          occurredAt,
        }),
      }),
    );
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.idempotent).toBe(true);

    const conflictingDuplicate = await request(
      '/admin/referral-rewards/events',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey,
          referredUserId: referred.id,
          policyVersionId: percentageVersionId,
          basisAmount: '400.00',
          currencyCode: 'INR',
          occurredAt,
        }),
      }),
    );
    expect(conflictingDuplicate.status).toBe(409);

    const ledger = await request(
      `/admin/ledger/transactions/${rewardEvent.ledgerTransactionId}`,
      authenticated(),
    );
    expect(ledger.status).toBe(200);
    expect(ledger.body.balanced).toBe(true);
    expect(Number(ledger.body.debitTotal)).toBe(25);
    expect(Number(ledger.body.creditTotal)).toBe(25);

    const wallet = await request(
      `/admin/ledger/wallets/users/${sponsor.id}/INR`,
      authenticated(),
    );
    expect(wallet.status).toBe(200);
    expect(Number(wallet.body.balance)).toBe(25);

    const ineligible = await request(
      '/admin/referral-rewards/events',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `referral-ineligible-${suffix}`,
          referredUserId: pendingReferred.id,
          policyVersionId: percentageVersionId,
          basisAmount: '500.00',
          currencyCode: 'INR',
          occurredAt: new Date(Date.now() + 1_000).toISOString(),
        }),
      }),
    );
    expect(ineligible.status).toBe(201);
    const ineligibleEvent = ineligible.body.event as {
      id: string;
      eligible: boolean;
      status: string;
      rewardAmount: string;
      ledgerTransactionId: string | null;
      eligibilitySnapshot: { reasonCodes: string[] };
    };
    eventIds.push(ineligibleEvent.id);
    expect(ineligibleEvent.eligible).toBe(false);
    expect(ineligibleEvent.status).toBe('INELIGIBLE');
    expect(Number(ineligibleEvent.rewardAmount)).toBe(0);
    expect(ineligibleEvent.ledgerTransactionId).toBeNull();
    expect(ineligibleEvent.eligibilitySnapshot.reasonCodes).toContain(
      'REFERRED_STATUS_NOT_ELIGIBLE',
    );

    const fixedPolicy = await request(
      '/admin/referral-reward-policies',
      authenticated({
        method: 'POST',
        body: JSON.stringify({ code: `RF${suffix}`, name: `Referral fixed ${suffix}` }),
      }),
    );
    expect(fixedPolicy.status).toBe(201);
    const fixedPolicyId = String(fixedPolicy.body.id);
    policyIds.push(fixedPolicyId);

    const fixedDraft = await request(
      `/admin/referral-reward-policies/${fixedPolicyId}/versions`,
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
          rewardMode: ReferralRewardMode.FIXED,
          fixedAmount: '12.34',
          currencyCode: 'INR',
          roundingMode: ReferralRoundingMode.HALF_UP,
        }),
      }),
    );
    expect(fixedDraft.status).toBe(201);
    const fixedVersionId = String(fixedDraft.body.id);
    versionIds.push(fixedVersionId);
    expect(
      (
        await request(
          `/admin/referral-reward-policies/versions/${fixedVersionId}/publish`,
          authenticated({ method: 'POST' }),
        )
      ).status,
    ).toBe(201);

    const fixedReward = await request(
      '/admin/referral-rewards/events',
      authenticated({
        method: 'POST',
        body: JSON.stringify({
          sourceKey: `referral-fixed-${suffix}`,
          referredUserId: fixedReferred.id,
          policyVersionId: fixedVersionId,
          basisAmount: '1.00',
          currencyCode: 'INR',
          occurredAt: new Date(Date.now() + 2_000).toISOString(),
        }),
      }),
    );
    expect(fixedReward.status).toBe(201);
    const fixedEvent = fixedReward.body.event as {
      id: string;
      rewardAmount: string;
      ledgerTransactionId: string;
    };
    eventIds.push(fixedEvent.id);
    ledgerTransactionIds.push(fixedEvent.ledgerTransactionId);
    expect(Number(fixedEvent.rewardAmount)).toBe(12.34);

    const walletAfter = await request(
      `/admin/ledger/wallets/users/${sponsor.id}/INR`,
      authenticated(),
    );
    expect(Number(walletAfter.body.balance)).toBe(37.34);
  });
});
