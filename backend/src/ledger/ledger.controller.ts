import { Controller, Get, Param } from '@nestjs/common';
import { Permissions } from '../rbac/permissions.decorator';
import { LedgerService } from './ledger.service';

@Controller('admin/ledger')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Permissions('ledger.read')
  @Get('transactions/:id')
  getTransaction(@Param('id') id: string) {
    return this.ledger.getTransaction(id);
  }

  @Permissions('wallet.read')
  @Get('wallets/users/:userId/:currencyCode')
  getUserWallet(
    @Param('userId') userId: string,
    @Param('currencyCode') currencyCode: string,
  ) {
    return this.ledger.getUserWallet(userId, currencyCode);
  }
}
