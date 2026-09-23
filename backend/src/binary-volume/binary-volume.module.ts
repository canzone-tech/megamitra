import { Module } from '@nestjs/common';
import { BinaryVolumeController } from './binary-volume.controller';
import { BinaryVolumeService } from './binary-volume.service';

@Module({
  controllers: [BinaryVolumeController],
  providers: [BinaryVolumeService],
  exports: [BinaryVolumeService],
})
export class BinaryVolumeModule {}
