import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPool, type Pool, type PoolConnection } from 'mariadb';

import { mariaDbUtcConnectionOptions } from './mariadb-options';

type SqlValue = string | number | bigint | boolean | Date | null;

@Injectable()
export class FinancialDbService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    this.pool = createPool({
      ...mariaDbUtcConnectionOptions(),
      connectionLimit: 5,
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

  async withAdvisoryLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    let acquired = false;
    try {
      const result = (await connection.query(
        'SELECT GET_LOCK(?, 15) AS acquired',
        [key],
      )) as Array<{ acquired: number | null }>;
      if (Number(result[0]?.acquired) !== 1) {
        throw new Error('Timed out waiting for the Season prize/draw lock');
      }
      acquired = true;
      return await work();
    } finally {
      if (acquired) {
        try {
          await connection.query('SELECT RELEASE_LOCK(?)', [key]);
        } finally {
          connection.release();
        }
      } else {
        connection.release();
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
