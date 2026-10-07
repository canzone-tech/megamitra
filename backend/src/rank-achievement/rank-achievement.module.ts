import { Module } from '@nestjs/common';
import { RankAchievementController } from './rank-achievement.controller';
import { RankAchievementService, RankAchievementWorker } from './rank-achievement.service';

@Module({
  providers: [RankAchievementService, RankAchievementWorker],
  controllers: [RankAchievementController],
  exports: [RankAchievementService],
})
export class RankAchievementModule {}
