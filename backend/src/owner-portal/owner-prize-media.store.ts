import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { GridFSBucket, MongoClient, ObjectId } from 'mongodb';
import type { Readable } from 'node:stream';

const BUCKET_NAME = 'owner_prize_media';
const MEDIA_KIND = 'OWNER_PRIZE';

type PrizeMediaMetadata = {
  kind: typeof MEDIA_KIND;
  seasonId: string;
  actorUserId: string;
  contentType: string;
  originalName: string;
  sha256: string;
};

export type PrizeMediaInfo = {
  id: string;
  seasonId: string;
  filename: string;
  contentType: string;
  length: number;
  sha256: string;
};

@Injectable()
export class OwnerPrizeMediaStore implements OnModuleInit, OnModuleDestroy {
  private client?: MongoClient;
  private bucket?: GridFSBucket;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const uri = this.config.getOrThrow<string>('MONGODB_URI');
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
    await this.client.connect();
    this.bucket = new GridFSBucket(this.client.db(), { bucketName: BUCKET_NAME });
  }

  async onModuleDestroy() {
    await this.client?.close();
  }

  async upload(input: {
    seasonId: string;
    actorUserId: string;
    originalName: string;
    contentType: string;
    buffer: Buffer;
  }): Promise<PrizeMediaInfo> {
    const bucket = this.getBucket();
    const filename = this.safeFilename(input.originalName);
    const sha256 = createHash('sha256').update(input.buffer).digest('hex');
    const metadata: PrizeMediaMetadata = {
      kind: MEDIA_KIND,
      seasonId: input.seasonId,
      actorUserId: input.actorUserId,
      contentType: input.contentType,
      originalName: filename,
      sha256,
    };
    const stream = bucket.openUploadStream(filename, {
      contentType: input.contentType,
      metadata,
    });
    await new Promise<void>((resolve, reject) => {
      stream.once('finish', () => resolve());
      stream.once('error', reject);
      stream.end(input.buffer);
    });
    return {
      id: stream.id.toHexString(),
      seasonId: input.seasonId,
      filename,
      contentType: input.contentType,
      length: input.buffer.length,
      sha256,
    };
  }

  async info(mediaId: string): Promise<PrizeMediaInfo | null> {
    const objectId = this.objectId(mediaId);
    if (!objectId) return null;
    const file = await this.getBucket().find({ _id: objectId }).next();
    const metadata = file?.metadata as PrizeMediaMetadata | undefined;
    if (!file || metadata?.kind !== MEDIA_KIND) return null;
    return {
      id: objectId.toHexString(),
      seasonId: metadata.seasonId,
      filename: metadata.originalName || file.filename,
      contentType: metadata.contentType || 'application/octet-stream',
      length: Number(file.length),
      sha256: metadata.sha256,
    };
  }

  async open(mediaId: string): Promise<{ info: PrizeMediaInfo; stream: Readable } | null> {
    const info = await this.info(mediaId);
    if (!info) return null;
    return {
      info,
      stream: this.getBucket().openDownloadStream(new ObjectId(info.id)),
    };
  }

  private getBucket(): GridFSBucket {
    if (!this.bucket) throw new Error('Owner prize media store is not initialized');
    return this.bucket;
  }

  private objectId(value: string): ObjectId | null {
    if (!/^[a-fA-F0-9]{24}$/.test(value)) return null;
    return new ObjectId(value);
  }

  private safeFilename(value: string): string {
    const withoutControls = [...value]
      .map((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127 ? '_' : character;
      })
      .join('');
    const cleaned = withoutControls.replace(/[\\/]+/g, '_').trim().slice(0, 180);
    return cleaned || 'prize-attachment';
  }
}
