import { Module } from '@nestjs/common';
import { GenealogyController, MemberGenealogyController } from './genealogy.controller';
import { GenealogyService } from './genealogy.service';

@Module({
  controllers: [GenealogyController, MemberGenealogyController],
  providers: [GenealogyService],
  exports: [GenealogyService],
})
export class GenealogyModule {}
