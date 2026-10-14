import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';

if (process.env.CI_FIXTURE_MODE !== '1') {
  throw new Error('Refusing to create a previous tenant schema without CI_FIXTURE_MODE=1.');
}
if (!['127.0.0.1', 'localhost', '::1'].includes(process.env.MARIADB_HOST ?? '127.0.0.1')) {
  throw new Error('Previous-schema setup is restricted to a local MariaDB endpoint.');
}

const migrationRoot = join(process.cwd(), 'drizzle');
const journalPath = join(migrationRoot, 'meta', '_journal.json');
const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
if (!Array.isArray(journal.entries) || journal.entries.length < 2) {
  throw new Error('The Drizzle journal must contain the previous schema and at least one new migration.');
}

const sortedEntries = [...journal.entries].sort((left, right) => left.idx - right.idx);
const latest = sortedEntries.at(-1);
const previousEntries = sortedEntries.filter((entry) => entry.idx < latest.idx);
if (previousEntries.length === 0) throw new Error('No previous migrations are available for upgrade testing.');

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'agent-runtime-previous-schema-'));
const metadataDirectory = join(temporaryDirectory, 'meta');
const previousJournal = { ...journal, entries: previousEntries };
try {
  for (const entry of previousEntries) {
    if (!/^[a-zA-Z0-9_-]+$/.test(entry.tag)) throw new Error(`Invalid migration tag in journal: ${String(entry.tag)}`);
    const source = join(migrationRoot, `${entry.tag}.sql`);
    const target = join(temporaryDirectory, basename(source));
    cpSync(source, target);
  }
  mkdirSync(metadataDirectory, { recursive: true });
  writeFileSync(join(metadataDirectory, '_journal.json'), `${JSON.stringify(previousJournal, null, 2)}\n`);

  const connection = mysql.createPool({
    host: process.env.MARIADB_HOST ?? '127.0.0.1',
    port: Number(process.env.MARIADB_PORT ?? '3306'),
    user: process.env.MIGRATION_DB_USER ?? 'agent_runtime_migration',
    password: process.env.MIGRATION_DB_PASSWORD ?? 'agent-runtime-ci-migration',
    database: 'ci_tenant_isolated',
    connectionLimit: 1,
    connectTimeout: 5000,
  });
  try {
    await migrate(drizzle(connection), { migrationsFolder: temporaryDirectory });
  } finally {
    await connection.end();
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

process.stdout.write(`Created previous schema through migration ${previousEntries.at(-1).tag} for tenant C.\n`);
