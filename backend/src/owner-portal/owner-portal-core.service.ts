import { Injectable } from '@nestjs/common';
import { FinancialDbService } from '../database/financial-db.service';

type SqlValue = string | number | bigint | boolean | Date | null;

@Injectable()
export class OwnerPortalCoreService {
  constructor(private readonly db: FinancialDbService) {}

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
