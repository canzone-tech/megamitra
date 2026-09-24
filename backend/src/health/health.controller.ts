import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get('live')
  live() {
    return this.healthService.live();
  }

  @Public()
  @Get('ready')
  ready(@Res({ passthrough: true }) response: Response) {
    return this.readyResponse(response);
  }

  @Public()
  @Get()
  check(@Res({ passthrough: true }) response: Response) {
    return this.readyResponse(response);
  }

  private async readyResponse(response: Response) {
    const result = await this.healthService.ready();
    if (result.status !== 'ok') response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
