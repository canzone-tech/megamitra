import { randomUUID } from 'node:crypto';
import { FinancialDbService } from '../src/database/financial-db.service';
import {
  generateLuckyDrawToken,
  isLuckyDrawToken,
} from '../src/lucky-draw/lucky-draw-token.util';

const DATABASE_TEST_TIMEOUT_MS = 20_000;

describe('MegaGoldenClub lucky draw token registry contract', () => {
  const db = new FinancialDbService();
  const canaryTokens: string[] = [];

  afterAll(async () => {
    if (canaryTokens.length > 0) {
      // Isolated test cleanup only. Production/application workflows never delete issued tokens.
      const placeholders = canaryTokens.map(() => '?').join(',');
      await db.execute(
        `DELETE FROM lucky_draw_tokens WHERE token IN (${placeholders})`,
        canaryTokens,
      );
    }
    await db.onModuleDestroy();
  }, DATABASE_TEST_TIMEOUT_MS);

  async function insertUnusedToken(userId: string) {
    for (let attempt = 0; attempt < 256; attempt += 1) {
      const token = generateLuckyDrawToken();
      try {
        await db.execute(
          `INSERT INTO lucky_draw_tokens
           (token, sourceType, userId, status, createdAt, usedAt)
           VALUES (?, 'DRAW_ENTRY', ?, 'USED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
          [token, userId],
        );
        canaryTokens.push(token);
        return token;
      } catch (error) {
        if ((error as { code?: string }).code === 'ER_DUP_ENTRY') continue;
        throw error;
      }
    }
    throw new Error('Unable to reserve an unused lucky draw token for isolated contract test');
  }

  it(
    'enforces five non-zero-leading digits and global uniqueness at the database boundary',
    async () => {
      const firstUserId = randomUUID();
      const secondUserId = randomUUID();
      const token = await insertUnusedToken(firstUserId);

      expect(isLuckyDrawToken(token)).toBe(true);
      expect(token).toMatch(/^[1-9][0-9]{4}$/);

      await expect(
        db.execute(
          `INSERT INTO lucky_draw_tokens
           (token, sourceType, userId, status, createdAt, usedAt)
           VALUES (?, 'DRAW_ENTRY', ?, 'USED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
          [token, secondUserId],
        ),
      ).rejects.toThrow();

      await expect(
        db.execute(
          `INSERT INTO lucky_draw_tokens
           (token, sourceType, userId, status, createdAt, usedAt)
           VALUES ('01234', 'DRAW_ENTRY', ?, 'USED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
          [randomUUID()],
        ),
      ).rejects.toThrow();
    },
    DATABASE_TEST_TIMEOUT_MS,
  );
});
