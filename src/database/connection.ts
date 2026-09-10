import mysql, { type Pool } from 'mysql2/promise';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from './schema/index.js';
import type { RuntimeEnv } from '../config/env.js';

export type RuntimeDatabase = MySql2Database<typeof schema>;

export interface DatabaseHandle {
  db: RuntimeDatabase;
  pool: Pool;
}

export function createDatabase(env: Pick<RuntimeEnv, 'DB_HOST' | 'DB_PORT' | 'DB_USER' | 'DB_PASSWORD' | 'DB_DATABASE' | 'DB_CONNECTION_LIMIT'>): DatabaseHandle {
  const pool = mysql.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_DATABASE,
    connectionLimit: env.DB_CONNECTION_LIMIT,
    namedPlaceholders: true,
    waitForConnections: true,
  });
  return { db: drizzle(pool, { schema, mode: 'default' }), pool };
}

export async function closeDatabase(handle: DatabaseHandle): Promise<void> {
  await handle.pool.end();
}
