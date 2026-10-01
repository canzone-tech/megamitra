import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/database/prisma.service';
import {
  generateLuckyDrawToken,
  isLuckyDrawToken,
} from '../src/lucky-draw/lucky-draw-token.util';

const DATABASE_TEST_TIMEOUT_MS = 20_000;

describe('MegaGoldenClub lucky draw token registry contract', () => {
  let prisma: PrismaService;
  const canaryTokens: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  }, DATABASE_TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (prisma && canaryTokens.length > 0) {
      // Isolated test cleanup only. Production/application workflows never delete issued tokens.
      const placeholders = canaryTokens.map(() => '?').join(',');
      await prisma.$executeRawUnsafe(
        `DELETE FROM lucky_draw_tokens WHERE token IN (${placeholders})`,
        ...canaryTokens,
      );
    }
    await prisma?.$disconnect();
  }, DATABASE_TEST_TIMEOUT_MS);

  async function freeToken() {
    for (let attempt = 0; attempt < 256; attempt += 1) {
      const token = generateLuckyDrawToken();
      const rows = await prisma.$queryRawUnsafe<Array<{ token: string }>>(
        'SELECT token FROM lucky_draw_tokens WHERE token=? LIMIT 1',
        token,
      );
      if (!rows[0]) return token;
    }
    throw new Error('Unable to find an unused lucky draw token for isolated contract test');
  }

  it(
    'enforces five non-zero-leading digits and global uniqueness at the database boundary',
    async () => {
      const token = await freeToken();
      const firstUserId = randomUUID();
      const secondUserId = randomUUID();

      expect(isLuckyDrawToken(token)).toBe(true);
      expect(token).toMatch(/^[1-9][0-9]{4}$/);

      await prisma.$executeRawUnsafe(
        `INSERT INTO lucky_draw_tokens
         (token, sourceType, userId, status, createdAt, usedAt)
         VALUES (?, 'DRAW_ENTRY', ?, 'USED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
        token,
        firstUserId,
      );
      canaryTokens.push(token);

      const stored = await prisma.$queryRawUnsafe<Array<{ token: string; userId: string }>>(
        'SELECT token, userId FROM lucky_draw_tokens WHERE token=? LIMIT 1',
        token,
      );
      expect(stored[0]).toEqual({ token, userId: firstUserId });

      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO lucky_draw_tokens
           (token, sourceType, userId, status, createdAt, usedAt)
           VALUES (?, 'DRAW_ENTRY', ?, 'USED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
          token,
          secondUserId,
        ),
      ).rejects.toThrow();

      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO lucky_draw_tokens
           (token, sourceType, userId, status, createdAt, usedAt)
           VALUES ('01234', 'DRAW_ENTRY', ?, 'USED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
          randomUUID(),
        ),
      ).rejects.toThrow();
    },
    DATABASE_TEST_TIMEOUT_MS,
  );
});
