import { appendFileSync, readFileSync } from 'node:fs';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const expectedSha = required('EXPECTED_SHA').toLowerCase();
const releaseMode = process.env.RELEASE_MODE === 'true';
const requestedVersion = process.env.REQUESTED_VERSION?.trim() ?? '';
const version = releaseMode ? requestedVersion : manifest.version;
const configuredRepository = process.env.DOCKERHUB_IMAGE?.trim() ?? '';

if (!/^[0-9a-f]{40}$/.test(expectedSha)) {
  throw new Error('EXPECTED_SHA must be a full 40-character Git commit SHA.');
}
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error(`Image version must be stable X.Y.Z; received ${version}.`);
}
if (releaseMode && version !== manifest.version) {
  throw new Error(`Release version ${version} differs from package version ${manifest.version}.`);
}

const repository = 'eduardomatuellacostaapps/ca';
if (releaseMode && configuredRepository !== repository) {
  throw new Error(`DOCKERHUB_IMAGE must be configured as ${repository}; received ${configuredRepository || '(empty)'}.`);
}
const primaryRef = releaseMode
  ? `${configuredRepository}:agent-runtime-${version}`
  : `ca-agent-runtime-ci:${expectedSha}`;
const tags = releaseMode
  ? [primaryRef, `${configuredRepository}:agent-runtime-sha-${expectedSha}`]
  : [primaryRef];

const output = required('GITHUB_OUTPUT');
const delimiter = `IMAGE_TAGS_${process.pid}_${Date.now()}`;
appendFileSync(output, `version=${version}\nprimary_ref=${primaryRef}\n`);
appendFileSync(output, `tags<<${delimiter}\n${tags.join('\n')}\n${delimiter}\n`);
