import { Module } from '@nestjs/common';

import { PresentationModule } from '../presentation/presentation.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [PresentationModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
