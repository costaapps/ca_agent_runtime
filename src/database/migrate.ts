import 'dotenv/config';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createDatabase, closeDatabase } from './connection.js';
import { loadEnv } from '../config/env.js';

const env = loadEnv();
const database = createDatabase(env);

try {
  await migrate(database.db, { migrationsFolder: './drizzle' });
} finally {
  await closeDatabase(database);
}
