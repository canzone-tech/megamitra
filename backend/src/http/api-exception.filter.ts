import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<{
      url?: string;
      method?: string;
      headers?: Record<string, string | string[] | undefined>;
    }>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | string[] = 'Internal server error';
    let code = this.defaultCode(status);

    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'string') {
        message = response;
      } else if (response && typeof response === 'object') {
        const body = response as Record<string, unknown>;
        if (typeof body.message === 'string' || Array.isArray(body.message)) {
          message = body.message as string | string[];
        }
        if (typeof body.errorCode === 'string') code = body.errorCode;
      }
    }

    const path = (request.url ?? '').split('?')[0] ?? '';
    const rawRequestId = request.headers?.['x-request-id'];
    const requestId = Array.isArray(rawRequestId) ? rawRequestId[0] : rawRequestId;

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        `${request.method ?? 'HTTP'} ${path} failed requestId=${requestId ?? 'unknown'}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    this.adapterHost.httpAdapter.reply(
      context.getResponse(),
      {
        statusCode: status,
        code,
        message,
        path,
        requestId: requestId ?? null,
        timestamp: new Date().toISOString(),
      },
      status,
    );
  }

  private defaultCode(status: number): string {
    const codes: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_SERVER_ERROR',
    };
    return codes[status] ?? `HTTP_${status}`;
  }
}
