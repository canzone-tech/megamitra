import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../database/prisma.service';
import { UserStatus } from '../generated/prisma/enums';
import { AuthUser, JwtPayload } from './auth-user';
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

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException();

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

    const session = await this.prisma.authSession.findFirst({
      where: {
        id: payload.sid,
        userId: payload.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
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
    });

    if (!session || session.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Session is not active');
    }

    request.user = {
      id: session.user.id,
      sessionId: session.id,
      username: session.user.username,
      roles: session.user.roles.map((item) => item.role.name),
      permissions: [...new Set(session.user.roles.flatMap((item) => item.role.permissions.map((rp) => rp.permission.code)))],
    };

    return true;
  }
}
