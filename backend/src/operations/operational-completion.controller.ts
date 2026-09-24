import { Controller, Get, Query, UseInterceptors } from '@nestjs/common';
import { Permissions } from '../rbac/permissions.decorator';
import { OperationalCompletionService } from './operational-completion.service';
import { OperationalJsonSafeInterceptor } from './operational-json-safe.interceptor';
import { OperationalListQueryDto } from './operational-read.dto';

@Controller('admin/operations')
@Permissions('operations.read')
@UseInterceptors(OperationalJsonSafeInterceptor)
export class OperationalCompletionController {
  constructor(private readonly completion: OperationalCompletionService) {}

  @Get('completion-summary')
  summary() {
    return this.completion.summary();
  }

  @Get('refunds')
  refunds(@Query() query: OperationalListQueryDto) {
    return this.completion.refunds(query);
  }

  @Get('withdrawal-attention')
  withdrawals(@Query() query: OperationalListQueryDto) {
    return this.completion.withdrawals(query);
  }

  @Get('entitlement-attention')
  entitlements(@Query() query: OperationalListQueryDto) {
    return this.completion.entitlements(query);
  }

  @Get('history')
  history(@Query() query: OperationalListQueryDto) {
    return this.completion.history(query);
  }
}
