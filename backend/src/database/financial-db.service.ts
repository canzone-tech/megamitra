import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPool, type Pool, type PoolConnection } from 'mariadb';

type SqlValue = string | number | bigint | boolean | Date | null;

@Injectable()
export class FinancialDbService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    this.pool = createPool({
      host: process.env.MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.MYSQL_PORT ?? 3307),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      connectionLimit: 5,
      connectTimeout: 5000,
      acquireTimeout: 10000,
      bigIntAsNumber: false,
      insertIdAsNumber: false,
    });
  }

  async execute(sql: string, values: SqlValue[] = []): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.query(sql, values);
    } finally {
      connection.release();
    }
  }

  async transaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original transaction error.
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
