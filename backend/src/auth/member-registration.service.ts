import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { CaptchaService } from '../captcha/captcha.service';
import { PrismaService } from '../database/prisma.service';
import { GenealogyService } from '../genealogy/genealogy.service';
import {
  AuditAction,
  PasswordCreationMode,
  RoleStatus,
  UserIdentifierType,
  UserStatus,
  UsernameCreationMode,
} from '../generated/prisma/enums';
import type { RegisterDto } from './auth.dto';
import { AuthRecoveryService } from './auth-recovery.service';
import { PasswordService } from './password.service';

type SponsorLookupRow = {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  memberType: string | null;
};

type EpinRow = {
  id: string;
  status: string;
  assignedUserId: string | null;
  expiresAt: Date;
};

@Injectable()
export class MemberRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly captcha: CaptchaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly recovery: AuthRecoveryService,
    private readonly genealogy: GenealogyService,
  ) {}

  async registrationConfig() {
    const [registration, auth, security] = await Promise.all([
      this.prisma.systemRegistrationConfig.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.systemAuthConfig.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.systemSecurityConfig.findUniqueOrThrow({ where: { id: 1 } }),
    ]);
    return {
      publicRegistrationEnabled: registration.publicRegistrationEnabled,
      captchaOnRegistrationEnabled: auth.captchaOnRegistrationEnabled,
      emailRequired: registration.emailRequired,
      mobileRequired: registration.mobileRequired,
      passwordMode: registration.passwordMode,
      usernameMode: registration.usernameMode,
      usernamePrefixEnabled: registration.usernamePrefixEnabled,
      usernamePrefix: registration.usernamePrefix,
      passwordMinLength: security.passwordMinLength,
      passwordMaxLength: security.passwordMaxLength,
      epinRequired: true,
      sponsorLookupEnabled: true,
    };
  }

  async sponsor(reference: string) {
    const value = reference.trim();
    if (value.length < 3) {
      throw new BadRequestException('Enter at least 3 characters to find a sponsor');
    }
    const rows = await this.prisma.$queryRawUnsafe<SponsorLookupRow[]>(
      `SELECT u.id, u.username, u.firstName, u.lastName, u.status, mp.memberType
       FROM users u
       LEFT JOIN member_profiles mp ON mp.userId=u.id
       WHERE u.status='ACTIVE'
         AND (u.id=? OR u.username=? OR LOWER(u.email)=LOWER(?) OR u.phone=?)
       LIMIT 1`,
      value,
      value,
      value,
      value,
    );
    const sponsor = rows[0];
    if (!sponsor) throw new NotFoundException('Sponsor was not found');
    const fullName = [sponsor.firstName, sponsor.lastName].filter(Boolean).join(' ').trim();
    return {
      id: sponsor.id,
      username: sponsor.username,
      fullName: fullName || sponsor.username,
      memberType: sponsor.memberType ?? 'MEMBER',
      status: sponsor.status,
    };
  }

  async register(dto: RegisterDto) {
    const [registration, auth, security] = await Promise.all([
      this.prisma.systemRegistrationConfig.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.systemAuthConfig.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.systemSecurityConfig.findUniqueOrThrow({ where: { id: 1 } }),
    ]);
    if (!registration.publicRegistrationEnabled) {
      throw new ForbiddenException('Public registration is disabled');
    }
    if (
      auth.captchaOnRegistrationEnabled &&
      !(await this.captcha.verify(dto.captchaId, dto.captchaAnswer))
    ) {
      throw new BadRequestException('Registration security check is required or invalid');
    }

    const rawEpin = dto.epin.trim();
    if (!rawEpin) throw new BadRequestException('E-PIN is required');
    const email = dto.email?.trim().toLowerCase() || null;
    const phone = dto.phone?.trim() || null;
    if (registration.emailRequired && !email) throw new BadRequestException('Email is required');
    if (registration.mobileRequired && !phone) throw new BadRequestException('Mobile is required');
    if (registration.usernameMode === UsernameCreationMode.MANUAL && !dto.username?.trim()) {
      throw new BadRequestException('Username is required');
    }

    const generatedPassword =
      registration.passwordMode === PasswordCreationMode.AUTO ||
      (registration.passwordMode === PasswordCreationMode.AUTO_OR_MANUAL && !dto.password);
    const password = generatedPassword ? randomBytes(18).toString('base64url') : dto.password;
    if (!password) throw new BadRequestException('Password is required');
    const passwordLength = Array.from(password).length;
    if (passwordLength < security.passwordMinLength || passwordLength > security.passwordMaxLength) {
      throw new BadRequestException(
        `Password length must be between ${security.passwordMinLength} and ${security.passwordMaxLength} characters`,
      );
    }
    const passwordHash = await this.passwords.hash(password);

    const sponsor = dto.sponsorReference?.trim()
      ? await this.requireSponsor(dto.sponsorReference)
      : null;
    const nameParts = dto.fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
    const firstName = nameParts.length ? nameParts[0] : dto.firstName?.trim() || null;
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : dto.lastName?.trim() || null;
    const memberType = dto.memberType ?? 'PARTNER';
    const epinHash = this.epinHash(rawEpin);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const epins = await tx.$queryRawUnsafe<EpinRow[]>(
          `SELECT id, status, assignedUserId, expiresAt
           FROM owner_epins
           WHERE pinHash=?
           LIMIT 1
           FOR UPDATE`,
          epinHash,
        );
        const epin = epins[0];
        if (
          !epin ||
          epin.status !== 'ACTIVE' ||
          epin.assignedUserId ||
          new Date(epin.expiresAt).getTime() <= Date.now()
        ) {
          throw new BadRequestException('E-PIN is invalid, used, assigned, or expired');
        }

        let username = dto.username?.trim();
        const mustAutoUsername =
          registration.usernameMode === UsernameCreationMode.AUTO ||
          (registration.usernameMode === UsernameCreationMode.AUTO_OR_MANUAL && !username);
        if (mustAutoUsername) {
          const sequence = await tx.systemSequence.update({
            where: { key: 'username' },
            data: { nextValue: { increment: 1 } },
            select: { nextValue: true },
          });
          username = `${registration.usernamePrefixEnabled ? (registration.usernamePrefix ?? '') : ''}${sequence.nextValue.toString()}`;
        }
        if (!username) throw new BadRequestException('Username is required');

        const defaultRole = await tx.role.findUnique({
          where: { name: registration.defaultRoleName },
        });
        if (!defaultRole || defaultRole.status !== RoleStatus.ACTIVE) {
          throw new BadRequestException('Configured default registration role is unavailable');
        }

        const created = await tx.user.create({
          data: {
            username,
            email,
            phone,
            passwordHash,
            firstName,
            lastName,
            status: UserStatus.PENDING,
            mustChangePassword: generatedPassword,
          },
        });
        await tx.userRole.create({ data: { userId: created.id, roleId: defaultRole.id } });
        if (email && !registration.allowMultipleAccountsPerEmail) {
          await tx.userIdentifierClaim.create({
            data: { userId: created.id, type: UserIdentifierType.EMAIL, normalizedValue: email },
          });
        }
        if (phone && !registration.allowMultipleAccountsPerMobile) {
          await tx.userIdentifierClaim.create({
            data: { userId: created.id, type: UserIdentifierType.MOBILE, normalizedValue: phone },
          });
        }

        await tx.$executeRawUnsafe(
          `INSERT INTO member_profiles (userId, dateOfBirth, state, city, memberType)
           VALUES (?, ?, ?, ?, ?)`,
          created.id,
          dto.dateOfBirth ? new Date(`${dto.dateOfBirth}T00:00:00.000Z`) : null,
          dto.state?.trim() || null,
          dto.city?.trim() || null,
          memberType,
        );
        if (sponsor) {
          await tx.sponsorRelationship.create({
            data: {
              memberUserId: created.id,
              sponsorUserId: sponsor.id,
              createdByUserId: created.id,
            },
          });
        }
        const consumed = await tx.$executeRawUnsafe(
          `UPDATE owner_epins
           SET status='USED', usedByUserId=?, usedAt=CURRENT_TIMESTAMP(3), updatedAt=CURRENT_TIMESTAMP(3)
           WHERE id=? AND status='ACTIVE' AND assignedUserId IS NULL AND expiresAt>CURRENT_TIMESTAMP(3)`,
          created.id,
          epin.id,
        );
        if (consumed !== 1) throw new ConflictException('E-PIN was already used during registration');
        return created;
      });

      let placement: { slot?: string; side?: string } | null = null;
      if (sponsor) {
        placement = await this.autoPlaceWithRetry(user.id, sponsor.id);
      }
      await this.audit.log({
        actorUserId: user.id,
        action: AuditAction.CREATE,
        entityType: 'User',
        entityId: user.id,
        description: 'Public member registration created with required E-PIN',
        metadata: {
          sponsorUserId: sponsor?.id ?? null,
          memberType,
          placementSlot: placement?.slot ?? null,
          epinRequired: true,
        },
      });
      await this.recovery.sendRegistrationVerification(user.id);
      return {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          phone: user.phone,
          status: user.status,
          emailVerifiedAt: user.emailVerifiedAt,
        },
        sponsor: sponsor
          ? { id: sponsor.id, username: sponsor.username, fullName: sponsor.fullName }
          : null,
        placement,
        ...(generatedPassword ? { initialPassword: password } : {}),
      };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Username, email, or mobile is already in use');
      }
      throw error;
    }
  }

  private async requireSponsor(reference: string) {
    const safe = await this.sponsor(reference);
    return safe;
  }

  private async autoPlaceWithRetry(memberUserId: string, sponsorUserId: string) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const placed = await this.genealogy.autoPlace(memberUserId, sponsorUserId, memberUserId);
        return { slot: placed.slot, side: placed.side };
      } catch (error) {
        lastError = error;
        if (!(error instanceof ConflictException)) throw error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new ConflictException('No available sponsor placement slot was found');
  }

  private epinHash(raw: string) {
    return createHmac('sha256', this.config.getOrThrow<string>('CAPTCHA_HMAC_SECRET'))
      .update(`owner-portal:epin:${raw.trim()}`)
      .digest('hex');
  }
}
