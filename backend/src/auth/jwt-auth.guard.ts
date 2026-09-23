import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../database/prisma.service';
import { RoleStatus, UserStatus } from '../generated/prisma/enums';
import type { AuthUser, JwtPayload } from './auth-user';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException();
    }

    const token = authorization.slice(7);
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        issuer: 'megamitra-api',
        audience: 'megamitra-clients',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    if (payload.typ !== 'access') throw new UnauthorizedException();

    const [session, security] = await Promise.all([
      this.prisma.authSession.findFirst({
        where: {
          id: payload.sid,
          userId: payload.sub,
          revokedAt: null,
        },
        include: {
          user: {
            include: {
              roles: {
                include: {
                  role: {
                    include: {
                      permissions: { include: { permission: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.systemSecurityConfig.findUniqueOrThrow({ where: { id: 1 } }),
    ]);

    if (!session || session.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Session is not active');
    }

    const now = new Date();
    let expiryReason: string | null = null;
    if (session.expiresAt <= now) expiryReason = 'refresh_expired';
    else if (session.absoluteExpiresAt <= now) expiryReason = 'absolute_timeout';
    else if (
      session.lastSeenAt.getTime() + security.idleTimeoutMinutes * 60_000 <=
      now.getTime()
    ) {
      expiryReason = 'idle_timeout';
    }

    if (expiryReason) {
      await this.prisma.authSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: now, revocationReason: expiryReason },
      });
      throw new UnauthorizedException('Session has expired');
    }

    await this.prisma.authSession.update({
      where: { id: session.id },
      data: { lastSeenAt: now },
    });

    const activeRoles = session.user.roles.filter(
      (item) => item.role.status === RoleStatus.ACTIVE,
    );
    request.user = {
      id: session.user.id,
      sessionId: session.id,
      username: session.user.username,
      mustChangePassword: session.user.mustChangePassword,
      roles: activeRoles.map((item) => item.role.name),
      permissions: [
        ...new Set(
          activeRoles.flatMap((item) =>
            item.role.permissions.map((rp) => rp.permission.code),
          ),
        ),
      ],
    };

    return true;
  }
}
