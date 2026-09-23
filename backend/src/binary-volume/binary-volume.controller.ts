import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../rbac/permissions.decorator';
import {
  CreateBinaryVolumeEventDto,
  ReverseBinaryVolumeEventDto,
} from './binary-volume.dto';
import { BinaryVolumeService } from './binary-volume.service';

@Controller('admin/binary-volume')
export class BinaryVolumeController {
  constructor(private readonly volume: BinaryVolumeService) {}

  @Permissions('binary.volume.manage')
  @Post('events')
  createEvent(@Body() dto: CreateBinaryVolumeEventDto, @CurrentUser() actor: AuthUser) {
    return this.volume.createEvent(dto, actor.id);
  }

  @Permissions('binary.volume.manage')
  @Post('events/:eventId/reversal')
  reverseEvent(
    @Param('eventId') eventId: string,
    @Body() dto: ReverseBinaryVolumeEventDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.volume.reverseEvent(eventId, dto, actor.id);
  }

  @Permissions('binary.volume.read')
  @Get('events/:eventId')
  getEvent(@Param('eventId') eventId: string) {
    return this.volume.getEvent(eventId);
  }

  @Permissions('binary.volume.read')
  @Get('members/:userId')
  getMemberVolume(@Param('userId') userId: string) {
    return this.volume.getMemberVolume(userId);
  }
}
