import { Global, Module } from '@nestjs/common';

import { FinancialDbService } from './financial-db.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, FinancialDbService],
  exports: [PrismaService, FinancialDbService],
})
export class PrismaModule {}
