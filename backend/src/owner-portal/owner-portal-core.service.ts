import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { FinancialDbService } from '../database/financial-db.service';
import type { CreateOwnerMemberDto } from './owner-portal.dto';
import type { CreateOwnerCoreMemberDto } from './owner-portal-core.dto';
import { OwnerPortalService } from './owner-portal.service';

type SqlValue = string | number | bigint | boolean | Date | null;
type RegistrationPolicyRow = {
  emailRequired: boolean | number;
  mobileRequired: boolean | number;
  passwordMode: 'AUTO' | 'MANUAL' | 'AUTO_OR_MANUAL';
  usernameMode: 'AUTO' | 'MANUAL' | 'AUTO_OR_MANUAL';
  usernamePrefixEnabled: boolean | number;
  usernamePrefix: string | null;
  defaultRoleName: string;
};

@Injectable()
export class OwnerPortalCoreService {
  constructor(
    private readonly db: FinancialDbService,
    private readonly portal: OwnerPortalService,
  ) {}

  async registrationPolicy() {
    const rows = await this.rows<RegistrationPolicyRow>(
      `SELECT emailRequired, mobileRequired, passwordMode, usernameMode,
              usernamePrefixEnabled, usernamePrefix, defaultRoleName
       FROM system_registration_config
       WHERE id=1
       LIMIT 1`,
    );
    if (!rows[0]) throw new BadRequestException('Registration policy is unavailable');
    return rows[0];
  }

  async createMember(dto: CreateOwnerCoreMemberDto, actorUserId: string) {
    const registration = await this.registrationPolicy();
    if (Boolean(registration.emailRequired) && !dto.email?.trim()) {
      throw new BadRequestException('Email is required by the registration policy');
    }
    if (Boolean(registration.mobileRequired) && !dto.phone?.trim()) {
      throw new BadRequestException('Mobile is required by the registration policy');
    }
    if (registration.usernameMode === 'MANUAL' && !dto.username?.trim()) {
      throw new BadRequestException('Username is required by the registration policy');
    }

    const generatedPassword =
      registration.passwordMode === 'AUTO' ||
      (registration.passwordMode === 'AUTO_OR_MANUAL' && !dto.password);
    const password = generatedPassword
      ? randomBytes(18).toString('base64url')
      : dto.password;
    if (!password) {
      throw new BadRequestException('Password is required by the registration policy');
    }

    const member = await this.portal.createMember(
      { ...dto, password } as CreateOwnerMemberDto,
      actorUserId,
    );
    return generatedPassword ? { ...member, initialPassword: password } : member;
  }

  async listMembers(query?: string) {
    const q = query?.trim();
    const values: SqlValue[] = [];
    let where = '';
    if (q) {
      where = `WHERE u.username LIKE ? OR u.email LIKE ? OR u.phone LIKE ?
        OR CONCAT(COALESCE(u.firstName,''), ' ', COALESCE(u.lastName,'')) LIKE ?`;
      const like = `%${q}%`;
      values.push(like, like, like, like);
    }

    return this.rows<Record<string, unknown>>(
      `SELECT u.id, u.username, u.email, u.phone, u.firstName, u.lastName,
              u.status, u.createdAt,
              mp.dateOfBirth, mp.state, mp.city, mp.memberType,
              sponsor.username AS sponsorUsername,
              parent.username AS placementParentUsername,
              bp.side AS placementSide,
              COALESCE(kp.status, 'NOT_STARTED') AS kycStatus,
              (
                SELECT s.name
                FROM program_enrollments pe
                INNER JOIN owner_seasons s ON s.programVersionId=pe.programVersionId
                WHERE pe.userId=u.id
                  AND pe.status='ACTIVE'
                  AND s.status IN ('ACTIVE','PAUSED')
                ORDER BY pe.enrolledAt DESC
                LIMIT 1
              ) AS seasonName,
              (
                SELECT s.code
                FROM program_enrollments pe
                INNER JOIN owner_seasons s ON s.programVersionId=pe.programVersionId
                WHERE pe.userId=u.id
                  AND pe.status='ACTIVE'
                  AND s.status IN ('ACTIVE','PAUSED')
                ORDER BY pe.enrolledAt DESC
                LIMIT 1
              ) AS seasonCode
       FROM users u
       LEFT JOIN member_profiles mp ON mp.userId=u.id
       LEFT JOIN sponsor_relationships sr ON sr.memberUserId=u.id
       LEFT JOIN users sponsor ON sponsor.id=sr.sponsorUserId
       LEFT JOIN binary_placements bp ON bp.memberUserId=u.id
       LEFT JOIN users parent ON parent.id=bp.parentUserId
       LEFT JOIN kyc_profiles kp ON kp.userId=u.id
       ${where}
       ORDER BY u.createdAt DESC
       LIMIT 100`,
      values,
    );
  }

  async listPairLedger(limit = 100) {
    return this.rows<Record<string, unknown>>(
      `SELECT bpm.id, bpm.pairSequence, bpm.memberUserId, u.username,
              bpm.leftUnitId, bpm.rightUnitId, bpm.payoutAmount,
              bpv.currencyCode, bpm.payable, bpm.createdAt,
              'AC + BD' AS crossMatch
       FROM binary_pair_matches bpm
       INNER JOIN users u ON u.id=bpm.memberUserId
       INNER JOIN binary_plan_versions bpv ON bpv.id=bpm.planVersionId
       ORDER BY bpm.createdAt DESC
       LIMIT ?`,
      [Math.max(1, Math.min(500, limit))],
    );
  }

  private rows<T>(sql: string, values: SqlValue[] = []): Promise<T[]> {
    return this.db.transaction(
      async (connection) => (await connection.query(sql, values)) as T[],
    );
  }
}
