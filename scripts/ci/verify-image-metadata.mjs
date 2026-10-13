import { spawnSync } from 'node:child_process';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const image = required('IMAGE_REF');
const expectedVersion = required('EXPECTED_VERSION');
const expectedSha = required('EXPECTED_SHA').toLowerCase();
const expectedTitle = process.env.EXPECTED_IMAGE_TITLE?.trim() || 'ca-agent-runtime';
const result = spawnSync('docker', ['image', 'inspect', image], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(`Unable to inspect ${image}: ${result.stderr.trim()}`);

const [detail] = JSON.parse(result.stdout);
const labels = detail?.Config?.Labels ?? {};
const expectedLabels = {
  'org.opencontainers.image.title': expectedTitle,
  'org.opencontainers.image.source': 'https://github.com/costaapps/ca_agent_runtime',
  'org.opencontainers.image.version': expectedVersion,
  'org.opencontainers.image.revision': expectedSha,
};

for (const [key, expected] of Object.entries(expectedLabels)) {
  if (labels[key] !== expected) {
    throw new Error(`Image label ${key} was ${JSON.stringify(labels[key])}; expected ${JSON.stringify(expected)}.`);
  }
}
if (detail?.Os !== 'linux' || detail?.Architecture !== 'amd64') {
  throw new Error(`Expected linux/amd64 image; received ${detail?.Os}/${detail?.Architecture}.`);
}

process.stdout.write(`Verified ${image} (${detail.Id}) with OCI version ${expectedVersion} at ${expectedSha}.\n`);
