import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../generated/prisma/enums';
import {
  CreateOwnerSeasonDto,
  type OwnerSeasonPrizeDto,
} from './owner-portal.dto';
import { OwnerPortalService } from './owner-portal.service';
import { OwnerSeasonAdvancedConfigDto } from './owner-season-configuration.dto';
import { OwnerSeasonConfigurationService } from './owner-season-configuration.service';

const DEPLOYMENT_FORMAT = 'MEGAGOLDENCLUB_SEASON_DEPLOYMENT';
const DEPLOYMENT_VERSION = 1;
export const MAX_SEASON_DEPLOYMENT_PACKAGE_BYTES = 150 * 1024 * 1024;
const MAX_PRIZE_MEDIA_BYTES = 5 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

type Row = Record<string, unknown>;

type DeploymentPrize = {
  monthNumber: number;
  prizeCode: string;
  category: string;
  name: string;
  description?: string;
  winnerCount: number;
  nominalValue?: string;
  mediaSha256?: string;
};

type DeploymentMedia = {
  sha256: string;
  filename: string;
  contentType: string;
  dataBase64: string;
};

type DeploymentAdvanced = {
  qualifyingUnit: string;
  leftVolumePerPair: string;
  rightVolumePerPair: string;
  monthlyPairCap?: number;
  carryForwardExpiryDays?: number;
  binaryUnitsPerEvent: number;
  referralHookEnabled: boolean;
  referralBasisMode: string;
  drawEligibilityHookEnabled: false;
  drawStartMonth: number;
  drawWeekOfMonth: number;
  drawWeekday: string;
  minimumPaymentAmount?: string;
  minimumRegistrationAllocation?: string;
  minimumInstallmentAllocation?: string;
  requiredAllocationTypes: string[];
  automaticRulesConfigured: true;
};

type DeploymentBody = {
  format: typeof DEPLOYMENT_FORMAT;
  version: typeof DEPLOYMENT_VERSION;
  exportedAt: string;
  source: {
    currencyCode: string;
    timezone: string;
  };
  season: {
    code: string;
    name: string;
    description?: string;
    startDate: string;
    endDate?: string;
    monthlyEmi: string;
    registrationFee: string;
    totalMonths: number;
    pairValue: string;
    directReferral: string;
    dailyCap: number;
    carryForward: boolean;
    eligibilityCutoff: string;
  };
  advanced: DeploymentAdvanced;
  prizes: DeploymentPrize[];
  media: DeploymentMedia[];
  summary: {
    months: number;
    configuredMonths: number;
    prizeCount: number;
    winnerSlots: number;
    mediaCount: number;
  };
};

type DeploymentPackage = DeploymentBody & {
  checksum: string;
};

type AdvancedConfiguration = {
  binary: {
    qualifyingUnit: string;
    leftVolumePerPair: string;
    rightVolumePerPair: string;
    monthlyPairCap: number | null;
    carryForwardExpiryDays: number | null;
  };
  drawSchedule?: {
    startMonth: number;
    weekOfMonth: number;
    weekday: string;
    timezone: string;
  };
  automaticRules: {
    configured: boolean;
    binaryUnitsPerEvent: number;
    referralHookEnabled: boolean;
    referralBasisMode: string;
    drawEligibilityHookEnabled: boolean;
    minimumPaymentAmount: string | null;
    minimumRegistrationAllocation: string | null;
    minimumInstallmentAllocation: string | null;
    requiredAllocationTypes: string[];
  };
};

type PortalSettings = {
  timezone?: string;
  currencyCode?: string;
};

type ImportedMedia = {
  sha256: string;
  filename: string;
  contentType: string;
  buffer: Buffer;
};

@Injectable()
export class OwnerSeasonDeploymentService {
  constructor(
    private readonly portal: OwnerPortalService,
    private readonly seasonConfiguration: OwnerSeasonConfigurationService,
    private readonly audit: AuditService,
  ) {}

  async exportPackage(seasonId: string, actorUserId: string) {
    const [seasonRaw, advancedRaw, prizeRows, settings] = await Promise.all([
      this.portal.getSeason(seasonId) as Promise<Row>,
      this.seasonConfiguration.getAdvancedConfiguration(seasonId) as Promise<AdvancedConfiguration>,
      this.portal.listSeasonPrizes(seasonId) as Promise<Row[]>,
      this.portal.settings() as Promise<PortalSettings>,
    ]);

    const totalMonths = this.integer(seasonRaw.totalMonths, 'Season total months');
    const configuredMonths = new Set(
      prizeRows
        .filter((row) => String(row.status ?? 'ACTIVE') === 'ACTIVE')
        .map((row) => Number(row.monthNumber)),
    ).size;
    if (configuredMonths < totalMonths) {
      throw new ConflictException(
        `Deployment package requires prize coverage for all ${totalMonths} months; ${configuredMonths} month(s) are configured`,
      );
    }
    if (!advancedRaw.automaticRules.configured) {
      throw new ConflictException(
        'Configure automatic payment rules before exporting a deployment package',
      );
    }
    if (!advancedRaw.drawSchedule) {
      throw new ConflictException(
        'Configure the lucky draw calendar before exporting a deployment package',
      );
    }

    const sourceCurrency = String(settings.currencyCode ?? '').trim().toUpperCase();
    const sourceTimezone = String(
      advancedRaw.drawSchedule.timezone || settings.timezone || '',
    ).trim();
    if (!/^[A-Z]{3}$/.test(sourceCurrency) || !sourceTimezone) {
      throw new ConflictException(
        'Portal currency and timezone must be configured before deployment export',
      );
    }

    const mediaBySha = new Map<string, DeploymentMedia>();
    const prizes: DeploymentPrize[] = [];
    for (const row of prizeRows) {
      const prize: DeploymentPrize = {
        monthNumber: this.integer(row.monthNumber, 'Prize month'),
        prizeCode: this.requiredText(row.prizeCode, 'Prize code'),
        category: this.requiredText(row.category, 'Prize category'),
        name: this.requiredText(row.name, 'Prize name'),
        ...(this.optionalText(row.description)
          ? { description: this.optionalText(row.description)! }
          : {}),
        winnerCount: this.integer(row.winnerCount, 'Prize winner count'),
        ...(this.optionalText(row.nominalValue)
          ? { nominalValue: this.optionalText(row.nominalValue)! }
          : {}),
      };

      const mediaId = this.optionalText(row.mediaId);
      if (mediaId) {
        const opened = await this.portal.openPrizeMedia(mediaId);
        if (opened.info.seasonId !== seasonId) {
          throw new ConflictException(
            `Prize media for ${prize.prizeCode} does not belong to this season`,
          );
        }
        const sha256 = opened.info.sha256.toLowerCase();
        prize.mediaSha256 = sha256;
        if (!mediaBySha.has(sha256)) {
          const buffer = await this.readMedia(opened.stream, opened.info.length);
          const actualSha = createHash('sha256').update(buffer).digest('hex');
          if (actualSha !== sha256) {
            throw new ConflictException(
              `Prize media checksum mismatch for ${prize.prizeCode}`,
            );
          }
          mediaBySha.set(sha256, {
            sha256,
            filename: opened.info.filename,
            contentType: opened.info.contentType,
            dataBase64: buffer.toString('base64'),
          });
        }
      }
      prizes.push(prize);
    }

    const body: DeploymentBody = {
      format: DEPLOYMENT_FORMAT,
      version: DEPLOYMENT_VERSION,
      exportedAt: new Date().toISOString(),
      source: {
        currencyCode: sourceCurrency,
        timezone: sourceTimezone,
      },
      season: {
        code: this.requiredText(seasonRaw.code, 'Season code'),
        name: this.requiredText(seasonRaw.name, 'Season name'),
        ...(this.optionalText(seasonRaw.description)
          ? { description: this.optionalText(seasonRaw.description)! }
          : {}),
        startDate: this.dateOnly(seasonRaw.startDate, 'Season start date'),
        ...(this.optionalText(seasonRaw.endDate)
          ? { endDate: this.dateOnly(seasonRaw.endDate, 'Season end date') }
          : {}),
        monthlyEmi: this.requiredText(seasonRaw.monthlyEmi, 'Monthly EMI'),
        registrationFee: this.requiredText(
          seasonRaw.registrationFee,
          'Registration fee',
        ),
        totalMonths,
        pairValue: this.requiredText(seasonRaw.pairValue, 'Pair value'),
        directReferral: this.requiredText(
          seasonRaw.directReferral,
          'Direct referral',
        ),
        dailyCap: this.integer(seasonRaw.dailyCap, 'Daily cap'),
        carryForward: Boolean(seasonRaw.carryForward),
        eligibilityCutoff: this.requiredText(
          seasonRaw.eligibilityCutoff,
          'Eligibility cutoff',
        ),
      },
      advanced: {
        qualifyingUnit: String(advancedRaw.binary.qualifyingUnit),
        leftVolumePerPair: String(advancedRaw.binary.leftVolumePerPair),
        rightVolumePerPair: String(advancedRaw.binary.rightVolumePerPair),
        ...(advancedRaw.binary.monthlyPairCap === null
          ? {}
          : { monthlyPairCap: Number(advancedRaw.binary.monthlyPairCap) }),
        ...(advancedRaw.binary.carryForwardExpiryDays === null
          ? {}
          : {
              carryForwardExpiryDays: Number(
                advancedRaw.binary.carryForwardExpiryDays,
              ),
            }),
        binaryUnitsPerEvent: Number(
          advancedRaw.automaticRules.binaryUnitsPerEvent,
        ),
        referralHookEnabled: Boolean(
          advancedRaw.automaticRules.referralHookEnabled,
        ),
        referralBasisMode: String(
          advancedRaw.automaticRules.referralBasisMode,
        ),
        drawEligibilityHookEnabled: false,
        drawStartMonth: Number(advancedRaw.drawSchedule.startMonth),
        drawWeekOfMonth: Number(advancedRaw.drawSchedule.weekOfMonth),
        drawWeekday: String(advancedRaw.drawSchedule.weekday),
        ...(advancedRaw.automaticRules.minimumPaymentAmount
          ? {
              minimumPaymentAmount: String(
                advancedRaw.automaticRules.minimumPaymentAmount,
              ),
            }
          : {}),
        ...(advancedRaw.automaticRules.minimumRegistrationAllocation
          ? {
              minimumRegistrationAllocation: String(
                advancedRaw.automaticRules.minimumRegistrationAllocation,
              ),
            }
          : {}),
        ...(advancedRaw.automaticRules.minimumInstallmentAllocation
          ? {
              minimumInstallmentAllocation: String(
                advancedRaw.automaticRules.minimumInstallmentAllocation,
              ),
            }
          : {}),
        requiredAllocationTypes:
          advancedRaw.automaticRules.requiredAllocationTypes.map(String),
        automaticRulesConfigured: true,
      },
      prizes,
      media: [...mediaBySha.values()].sort((left, right) =>
        left.sha256.localeCompare(right.sha256),
      ),
      summary: {
        months: totalMonths,
        configuredMonths,
        prizeCount: prizes.length,
        winnerSlots: prizes.reduce(
          (total, prize) => total + prize.winnerCount,
          0,
        ),
        mediaCount: mediaBySha.size,
      },
    };
    const deploymentPackage: DeploymentPackage = {
      ...body,
      checksum: this.checksum(body),
    };

    await this.audit.log({
      actorUserId,
      action: AuditAction.CREATE,
      entityType: 'OwnerSeasonDeploymentPackage',
      entityId: seasonId,
      description: 'Production-safe season deployment package exported',
      metadata: {
        seasonCode: body.season.code,
        checksum: deploymentPackage.checksum,
        ...body.summary,
      },
    });
    return deploymentPackage;
  }

  async importPackage(
    file:
      | {
          buffer: Buffer;
          originalname: string;
          mimetype: string;
          size: number;
        }
      | undefined,
    actorUserId: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Choose a MegaGoldenClub season deployment package');
    }
    if (file.size > MAX_SEASON_DEPLOYMENT_PACKAGE_BYTES) {
      throw new BadRequestException('Season deployment package is too large');
    }

    const deploymentPackage = await this.parsePackage(file.buffer);
    const settings = (await this.portal.settings()) as PortalSettings;
    const targetCurrency = String(settings.currencyCode ?? '').trim().toUpperCase();
    const targetTimezone = String(settings.timezone ?? '').trim();
    if (deploymentPackage.source.currencyCode !== targetCurrency) {
      throw new ConflictException(
        `Package currency ${deploymentPackage.source.currencyCode} does not match portal currency ${targetCurrency || 'UNSET'}`,
      );
    }
    if (deploymentPackage.source.timezone !== targetTimezone) {
      throw new ConflictException(
        `Package timezone ${deploymentPackage.source.timezone} does not match portal timezone ${targetTimezone || 'UNSET'}`,
      );
    }

    const validatedMedia = this.validateMedia(deploymentPackage);
    const prizeInput = deploymentPackage.prizes.map((prize) => ({
      monthNumber: prize.monthNumber,
      prizeCode: prize.prizeCode,
      category: prize.category,
      name: prize.name,
      ...(prize.description ? { description: prize.description } : {}),
      winnerCount: prize.winnerCount,
      ...(prize.nominalValue ? { nominalValue: prize.nominalValue } : {}),
    }));
    const seasonInput = await this.validateDto(
      CreateOwnerSeasonDto,
      {
        ...deploymentPackage.season,
        prizes: prizeInput,
      },
      'Season deployment configuration',
    );
    const advancedInput = await this.validateDto(
      OwnerSeasonAdvancedConfigDto,
      {
        qualifyingUnit: deploymentPackage.advanced.qualifyingUnit,
        leftVolumePerPair: deploymentPackage.advanced.leftVolumePerPair,
        rightVolumePerPair: deploymentPackage.advanced.rightVolumePerPair,
        ...(deploymentPackage.advanced.monthlyPairCap === undefined
          ? {}
          : { monthlyPairCap: deploymentPackage.advanced.monthlyPairCap }),
        ...(deploymentPackage.advanced.carryForwardExpiryDays === undefined
          ? {}
          : {
              carryForwardExpiryDays:
                deploymentPackage.advanced.carryForwardExpiryDays,
            }),
        binaryUnitsPerEvent:
          deploymentPackage.advanced.binaryUnitsPerEvent,
        referralHookEnabled:
          deploymentPackage.advanced.referralHookEnabled,
        referralBasisMode:
          deploymentPackage.advanced.referralBasisMode,
        drawEligibilityHookEnabled: false,
        drawStartMonth: deploymentPackage.advanced.drawStartMonth,
        drawWeekOfMonth: deploymentPackage.advanced.drawWeekOfMonth,
        drawWeekday: deploymentPackage.advanced.drawWeekday,
        ...(deploymentPackage.advanced.minimumPaymentAmount
          ? {
              minimumPaymentAmount:
                deploymentPackage.advanced.minimumPaymentAmount,
            }
          : {}),
        ...(deploymentPackage.advanced.minimumRegistrationAllocation
          ? {
              minimumRegistrationAllocation:
                deploymentPackage.advanced.minimumRegistrationAllocation,
            }
          : {}),
        ...(deploymentPackage.advanced.minimumInstallmentAllocation
          ? {
              minimumInstallmentAllocation:
                deploymentPackage.advanced.minimumInstallmentAllocation,
            }
          : {}),
        requiredAllocationTypes:
          deploymentPackage.advanced.requiredAllocationTypes,
      },
      'Advanced season deployment configuration',
    );

    const normalizedCode = deploymentPackage.season.code.trim().toUpperCase();
    const seasons = (await this.portal.listSeasons()) as Row[];
    const existing = seasons.find(
      (season) => String(season.code ?? '').trim().toUpperCase() === normalizedCode,
    );

    const reusableMedia = new Map<string, string>();
    if (existing) {
      const status = String(existing.status ?? '');
      if (!['DRAFT', 'REVIEW'].includes(status)) {
        throw new ConflictException(
          `Season ${normalizedCode} already exists with status ${status}; deployment import can only sync DRAFT or REVIEW seasons`,
        );
      }
      const currentPrizes = (await this.portal.listSeasonPrizes(
        String(existing.id),
      )) as Row[];
      for (const prize of currentPrizes) {
        const mediaId = this.optionalText(prize.mediaId);
        if (!mediaId) continue;
        const info = await this.portal.prizeMediaInfo(mediaId);
        if (info?.seasonId === String(existing.id)) {
          reusableMedia.set(info.sha256.toLowerCase(), info.id);
        }
      }
    }

    let targetSeason: Row;
    let mode: 'CREATED' | 'UPDATED';
    if (existing) {
      targetSeason = (await this.seasonConfiguration.updateSeason(
        String(existing.id),
        seasonInput,
        actorUserId,
      )) as Row;
      mode = 'UPDATED';
    } else {
      targetSeason = (await this.seasonConfiguration.createSeason(
        seasonInput,
        actorUserId,
      )) as Row;
      mode = 'CREATED';
    }
    const targetSeasonId = this.requiredText(
      targetSeason.id,
      'Imported season ID',
    );

    await this.seasonConfiguration.updateAdvancedConfiguration(
      targetSeasonId,
      advancedInput,
      actorUserId,
    );

    for (const [sha256, media] of validatedMedia) {
      if (reusableMedia.has(sha256)) continue;
      const uploaded = await this.portal.uploadSeasonPrizeMedia(
        targetSeasonId,
        {
          buffer: media.buffer,
          originalname: media.filename,
          mimetype: media.contentType,
          size: media.buffer.length,
        },
        actorUserId,
      );
      reusableMedia.set(sha256, uploaded.id);
    }

    const finalPrizes: OwnerSeasonPrizeDto[] = deploymentPackage.prizes.map(
      (prize) => ({
        monthNumber: prize.monthNumber,
        prizeCode: prize.prizeCode,
        category: prize.category,
        name: prize.name,
        ...(prize.description ? { description: prize.description } : {}),
        winnerCount: prize.winnerCount,
        ...(prize.nominalValue ? { nominalValue: prize.nominalValue } : {}),
        ...(prize.mediaSha256
          ? { mediaId: reusableMedia.get(prize.mediaSha256)! }
          : {}),
      }),
    );
    await this.portal.saveSeasonPrizes(
      targetSeasonId,
      finalPrizes,
      actorUserId,
    );

    const importedSeason = (await this.portal.getSeason(targetSeasonId)) as Row;
    await this.audit.log({
      actorUserId,
      action: AuditAction.UPDATE,
      entityType: 'OwnerSeasonDeploymentPackage',
      entityId: targetSeasonId,
      description: 'Season deployment package imported into draft configuration',
      metadata: {
        mode,
        seasonCode: normalizedCode,
        checksum: deploymentPackage.checksum,
        ...deploymentPackage.summary,
      },
    });

    return {
      mode,
      checksum: deploymentPackage.checksum,
      season: importedSeason,
      summary: deploymentPackage.summary,
    };
  }

  private async parsePackage(buffer: Buffer): Promise<DeploymentPackage> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(buffer.toString('utf8')) as unknown;
    } catch {
      throw new BadRequestException('Season deployment package is not valid JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException('Season deployment package root is invalid');
    }
    const record = parsed as Record<string, unknown>;
    if (record.format !== DEPLOYMENT_FORMAT || record.version !== DEPLOYMENT_VERSION) {
      throw new BadRequestException(
        `Unsupported season deployment package; expected ${DEPLOYMENT_FORMAT} v${DEPLOYMENT_VERSION}`,
      );
    }
    const checksum = String(record.checksum ?? '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(checksum)) {
      throw new BadRequestException('Season deployment package checksum is missing or invalid');
    }
    const { checksum: _checksum, ...body } = record;
    const actualChecksum = this.checksum(body as DeploymentBody);
    if (actualChecksum !== checksum) {
      throw new BadRequestException(
        'Season deployment package checksum does not match its contents',
      );
    }

    const deploymentPackage = record as unknown as DeploymentPackage;
    if (
      !deploymentPackage.source ||
      !deploymentPackage.season ||
      !deploymentPackage.advanced ||
      !Array.isArray(deploymentPackage.prizes) ||
      !Array.isArray(deploymentPackage.media) ||
      !deploymentPackage.summary
    ) {
      throw new BadRequestException('Season deployment package is incomplete');
    }
    if (!deploymentPackage.advanced.automaticRulesConfigured) {
      throw new BadRequestException(
        'Deployment package does not contain configured automatic payment rules',
      );
    }
    if (!/^[A-Z]{3}$/.test(String(deploymentPackage.source.currencyCode ?? ''))) {
      throw new BadRequestException('Deployment package currency is invalid');
    }
    if (!String(deploymentPackage.source.timezone ?? '').trim()) {
      throw new BadRequestException('Deployment package timezone is invalid');
    }
    if (!deploymentPackage.prizes.length) {
      throw new BadRequestException('Deployment package contains no prizes');
    }
    return deploymentPackage;
  }

  private validateMedia(deploymentPackage: DeploymentPackage) {
    const media = new Map<string, ImportedMedia>();
    for (const item of deploymentPackage.media) {
      const sha256 = String(item.sha256 ?? '').toLowerCase();
      const filename = String(item.filename ?? '').trim();
      const contentType = String(item.contentType ?? '').toLowerCase();
      const dataBase64 = String(item.dataBase64 ?? '');
      if (!/^[a-f0-9]{64}$/.test(sha256)) {
        throw new BadRequestException('Deployment package contains an invalid media checksum');
      }
      if (!filename || filename.length > 180) {
        throw new BadRequestException('Deployment package contains an invalid media filename');
      }
      if (!ALLOWED_MEDIA_TYPES.has(contentType)) {
        throw new BadRequestException(
          `Deployment package media type ${contentType || 'UNKNOWN'} is not supported`,
        );
      }
      if (!dataBase64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64)) {
        throw new BadRequestException('Deployment package contains invalid media data');
      }
      const buffer = Buffer.from(dataBase64, 'base64');
      if (!buffer.length || buffer.length > MAX_PRIZE_MEDIA_BYTES) {
        throw new BadRequestException(
          'Each deployment package prize attachment must be between 1 byte and 5 MB',
        );
      }
      const actualSha = createHash('sha256').update(buffer).digest('hex');
      if (actualSha !== sha256) {
        throw new BadRequestException(
          `Deployment package media checksum mismatch for ${filename}`,
        );
      }
      if (media.has(sha256)) {
        throw new BadRequestException(
          `Deployment package contains duplicate media checksum ${sha256}`,
        );
      }
      media.set(sha256, { sha256, filename, contentType, buffer });
    }

    for (const prize of deploymentPackage.prizes) {
      if (prize.mediaSha256 && !media.has(prize.mediaSha256.toLowerCase())) {
        throw new BadRequestException(
          `Prize ${prize.prizeCode} references media that is not present in the package`,
        );
      }
      if (prize.mediaSha256) {
        prize.mediaSha256 = prize.mediaSha256.toLowerCase();
      }
    }
    return media;
  }

  private async validateDto<T extends object>(
    type: new () => T,
    value: unknown,
    label: string,
  ): Promise<T> {
    const instance = plainToInstance(type, value);
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length) {
      throw new BadRequestException(
        `${label} is invalid: ${this.validationMessages(errors).join('; ')}`,
      );
    }
    return instance;
  }

  private validationMessages(errors: ValidationError[]): string[] {
    const messages: string[] = [];
    for (const error of errors) {
      if (error.constraints) messages.push(...Object.values(error.constraints));
      if (error.children?.length) {
        messages.push(...this.validationMessages(error.children));
      }
    }
    return messages.length ? messages : ['validation failed'];
  }

  private async readMedia(
    stream: AsyncIterable<Buffer | Uint8Array | string>,
    expectedLength: number,
  ) {
    if (expectedLength < 1 || expectedLength > MAX_PRIZE_MEDIA_BYTES) {
      throw new ConflictException('Prize attachment exceeds the deployment media limit');
    }
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += buffer.length;
      if (length > MAX_PRIZE_MEDIA_BYTES) {
        throw new ConflictException('Prize attachment exceeds the deployment media limit');
      }
      chunks.push(buffer);
    }
    const result = Buffer.concat(chunks);
    if (result.length !== expectedLength) {
      throw new ConflictException('Prize attachment length changed during deployment export');
    }
    return result;
  }

  private checksum(body: DeploymentBody) {
    return createHash('sha256').update(JSON.stringify(body)).digest('hex');
  }

  private requiredText(value: unknown, label: string) {
    const text = String(value ?? '').trim();
    if (!text) throw new ConflictException(`${label} is missing`);
    return text;
  }

  private optionalText(value: unknown) {
    const text = value === null || value === undefined ? '' : String(value).trim();
    return text || null;
  }

  private integer(value: unknown, label: string) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      throw new ConflictException(`${label} must be an integer`);
    }
    return parsed;
  }

  private dateOnly(value: unknown, label: string) {
    const raw = this.requiredText(value, label);
    const date = raw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ConflictException(`${label} is invalid`);
    }
    return date;
  }
}
