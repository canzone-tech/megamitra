import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../rbac/permissions.decorator';
import {
  CreateBinaryQualifyingUnitDto,
  ReverseBinaryQualifyingUnitDto,
} from './binary-unit.dto';
import { BinaryUnitService } from './binary-unit.service';

@Controller('admin/binary-units')
export class BinaryUnitController {
  constructor(private readonly units: BinaryUnitService) {}

  @Permissions('binary.unit.manage')
  @Post('events')
  createEvent(@Body() dto: CreateBinaryQualifyingUnitDto, @CurrentUser() actor: AuthUser) {
    return this.units.createEvent(dto, actor.id);
  }

  @Permissions('binary.unit.manage')
  @Post('events/:eventId/reversal')
  reverseEvent(
    @Param('eventId') eventId: string,
    @Body() dto: ReverseBinaryQualifyingUnitDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.units.reverseEvent(eventId, dto, actor.id);
  }

  @Permissions('binary.unit.read')
  @Get('events/:eventId')
  getEvent(@Param('eventId') eventId: string) {
    return this.units.getEvent(eventId);
  }

  @Permissions('binary.unit.read')
  @Get('members/:userId')
  getMemberUnits(@Param('userId') userId: string) {
    return this.units.getMemberUnits(userId);
  }
}
