import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class OperationalJsonSafeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((value: unknown) => this.normalize(value)));
  }

  private normalize(value: unknown): unknown {
    if (typeof value === 'bigint') {
      const max = BigInt(Number.MAX_SAFE_INTEGER);
      const min = BigInt(Number.MIN_SAFE_INTEGER);
      return value <= max && value >= min ? Number(value) : value.toString();
    }
    if (Array.isArray(value)) return value.map((item) => this.normalize(item));
    if (value instanceof Date) return value;
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [
          key,
          this.normalize(item),
        ]),
      );
    }
    return value;
  }
}
