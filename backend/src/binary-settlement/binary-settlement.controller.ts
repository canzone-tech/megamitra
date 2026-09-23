import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../rbac/permissions.decorator';
import { RunBinaryPairSettlementDto } from './binary-settlement.dto';
import { BinarySettlementService } from './binary-settlement.service';

@Controller('admin/binary-settlements')
export class BinarySettlementController {
  constructor(private readonly settlements: BinarySettlementService) {}

  @Permissions('binary.settlement.manage')
  @Post()
  run(@Body() dto: RunBinaryPairSettlementDto, @CurrentUser() actor: AuthUser) {
    return this.settlements.run(dto, actor.id);
  }

  @Permissions('binary.settlement.read')
  @Get(':id')
  getSettlement(@Param('id') id: string) {
    return this.settlements.getSettlement(id);
  }

  @Permissions('binary.settlement.read')
  @Get('members/:userId/history')
  listMemberSettlements(@Param('userId') userId: string) {
    return this.settlements.listMemberSettlements(userId);
  }
}
