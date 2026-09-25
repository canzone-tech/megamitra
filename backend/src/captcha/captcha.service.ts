import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class CaptchaService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async createChallenge() {
    const left = randomInt(1, 10);
    const right = randomInt(1, 10);
    const id = randomUUID();
    const answer = String(left + right);
    const authConfig = await this.prisma.systemAuthConfig.findUniqueOrThrow({ where: { id: 1 } });
    const ttl = authConfig.captchaTtlSeconds;

    await this.redis.getClient().set(
      this.key(id),
      this.digest(answer),
      'EX',
      ttl,
    );

    return {
      captchaId: id,
      prompt: `${left} + ${right} = ?`,
      expiresInSeconds: ttl,
    };
  }

  async verify(id?: string, answer?: string): Promise<boolean> {
    if (!id || !answer) return false;

    const raw = await this.redis.getClient().call('GETDEL', this.key(id));
    if (typeof raw !== 'string') return false;

    const actual = Buffer.from(raw, 'hex');
    const expected = Buffer.from(this.digest(answer.trim()), 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private key(id: string): string {
    return `megagoldenclub:captcha:v1:${id}`;
  }

  private digest(value: string): string {
    return createHmac('sha256', this.config.getOrThrow<string>('CAPTCHA_HMAC_SECRET'))
      .update(value)
      .digest('hex');
  }
}
