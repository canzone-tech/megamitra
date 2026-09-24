import { Module } from '@nestjs/common';
import { PresentationAdminController, PresentationRuntimeController } from './presentation.controller';
import { PresentationDocumentStore } from './presentation-document.store';
import { PresentationService } from './presentation.service';

@Module({
  controllers: [PresentationRuntimeController, PresentationAdminController],
  providers: [PresentationDocumentStore, PresentationService],
  exports: [PresentationService],
})
export class PresentationModule {}
