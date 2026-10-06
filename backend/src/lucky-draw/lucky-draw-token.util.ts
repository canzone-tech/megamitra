import { randomInt } from 'node:crypto';

export const LUCKY_DRAW_TOKEN_MIN = 10_000;
export const LUCKY_DRAW_TOKEN_MAX_EXCLUSIVE = 100_000;
export const LUCKY_DRAW_TOKEN_COLLISION_RETRIES = 128;

export function generateLuckyDrawToken() {
  return randomInt(LUCKY_DRAW_TOKEN_MIN, LUCKY_DRAW_TOKEN_MAX_EXCLUSIVE).toString();
}

export function isLuckyDrawToken(value: string) {
  return /^[1-9][0-9]{4}$/.test(value);
}

/**
 * Human-readable reference for a permanent, season-scoped lucky-draw token.
 * Never generate or substitute a token for display; use the stored one only.
 */
export function printedLuckyDrawTokenReference(
  seasonCode: string | null | undefined,
  installmentSequence: number | null | undefined,
  token: string,
): string | null {
  if (!seasonCode || !/^[A-Z0-9][A-Z0-9_-]{1,49}$/.test(seasonCode)) return null;
  if (typeof installmentSequence !== 'number' || !Number.isSafeInteger(installmentSequence) || installmentSequence < 1) return null;
  if (!isLuckyDrawToken(token)) return null;
  return `${seasonCode}-M${String(installmentSequence).padStart(2, '0')}-${token}`;
}
