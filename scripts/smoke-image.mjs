#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

const requiredEnvironment = [
  'IMAGE_REF',
  'SMOKE_ENV_FILE',
  'SMOKE_TENANT_A_UUID',
  'SMOKE_TENANT_A_ID',
  'SMOKE_TENANT_DB_A',
  'SMOKE_TENANT_C_UUID',
  'SMOKE_TENANT_DB_C',
  'SMOKE_DB_ADMIN_USER',
  'SMOKE_DB_ADMIN_PASSWORD',
];

for (const name of requiredEnvironment) {
  assert.ok(process.env[name], `Required environment variable ${name} is missing.`);
}

const image = process.env.IMAGE_REF;
const envFile = process.env.SMOKE_ENV_FILE;
const runtimeEnvironment = dotenv.parse(readFileSync(envFile));
const tenantAUUID = process.env.SMOKE_TENANT_A_UUID;
const tenantAId = Number(process.env.SMOKE_TENANT_A_ID);
const tenantADB = process.env.SMOKE_TENANT_DB_A;
const tenantCUUID = process.env.SMOKE_TENANT_C_UUID;
const tenantCDB = process.env.SMOKE_TENANT_DB_C;
const processLineId = 1_800_000_000 + Math.floor(Math.random() * 100_000_000);
const sessionAUUID = randomUUID();
const sessionCUUID = randomUUID();
const containerName = `ca-agent-runtime-smoke-${process.pid}-${randomUUID().slice(0, 8)}`;
const timeoutMs = Number(process.env.SMOKE_STARTUP_TIMEOUT_MS ?? 90_000);
const secrets = Object.entries({ ...runtimeEnvironment, ...process.env })
  .filter(([name, value]) => value && /password|pass|token|secret|api.?key/i.test(name))
  .map(([, value]) => value);

assert.ok(Number.isSafeInteger(tenantAId) && tenantAId > 0, 'SMOKE_TENANT_A_ID must be a positive integer.');
assert.match(tenantAUUID, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'SMOKE_TENANT_A_UUID must be a UUID.');
assert.match(tenantCUUID, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'SMOKE_TENANT_C_UUID must be a UUID.');
assert.equal(Number(process.env.SMOKE_TENANT_C_ID ?? tenantAId), tenantAId, 'Tenant C must reuse tenant A IdCompany for the cross-database isolation check.');
assert.notEqual(tenantADB, tenantCDB, 'Tenant A and C must use separate databases.');

const allowlist = JSON.parse(runtimeEnvironment.AGENT_RUNTIME_TENANT_ALLOWLIST ?? '[]');
assert.ok(Array.isArray(allowlist) && allowlist.length > 0, 'Smoke env file must contain a non-empty AGENT_RUNTIME_TENANT_ALLOWLIST.');
assert.ok(allowlist.includes(tenantAUUID), 'Tenant A must be allowlisted.');
assert.ok(allowlist.includes(tenantCUUID), 'Tenant C must be allowlisted.');
const deniedUUID = process.env.SMOKE_DENIED_COMPANY_UUID ?? randomUUID();
assert.ok(!allowlist.includes(deniedUUID), 'SMOKE_DENIED_COMPANY_UUID must not be in the allowlist.');

function redact(value) {
  let result = String(value);
  for (const secret of secrets) {
    if (secret.length > 0) result = result.replaceAll(secret, '[REDACTED]');
  }
  return result;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = redact(result.stderr || result.stdout || `exit code ${result.status}`);
    throw new Error(`${command} failed: ${detail}`);
  }
  return result.stdout.trim();
}

function verifyImageContents() {
  const inspect = JSON.parse(run('docker', ['image', 'inspect', image, '--format', '{{json .}}']));
  assert.equal(`${inspect.Os}/${inspect.Architecture}`, 'linux/amd64', 'Image must target linux/amd64.');
  assert.equal(inspect.Config?.User, 'node', 'Image must run as the node user.');
  assert.deepEqual(inspect.Config?.Cmd, ['node', 'dist/src/server.js'], 'Image must use the exec-form server command.');
  assert.ok(inspect.Config?.Healthcheck?.Test?.some((part) => part.includes('/health/ready')), 'Image healthcheck must probe /health/ready.');
  assert.equal(inspect.Config?.Labels?.['org.opencontainers.image.title'], 'ca-agent-runtime');
  for (const value of inspect.Config?.Env ?? []) {
    assert.ok(!/OPENAI_API_KEY|DB_PASSWORD|CENTRAL_DB_PASS|MIGRATION_DB_PASSWORD/i.test(value), 'Image configuration must not contain credentials.');
  }

  const check = String.raw`
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    assert.notEqual(process.getuid?.(), 0, 'container process must not be root');
    assert.equal(process.cwd(), '/app');
    for (const file of ['package.json', 'package-lock.json', 'dist/src/server.js', 'dist/src/database/migrate.js']) {
      assert.ok(fs.existsSync(path.join('/app', file)), 'missing image file: ' + file);
    }
    const manifest = JSON.parse(fs.readFileSync('/app/package.json', 'utf8'));
    assert.match(manifest.scripts?.['db:migrate:prod'] ?? '', /dist\/src\/database\/migrate\.js/, 'db:migrate:prod must invoke the compiled administrative migration executor');
    const migrations = [];
    function collectSql(directory) {
      for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
        const itemPath = path.join(directory, item.name);
        if (item.isDirectory()) collectSql(itemPath);
        else if (item.name.endsWith('.sql')) migrations.push(itemPath);
      }
    }
    collectSql('/app/drizzle');
    assert.ok(migrations.length > 0, 'image must include SQL migrations');
    const topLevel = fs.readdirSync('/app').sort();
    assert.deepEqual(topLevel, ['dist', 'drizzle', 'node_modules', 'package-lock.json', 'package.json'].sort(), 'image must contain only the compiled app, runtime dependencies, manifests, and migrations');
    function assertNoEnvironmentFiles(directory) {
      for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
        assert.ok(!item.name.startsWith('.env'), 'environment file in image: ' + path.join(directory, item.name));
        if (item.isDirectory()) assertNoEnvironmentFiles(path.join(directory, item.name));
      }
    }
    for (const directory of ['dist', 'drizzle']) assertNoEnvironmentFiles(path.join('/app', directory));
    for (const tool of ['tsx', 'vitest', 'drizzle-kit', 'typescript']) {
      assert.ok(!fs.existsSync(path.join('/app/node_modules', tool)), 'development tool in production image: ' + tool);
    }
    for (const file of [
      '/usr/local/bin/npm', '/usr/local/bin/npx', '/usr/local/bin/corepack',
      '/usr/local/bin/yarn', '/usr/local/bin/yarnpkg',
      '/usr/local/lib/node_modules/npm', '/usr/local/lib/node_modules/corepack',
      '/opt/yarn-v1.22.22',
    ]) {
      assert.ok(!fs.existsSync(file), 'package manager in production image: ' + file);
    }
    console.log(JSON.stringify({ uid: process.getuid?.(), sqlMigrations: migrations.length }));
  `;
  run('docker', ['run', '--rm', '--platform', 'linux/amd64', '--entrypoint', 'node', image, '-e', check]);
}

function verifyImageMigrationCommand() {
  run('docker', [
    'run', '--rm', '--platform', 'linux/amd64', '--env-file', envFile,
    '--env', `MIGRATION_DB_USER=${process.env.SMOKE_DB_ADMIN_USER}`,
    '--env', `MIGRATION_DB_PASSWORD=${process.env.SMOKE_DB_ADMIN_PASSWORD}`,
    image, 'node', 'dist/src/database/migrate.js', '--company-uuid', tenantAUUID,
  ]);
}

async function reserveLocalPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function createDatabaseConnection(database) {
  return mysql.createConnection({
    host: process.env.SMOKE_DB_ADMIN_HOST ?? '127.0.0.1',
    port: Number(process.env.SMOKE_DB_ADMIN_PORT ?? 3306),
    user: process.env.SMOKE_DB_ADMIN_USER,
    password: process.env.SMOKE_DB_ADMIN_PASSWORD,
    database,
    connectTimeout: 10_000,
  });
}

function escapeIdentifier(connection, identifier) {
  assert.match(identifier, /^[a-zA-Z0-9_]+$/, 'Database names must contain only letters, digits, and underscores.');
  return connection.escapeId(identifier);
}

async function seedOpenSession(connection, database, sessionUUID) {
  const schema = escapeIdentifier(connection, database);
  const table = `${schema}.${connection.escapeId('AIAgentSession')}`;
  const [columns] = await connection.query(`SHOW COLUMNS FROM ${table}`);
  const presentColumns = new Set(columns.map((column) => column.Field));
  const now = new Date();
  const values = {
    SessionUUID: sessionUUID,
    IdCompany: tenantAId,
    IdChat: 1,
    IdProcessLine: processLineId,
    RootAgent: 'smoke-test',
    AgentConfigurationRevision: null,
    AgentConfigurationJSON: null,
    KnowledgeConfigurationJSON: null,
    RuntimeConfigJSON: null,
    Status: 'OPEN',
    StartedAt: now,
    LastActivityAt: now,
    ClosedAt: null,
  };

  const columnsToInsert = Object.keys(values).filter((column) => presentColumns.has(column));
  assert.ok(['SessionUUID', 'IdCompany', 'IdProcessLine', 'Status'].every((column) => columnsToInsert.includes(column)), 'AIAgentSession schema is missing required smoke fields.');
  const columnSql = columnsToInsert.map((column) => connection.escapeId(column)).join(', ');
  const placeholders = columnsToInsert.map(() => '?').join(', ');
  await connection.execute(
    `INSERT INTO ${table} (${columnSql}) VALUES (${placeholders})`,
    columnsToInsert.map((column) => values[column]),
  );
}

async function readSessionStatus(connection, database, sessionUUID) {
  const table = `${escapeIdentifier(connection, database)}.${connection.escapeId('AIAgentSession')}`;
  const [rows] = await connection.execute(`SELECT SessionUUID, Status FROM ${table} WHERE SessionUUID = ?`, [sessionUUID]);
  assert.equal(rows.length, 1, `expected a session row in ${database}`);
  return rows[0];
}

async function waitUntilReady(baseURL) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/health/ready`, { signal: AbortSignal.timeout(4_000) });
      if (response.ok) return;
      lastError = new Error(`/health/ready returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    const state = JSON.parse(run('docker', ['container', 'inspect', containerName, '--format', '{{json .State}}']));
    if (state.Status !== 'running') throw new Error(`Runtime container exited during startup (${state.Status}, exit ${state.ExitCode}).`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Runtime did not become ready within ${timeoutMs}ms: ${lastError?.message ?? 'unknown error'}`);
}

async function postJson(baseURL, route, body) {
  return fetch(`${baseURL}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
}

function startContainer(port) {
  const args = [
    'run', '-d', '--name', containerName, '--platform', 'linux/amd64',
    '--env-file', envFile,
    '--publish', `127.0.0.1:${port}:3101`,
    '--add-host', 'host.docker.internal:host-gateway',
  ];
  if (process.env.SMOKE_NETWORK) args.push('--network', process.env.SMOKE_NETWORK);
  args.push(image);
  run('docker', args);
}

async function main() {
  verifyImageContents();
  verifyImageMigrationCommand();
  const port = await reserveLocalPort();
  const baseURL = `http://127.0.0.1:${port}`;
  let connection;
  let started = false;
  let gracefulStop = false;
  try {
    connection = await createDatabaseConnection(tenantADB);
    await seedOpenSession(connection, tenantADB, sessionAUUID);
    await seedOpenSession(connection, tenantCDB, sessionCUUID);

    startContainer(port);
    started = true;
    await waitUntilReady(baseURL);

    const live = await fetch(`${baseURL}/health/live`, { signal: AbortSignal.timeout(4_000) });
    assert.equal(live.status, 200, '/health/live must return HTTP 200.');
    const healthAlias = await fetch(`${baseURL}/health`, { signal: AbortSignal.timeout(4_000) });
    assert.equal(healthAlias.status, 200, '/health must remain a live-health alias.');
    const dependencies = await fetch(`${baseURL}/health/dependencies`, { signal: AbortSignal.timeout(4_000) });
    assert.equal(dependencies.status, 200, '/health/dependencies must return aggregate dependency status.');

    const missingTenant = await postJson(baseURL, '/v1/agent-sessions/close', {
      IdCompany: tenantAId,
      IdProcessLine: processLineId,
      Reason: 'SMOKE_TEST',
    });
    assert.equal(missingTenant.status, 400, 'missing CompanyUUID must be rejected with HTTP 400.');

    const deniedTenant = await postJson(baseURL, '/v1/agent-sessions/close', {
      CompanyUUID: deniedUUID,
      IdCompany: tenantAId,
      IdProcessLine: processLineId,
      Reason: 'SMOKE_TEST',
    });
    assert.equal(deniedTenant.status, 403, 'a tenant outside the allowlist must be rejected with HTTP 403.');

    const close = await postJson(baseURL, '/v1/agent-sessions/close', {
      CompanyUUID: tenantAUUID,
      IdCompany: tenantAId,
      IdProcessLine: processLineId,
      Reason: 'SMOKE_TEST',
    });
    assert.equal(close.status, 200, `session close must return HTTP 200 (got ${close.status}).`);
    const closeBody = await close.json();
    assert.equal(closeBody.Success, true, 'session close response must succeed.');
    assert.equal(closeBody.SessionUUID, sessionAUUID, 'session close must return the session in tenant A database.');
    assert.equal(closeBody.Status, 'CLOSED');

    const sessionA = await readSessionStatus(connection, tenantADB, sessionAUUID);
    const sessionC = await readSessionStatus(connection, tenantCDB, sessionCUUID);
    assert.equal(sessionA.Status, 'CLOSED', 'session close must update tenant A database.');
    assert.equal(sessionC.Status, 'OPEN', 'session close must not update tenant C database with the same IdCompany.');

    const stopResult = spawnSync('docker', ['stop', '--time', '130', containerName], { encoding: 'utf8' });
    if (stopResult.error) throw stopResult.error;
    assert.equal(stopResult.status, 0, redact(stopResult.stderr || 'docker stop failed'));
    const state = JSON.parse(run('docker', ['container', 'inspect', containerName, '--format', '{{json .State}}']));
    assert.equal(state.ExitCode, 0, `SIGTERM shutdown must exit cleanly (exit ${state.ExitCode}).`);
    gracefulStop = true;
    console.log('Image smoke passed: linux/amd64, non-root user, production contents, readiness, tenant rejection, database-scoped Session close, and SIGTERM.');
  } finally {
    if (connection) {
      for (const [database, uuid] of [[tenantADB, sessionAUUID], [tenantCDB, sessionCUUID]]) {
        const table = `${escapeIdentifier(connection, database)}.${connection.escapeId('AIAgentSession')}`;
        await connection.execute(`DELETE FROM ${table} WHERE SessionUUID = ?`, [uuid]).catch(() => undefined);
      }
      await connection.end();
    }
    if (started && !gracefulStop) {
      spawnSync('docker', ['stop', '--time', '130', containerName], { encoding: 'utf8' });
    }
    if (started) spawnSync('docker', ['rm', '-f', containerName], { encoding: 'utf8' });
  }
}

main().catch((error) => {
  console.error(redact(error?.stack ?? error));
  process.exitCode = 1;
});
