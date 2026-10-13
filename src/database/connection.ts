import { type MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from './schema/index.js';

/** RuntimeDatabase is a Drizzle handle bound to the lease-specific MySQL pool. */
export type RuntimeDatabase = MySql2Database<typeof schema>;
