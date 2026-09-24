import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Collection, MongoClient } from 'mongodb';
import type { PresentationContent, PresentationKind, PresentationSurface } from './presentation-schema';

type PresentationDocument = {
  documentKey: string;
  definitionId: string;
  versionId: string;
  kind: PresentationKind;
  surface: PresentationSurface;
  schemaVersion: number;
  content: PresentationContent;
  contentChecksum: string;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class PresentationDocumentStore implements OnModuleInit, OnModuleDestroy {
  private client?: MongoClient;
  private collection?: Collection<PresentationDocument>;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const uri = this.config.getOrThrow<string>('MONGODB_URI');
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
    await this.client.connect();
    this.collection = this.client.db().collection<PresentationDocument>('presentation_documents');
    await Promise.all([
      this.collection.createIndex({ versionId: 1 }, { unique: true }),
      this.collection.createIndex({ documentKey: 1 }, { unique: true }),
      this.collection.createIndex({ surface: 1, kind: 1 }),
    ]);
  }

  async onModuleDestroy() {
    await this.client?.close();
  }

  async putDraft(input: {
    documentKey: string;
    definitionId: string;
    versionId: string;
    kind: PresentationKind;
    surface: PresentationSurface;
    content: PresentationContent;
    contentChecksum: string;
  }) {
    const collection = this.getCollection();
    const now = new Date();
    await collection.updateOne(
      { versionId: input.versionId },
      {
        $set: {
          documentKey: input.documentKey,
          definitionId: input.definitionId,
          versionId: input.versionId,
          kind: input.kind,
          surface: input.surface,
          schemaVersion: 1,
          content: input.content,
          contentChecksum: input.contentChecksum,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
  }

  async get(versionId: string): Promise<PresentationDocument | null> {
    return this.getCollection().findOne({ versionId });
  }

  async delete(versionId: string): Promise<void> {
    await this.getCollection().deleteOne({ versionId });
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const result = await this.client.db().command({ ping: 1 });
      return result.ok === 1;
    } catch {
      return false;
    }
  }

  private getCollection(): Collection<PresentationDocument> {
    if (!this.collection) throw new Error('Presentation MongoDB store is not initialized');
    return this.collection;
  }
}
