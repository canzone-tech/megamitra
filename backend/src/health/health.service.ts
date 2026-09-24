import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { PresentationDocumentStore } from '../presentation/presentation-document.store';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly presentationStore: PresentationDocumentStore,
  ) {}

  live() {
    return {
      status: 'ok',
      service: 'megamitra-api',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  async ready() {
    const startedAt = Date.now();
    const [mysqlResult, redisResult, mongoResult] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.ping(),
      this.presentationStore.ping(),
    ]);

    const mysqlUp = mysqlResult.status === 'fulfilled';
    const redisUp = redisResult.status === 'fulfilled' && redisResult.value === true;
    const mongodbUp = mongoResult.status === 'fulfilled' && mongoResult.value === true;
    const ready = mysqlUp && redisUp && mongodbUp;

    return {
      status: ready ? 'ok' : 'degraded',
      service: 'megamitra-api',
      services: {
        mysql: mysqlUp ? 'up' : 'down',
        redis: redisUp ? 'up' : 'down',
        mongodb: mongodbUp ? 'up' : 'down',
      },
      timestamp: new Date().toISOString(),
      responseTimeMs: Date.now() - startedAt,
    };
  }
}
