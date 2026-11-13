import { Injectable, NotFoundException } from '@nestjs/common';
import { FinancialDbService } from '../database/financial-db.service';
import { OwnerPrizeMediaStore } from './owner-prize-media.store';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
type SeasonRow = { id: string; name: string; totalMonths: number | string };
type PrizeRow = {
  monthNumber: number; prizeCode: string; name: string; category: string;
  description: string | null; winnerCount: number | string;
  nominalValue: string | null; currencyCode: string;
  mediaId: string | null; mediaMimeType: string | null;
};
export type PublicPrize = {
  monthNumber: number; prizeCode: string; name: string; category: string;
  description: string | null; winnerCount: number; nominalValue: string | null;
  currencyCode: string; imageMediaId: string | null;
};
export type PublicPrizeCatalogue = {
  season: { name: string; totalMonths: number } | null;
  prizes: PublicPrize[];
};

/** Read-only projection; MySQL owns the prize catalogue and season lifecycle. */
@Injectable()
export class PublicPrizeCatalogueService {
  constructor(
    private readonly db: FinancialDbService,
    private readonly media: OwnerPrizeMediaStore,
  ) {}

  async catalogue(): Promise<PublicPrizeCatalogue> {
    return this.db.transaction(async (connection) => {
      const seasons = (await connection.query(
        `SELECT s.id, s.name, pv.installmentCount AS totalMonths
         FROM owner_seasons s
         INNER JOIN program_versions pv ON pv.id=s.programVersionId
         WHERE s.status='ACTIVE'
         ORDER BY s.startDate DESC, s.createdAt DESC, s.id DESC LIMIT 1`,
      )) as SeasonRow[];
      const season = seasons[0];
      if (!season) return { season: null, prizes: [] };
      const totalMonths = Number(season.totalMonths);
      if (!Number.isInteger(totalMonths) || totalMonths < 1 || totalMonths > 60) {
        return { season: null, prizes: [] };
      }
      const rows = (await connection.query(
        `SELECT monthNumber, prizeCode, name, category, description,
                winnerCount, nominalValue, currencyCode, mediaId, mediaMimeType
         FROM owner_season_prizes
         WHERE seasonId=? AND status='ACTIVE'
         ORDER BY monthNumber ASC,
           CASE WHEN prizeCode REGEXP '^MONTH_[0-9]+_PRIZE_[0-9]+'
             THEN CAST(SUBSTRING_INDEX(prizeCode, '_', -1) AS UNSIGNED)
             ELSE 2147483647 END ASC,
           prizeCode ASC, id ASC`,
        [season.id],
      )) as PrizeRow[];
      return {
        season: { name: season.name, totalMonths },
        prizes: rows.filter((row) => Number(row.monthNumber) >= 1 &&
          Number(row.monthNumber) <= totalMonths).map((row) => ({
          monthNumber: Number(row.monthNumber),
          prizeCode: row.prizeCode,
          name: row.name,
          category: row.category,
          description: row.description || null,
          winnerCount: Number(row.winnerCount),
          nominalValue: row.nominalValue === null ? null : String(row.nominalValue),
          currencyCode: row.currencyCode,
          imageMediaId: row.mediaId && IMAGE_TYPES.has((row.mediaMimeType || '').toLowerCase())
            ? row.mediaId : null,
        })),
      };
    });
  }

  async openImage(mediaId: string) {
    if (!/^[a-fA-F0-9]{24}$/.test(mediaId)) {
      throw new NotFoundException('Prize image not found');
    }
    // An object ID alone never confers public access to private GridFS media.
    const referenced = await this.db.transaction(async (connection) =>
      (await connection.query(
        `SELECT p.seasonId FROM owner_season_prizes p
         INNER JOIN owner_seasons s ON s.id=p.seasonId
         WHERE p.mediaId=? AND p.status='ACTIVE' AND s.status='ACTIVE'
         AND s.id=(SELECT id FROM owner_seasons WHERE status='ACTIVE'
           ORDER BY startDate DESC, createdAt DESC, id DESC LIMIT 1)
         LIMIT 1`,
        [mediaId],
      )) as Array<{ seasonId: string }>,
    );
    const seasonId = referenced[0]?.seasonId;
    if (!seasonId) throw new NotFoundException('Prize image not found');
    const image = await this.media.open(mediaId);
    if (!image || image.info.seasonId !== seasonId ||
        !IMAGE_TYPES.has(image.info.contentType.toLowerCase())) {
      throw new NotFoundException('Prize image not found');
    }
    return image;
  }
}
