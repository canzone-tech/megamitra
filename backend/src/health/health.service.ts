import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async check() {
    const startedAt = Date.now();

    await this.prisma.$queryRaw`SELECT 1`;
    const redisUp = await this.redis.ping();

    return {
      status: redisUp ? 'ok' : 'degraded',
      service: 'megamitra-api',
      services: {
        mysql: 'up',
        redis: redisUp ? 'up' : 'down',
      },
      timestamp: new Date().toISOString(),
      responseTimeMs: Date.now() - startedAt,
    };
  }
}
