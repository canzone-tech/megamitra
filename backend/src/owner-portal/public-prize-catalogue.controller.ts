import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PublicPrizeCatalogueService } from './public-prize-catalogue.service';

@Public()
@Controller('public/prizes')
export class PublicPrizeCatalogueController {
  constructor(private readonly catalogue: PublicPrizeCatalogueService) {}

  @Get('catalogue')
  @Header('Cache-Control', 'no-store')
  list() { return this.catalogue.catalogue(); }

  @Get('images/:mediaId')
  @Header('Cache-Control', 'no-store')
  async image(@Param('mediaId') mediaId: string) {
    const image = await this.catalogue.openImage(mediaId);
    return new StreamableFile(image.stream, {
      type: image.info.contentType,
      length: image.info.length,
      disposition: 'inline',
    });
  }
}
