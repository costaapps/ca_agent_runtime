import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import mysql from 'mysql2/promise';

const registryDatabase = 'agent_runtime_registry';
const sharedDatabase = 'ci_tenant_shared';
const isolatedDatabase = 'ci_tenant_isolated';
const tenantA = { companyUUID: '11111111-1111-4111-8111-111111111111', idCompany: 7001, idDatabase: 901, database: sharedDatabase };
const tenantB = { companyUUID: '22222222-2222-4222-8222-222222222222', idCompany: 7002, idDatabase: 901, database: sharedDatabase };
const tenantC = { companyUUID: '33333333-3333-4333-8333-333333333333', idCompany: 7001, idDatabase: 902, database: isolatedDatabase };

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') throw new Error(`${name} is required.`);
  return value;
}

function parseOption(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const fixtureMode = required('CI_FIXTURE_MODE', '');
if (fixtureMode !== '1') throw new Error('Refusing to modify MariaDB without CI_FIXTURE_MODE=1.');

const host = required('MARIADB_HOST', '127.0.0.1');
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  throw new Error('Fixture provisioning is restricted to a local MariaDB endpoint.');
}
const port = Number(required('MARIADB_PORT', '3306'));
const rootUser = required('MARIADB_ROOT_USER', 'root');
const rootPassword = required('MARIADB_ROOT_PASSWORD', 'agent-runtime-ci-root');
const registryPassword = required('CENTRAL_DB_PASS', 'agent-runtime-ci-registry');
const runtimePassword = required('CI_TENANT_DB_PASSWORD', 'agent-runtime-ci-app');
const migrationPassword = required('MIGRATION_DB_PASSWORD', 'agent-runtime-ci-migration');
const registryHost = parseOption('--container-host') ?? host;
const reset = process.argv.includes('--reset');
const smokeEnvFile = parseOption('--write-smoke-env');

const connection = await mysql.createConnection({ host, port, user: rootUser, password: rootPassword, connectTimeout: 5000 });
try {
  const identifiers = [registryDatabase, sharedDatabase, isolatedDatabase];
  if (reset) {
    for (const database of identifiers) await connection.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(database)}`);
  }
  for (const database of identifiers) {
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${mysql.escapeId(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  }

  const registryUser = `${mysql.escape('agent_runtime_registry')}@'%'`;
  const runtimeUser = `${mysql.escape('agent_runtime_app')}@'%'`;
  const migrationUser = `${mysql.escape('agent_runtime_migration')}@'%'`;
  await connection.query(`CREATE USER IF NOT EXISTS ${registryUser} IDENTIFIED BY ${mysql.escape(registryPassword)}`);
  await connection.query(`ALTER USER ${registryUser} IDENTIFIED BY ${mysql.escape(registryPassword)}`);
  await connection.query(`CREATE USER IF NOT EXISTS ${runtimeUser} IDENTIFIED BY ${mysql.escape(runtimePassword)}`);
  await connection.query(`ALTER USER ${runtimeUser} IDENTIFIED BY ${mysql.escape(runtimePassword)}`);
  await connection.query(`CREATE USER IF NOT EXISTS ${migrationUser} IDENTIFIED BY ${mysql.escape(migrationPassword)}`);
  await connection.query(`ALTER USER ${migrationUser} IDENTIFIED BY ${mysql.escape(migrationPassword)}`);

  await connection.query(`GRANT SELECT ON ${mysql.escapeId(registryDatabase)}.* TO ${registryUser}`);
  await connection.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${mysql.escapeId(sharedDatabase)}.* TO ${runtimeUser}`);
  await connection.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${mysql.escapeId(isolatedDatabase)}.* TO ${runtimeUser}`);
  await connection.query(`GRANT ALL PRIVILEGES ON ${mysql.escapeId(sharedDatabase)}.* TO ${migrationUser}`);
  await connection.query(`GRANT ALL PRIVILEGES ON ${mysql.escapeId(isolatedDatabase)}.* TO ${migrationUser}`);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS ${mysql.escapeId(registryDatabase)}.${mysql.escapeId('Databases')} (
      IdDatabase INT NOT NULL,
      Hostname VARCHAR(255) NOT NULL,
      Port SMALLINT UNSIGNED NOT NULL,
      DBName VARCHAR(128) NOT NULL,
      Username VARCHAR(128) NOT NULL,
      Password VARCHAR(255) NOT NULL,
      Msg4BackgroundAPI VARCHAR(255) NULL,
      PRIMARY KEY (IdDatabase)
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ${mysql.escapeId(registryDatabase)}.${mysql.escapeId('Company')} (
      IdCompany INT NOT NULL,
      CompanyUUID CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      IdDatabase INT NOT NULL,
      Name VARCHAR(200) NOT NULL DEFAULT 'CI fixture',
      PRIMARY KEY (IdDatabase, IdCompany),
      UNIQUE KEY uq_ci_company_uuid (CompanyUUID),
      CONSTRAINT fk_ci_company_database FOREIGN KEY (IdDatabase)
        REFERENCES ${mysql.escapeId(registryDatabase)}.${mysql.escapeId('Databases')} (IdDatabase)
    ) ENGINE=InnoDB
  `);

  for (const record of [
    { idDatabase: 901, database: sharedDatabase },
    { idDatabase: 902, database: isolatedDatabase },
  ]) {
    await connection.execute(
      `INSERT INTO ${mysql.escapeId(registryDatabase)}.${mysql.escapeId('Databases')}
         (IdDatabase, Hostname, Port, DBName, Username, Password, Msg4BackgroundAPI)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE Hostname = VALUES(Hostname), Port = VALUES(Port),
         DBName = VALUES(DBName), Username = VALUES(Username), Password = VALUES(Password),
         Msg4BackgroundAPI = VALUES(Msg4BackgroundAPI)`,
      [record.idDatabase, registryHost, port, record.database, 'agent_runtime_app', runtimePassword, 'http://127.0.0.1:3101/'],
    );
  }
  for (const tenant of [tenantA, tenantB, tenantC]) {
    await connection.execute(
      `INSERT INTO ${mysql.escapeId(registryDatabase)}.${mysql.escapeId('Company')}
         (IdCompany, CompanyUUID, IdDatabase, Name)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE IdCompany = VALUES(IdCompany), IdDatabase = VALUES(IdDatabase), Name = VALUES(Name)`,
      [tenant.idCompany, tenant.companyUUID, tenant.idDatabase, `CI tenant ${tenant.companyUUID.slice(0, 8)}`],
    );
  }
} finally {
  await connection.end();
}

if (smokeEnvFile) {
  mkdirSync(dirname(smokeEnvFile), { recursive: true });
  const smokeEnv = {
    PORT: '3101',
    NODE_ENV: 'production',
    OPENAI_API_KEY: 'sk-ci-placeholder-not-a-real-key',
    OPENAI_MODEL: 'ci-no-inference',
    OPENAI_TRACING_ENABLED: 'false',
    OPENAI_TRACE_INCLUDE_SENSITIVE_DATA: 'false',
    MCP_SERVER_URL: 'http://host.docker.internal:4318/mcp',
    MCP_TIMEOUT_MS: '5000',
    DB_HOST: 'host.docker.internal',
    DB_PORT: String(port),
    DB_USER: 'agent_runtime_app',
    DB_PASSWORD: runtimePassword,
    DB_DATABASE: sharedDatabase,
    DB_CONNECTION_LIMIT: '8',
    CENTRAL_DB_HOST: 'host.docker.internal',
    CENTRAL_DB_PORT: String(port),
    CENTRAL_DB_NAME: registryDatabase,
    CENTRAL_DB_USER: 'agent_runtime_registry',
    CENTRAL_DB_PASS: registryPassword,
    CENTRAL_DB_CONNECTION_LIMIT: '4',
    CENTRAL_REGISTRY_CACHE_MS: '60000',
    AGENT_RUNTIME_TENANT_ALLOWLIST: JSON.stringify([tenantA.companyUUID, tenantB.companyUUID, tenantC.companyUUID]),
    TENANT_DB_CONNECTION_LIMIT: '8',
    TENANT_DB_MAX_POOLS: '32',
    TENANT_DB_IDLE_TIMEOUT_MS: '300000',
    AGENT_RUNTIME_DRAIN_TIMEOUT_MS: '120000',
  };
  writeFileSync(smokeEnvFile, `${Object.entries(smokeEnv).map(([key, value]) => `${key}=${value}`).join('\n')}\n`, { mode: 0o600 });

}

process.stdout.write(`Prepared local Registry fixture with three companies across ${sharedDatabase} and ${isolatedDatabase}${reset ? ' (databases reset)' : ''}.\n`);
