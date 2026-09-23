import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '../auth/auth-user';
import { ALLOW_PASSWORD_CHANGE_REQUIRED_KEY } from '../auth/password-change-required.decorator';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { PERMISSIONS_KEY } from './permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const allowPasswordChangeRequired =
      this.reflector.getAllAndOverride<boolean>(
        ALLOW_PASSWORD_CHANGE_REQUIRED_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? false;

    if (request.user?.mustChangePassword && !allowPasswordChangeRequired) {
      throw new ForbiddenException('Password change required');
    }

    const required =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (required.length === 0) return true;

    if (
      !request.user ||
      !required.every((permission) =>
        request.user!.permissions.includes(permission),
      )
    ) {
      throw new ForbiddenException('Missing required permission');
    }
    return true;
  }
}
