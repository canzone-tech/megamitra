import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  generateLuckyDrawToken,
  isLuckyDrawToken,
  LUCKY_DRAW_TOKEN_MAX_EXCLUSIVE,
  LUCKY_DRAW_TOKEN_MIN,
} from '../src/lucky-draw/lucky-draw-token.util';

const TOKEN_MIGRATION_PATH = resolve(
  __dirname,
  '../prisma/migrations/0029_global_lucky_draw_tokens/migration.sql',
);

describe('MegaGoldenClub lucky draw token registry contract', () => {
  const migrationSql = readFileSync(TOKEN_MIGRATION_PATH, 'utf8');

  it('locks five non-zero-leading digits and global never-reuse in the immutable migration', () => {
    expect(migrationSql).toContain('`token` CHAR(5) NOT NULL');
    expect(migrationSql).toContain('PRIMARY KEY (`token`)');
    expect(migrationSql).toContain(
      "CONSTRAINT `lucky_draw_tokens_format_check` CHECK (`token` REGEXP '^[1-9][0-9]{4}$')",
    );
    expect(migrationSql).toContain(
      'The primary key is the global never-reuse guarantee across every session and draw.',
    );
  });

  it('generates only valid five-digit tokens in the 10000-99999 namespace', () => {
    expect(LUCKY_DRAW_TOKEN_MIN).toBe(10_000);
    expect(LUCKY_DRAW_TOKEN_MAX_EXCLUSIVE).toBe(100_000);

    for (let sample = 0; sample < 512; sample += 1) {
      const token = generateLuckyDrawToken();
      const numericToken = Number(token);

      expect(isLuckyDrawToken(token)).toBe(true);
      expect(token).toMatch(/^[1-9][0-9]{4}$/);
      expect(numericToken).toBeGreaterThanOrEqual(LUCKY_DRAW_TOKEN_MIN);
      expect(numericToken).toBeLessThan(LUCKY_DRAW_TOKEN_MAX_EXCLUSIVE);
    }
  });
});
