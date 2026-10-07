import { PrismaService } from '../src/database/prisma.service';

const TEST_STAFF_PREFIXES = [
  '__uat_verify_admin_',
  'orchestration_admin_',
  'domain_admin_',
  'ent_orch_admin_',
  'entitlement_admin_',
  'concurrency_admin_',
  'kyc_admin_',
  'draw_fulfillment_admin_',
  'draw_admin_',
  'completion_admin_',
  'owner_draw_admin_',
  'owner_flow_admin_',
  'season_roundtrip_admin_',
  'settlement_admin_',
  'presentation_admin_',
  'program_admin_',
  'refund_referral_admin_',
  'referral_admin_',
  'withdraw_admin_',
  'uat_owner_',
  'uat_admin_',
  'uat_agent_',
  'admin_epin_',
  'admin_created_',
] as const;

async function run() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing stale integration fixture cleanup in production');
  }

  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const candidates = await prisma.user.findMany({
      where: {
        AND: [
          {
            OR: TEST_STAFF_PREFIXES.map((prefix) => ({
              username: { startsWith: prefix },
            })),
          },
          {
            roles: {
              some: {
                role: {
                  name: { in: ['SUPER_ADMIN', 'ADMIN', 'AGENT'] },
                },
              },
            },
          },
        ],
      },
      select: {
        id: true,
        username: true,
        email: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const removable = candidates.filter(
      (user) => user.email === null || user.email.endsWith('@example.test'),
    );
    if (removable.length === 0) {
      console.log('MegaGoldenClub stale integration staff cleanup: no fixtures found');
      return;
    }

    const ids = removable.map((user) => user.id);
    await prisma.$transaction(async (tx) => {
      await tx.auditLog.deleteMany({
        where: {
          OR: [
            { actorUserId: { in: ids } },
            { entityId: { in: ids } },
          ],
        },
      });
      await tx.authSession.deleteMany({ where: { userId: { in: ids } } });
      await tx.userRole.deleteMany({ where: { userId: { in: ids } } });
      await tx.user.deleteMany({ where: { id: { in: ids } } });
    });

    console.log(
      `MegaGoldenClub stale integration staff cleanup: removed ${removable
        .map((user) => user.username)
        .join(', ')}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void run();
