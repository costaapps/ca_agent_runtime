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
const requestedBuildNumber = process.env.REQUESTED_BUILD_NUMBER?.trim() ?? '';
const version = releaseMode ? requestedVersion : manifest.version;

if (!/^[0-9a-f]{40}$/.test(expectedSha)) {
  throw new Error('EXPECTED_SHA must be a full 40-character Git commit SHA.');
}
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error(`Image version must be stable X.Y.Z; received ${version}.`);
}
if (releaseMode && version !== manifest.version) {
  throw new Error(`Release version ${version} differs from package version ${manifest.version}.`);
}
if (releaseMode && !/^[1-9]\d*$/.test(requestedBuildNumber)) {
  throw new Error('REQUESTED_BUILD_NUMBER must be a positive GitHub Actions run number.');
}

const primaryRef = releaseMode
  ? `ca-agent-runtime-release:agent-runtime-${requestedBuildNumber}`
  : `ca-agent-runtime-ci:${expectedSha}`;
const tags = releaseMode
  ? [primaryRef]
  : [primaryRef];

const output = required('GITHUB_OUTPUT');
const delimiter = `IMAGE_TAGS_${process.pid}_${Date.now()}`;
appendFileSync(output, `version=${version}\nprimary_ref=${primaryRef}\n`);
appendFileSync(output, `tags<<${delimiter}\n${tags.join('\n')}\n${delimiter}\n`);
