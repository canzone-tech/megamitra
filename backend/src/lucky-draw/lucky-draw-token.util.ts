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
