import { randomInt } from 'node:crypto';

export async function generateRandomUsername(
  prefix: string,
  exists: (candidate: string) => Promise<boolean>,
  attempts = 32,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = `${prefix}${randomInt(100000, 1000000)}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error('Unable to generate a unique random username');
}
