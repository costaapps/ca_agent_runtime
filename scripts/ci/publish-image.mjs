import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function docker(args, { allowMissing = false } = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status === 0) return result.stdout.trim();
  const detail = result.stderr.trim() || result.stdout.trim();
  if (allowMissing && /manifest unknown|manifest does not exist|no such manifest|manifest .* not found/i.test(detail)) {
    return null;
  }
  throw new Error(`docker ${args.join(' ')} failed: ${detail}`);
}

function inspectLocal(reference) {
  const output = docker(['image', 'inspect', reference]);
  const [image] = JSON.parse(output);
  if (!image) throw new Error(`Image ${reference} was not present in the local Docker engine.`);
  return image;
}

function labelsOf(image) {
  return image.Config?.Labels ?? {};
}

function verifyImage(image, expected) {
  const labels = labelsOf(image);
  const checks = {
    'org.opencontainers.image.title': expected.title,
    'org.opencontainers.image.source': expected.source,
    'org.opencontainers.image.version': expected.version,
    'org.opencontainers.image.revision': expected.sha,
  };
  for (const [key, value] of Object.entries(checks)) {
    if (labels[key] !== value) {
      throw new Error(`Image label ${key} is ${JSON.stringify(labels[key])}; expected ${JSON.stringify(value)}.`);
    }
  }
  if (image.Os !== 'linux' || image.Architecture !== 'amd64') {
    throw new Error(`Expected linux/amd64 image, got ${image.Os}/${image.Architecture}.`);
  }
  return image;
}

function pullIfPresent(reference) {
  const pulled = docker(['pull', reference], { allowMissing: true });
  if (pulled === null) return null;
  return inspectLocal(reference);
}

function registryDigest(reference) {
  const output = docker(['manifest', 'inspect', '--verbose', reference]);
  const parsed = JSON.parse(output);
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const digest = entries.map((entry) => entry.Descriptor?.digest ?? entry.descriptor?.digest).find(Boolean);
  if (!/^sha256:[0-9a-f]{64}$/.test(digest ?? '')) {
    throw new Error(`Could not determine the registry manifest digest for ${reference}.`);
  }
  return digest;
}

function outputSummary({ repository, version, sha, digest, imageSize }) {
  const lines = [
    '## Agent Runtime Docker Hub publication',
    '',
    `- Version: \`${version}\``,
    `- Commit: \`${sha}\``,
    `- Image: \`docker.io/${repository}:agent-runtime-${version}\``,
    `- Digest: \`docker.io/${repository}@${digest}\``,
    `- Image size: ${imageSize} bytes`,
  ].join('\n');
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${lines}\n`);
  process.stdout.write(`${lines}\n`);
}

const username = required('DOCKERHUB_USERNAME');
const repository = required('DOCKERHUB_IMAGE');
const expectedUsername = required('EXPECTED_DOCKERHUB_USERNAME');
const expectedRepository = required('EXPECTED_DOCKERHUB_IMAGE');
const version = required('RELEASE_VERSION');
const sha = required('RELEASE_SHA').toLowerCase();
const localReference = required('LOCAL_IMAGE_REF');
const expected = {
  title: process.env.EXPECTED_IMAGE_TITLE?.trim() || 'ca-agent-runtime',
  source: required('EXPECTED_IMAGE_SOURCE'),
  version,
  sha,
};

if (username !== 'eduardomatuellacostaapps' || username !== expectedUsername) {
  throw new Error('Docker Hub username does not match the approved repository owner.');
}
if (repository !== `${username}/ca` || repository !== expectedRepository) {
  throw new Error('Docker Hub image must be eduardomatuellacostaapps/ca.');
}
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error(`Refusing to publish a non-stable version: ${version}.`);
}
if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('RELEASE_SHA must be the full commit SHA.');

const versionReference = `${repository}:agent-runtime-${version}`;
const shaReference = `${repository}:agent-runtime-sha-${sha}`;
if (!versionReference.startsWith(`${username}/ca:agent-runtime-`) || !shaReference.startsWith(`${username}/ca:agent-runtime-sha-`)) {
  throw new Error('Refusing to publish outside the AgentRuntime-only tag namespace.');
}

const localImage = verifyImage(inspectLocal(localReference), expected);
const localId = localImage.Id;
const remoteVersion = pullIfPresent(versionReference);
const remoteSha = pullIfPresent(shaReference);
let selectedImage;

if (remoteVersion) {
  verifyImage(remoteVersion, expected);
  selectedImage = remoteVersion;
  if (remoteSha) {
    verifyImage(remoteSha, expected);
    const versionDigest = registryDigest(versionReference);
    const shaDigest = registryDigest(shaReference);
    if (versionDigest !== shaDigest) {
      throw new Error(`Existing version and commit tags point to different digests (${versionDigest} vs ${shaDigest}); refusing to overwrite either tag.`);
    }
  } else {
    docker(['tag', versionReference, shaReference]);
    docker(['push', shaReference]);
    selectedImage = pullIfPresent(versionReference);
  }
} else if (remoteSha) {
  verifyImage(remoteSha, expected);
  docker(['tag', shaReference, versionReference]);
  docker(['push', versionReference]);
  selectedImage = pullIfPresent(versionReference);
} else {
  if (inspectLocal(localReference).Id !== localId) {
    throw new Error('The tested local image changed before publication.');
  }
  docker(['tag', localReference, versionReference]);
  docker(['tag', versionReference, shaReference]);
  docker(['push', versionReference]);
  docker(['push', shaReference]);
  selectedImage = pullIfPresent(versionReference);
  const pushedSha = pullIfPresent(shaReference);
  if (!selectedImage || !pushedSha) throw new Error('Published tags could not be pulled back for verification.');
  verifyImage(selectedImage, expected);
  verifyImage(pushedSha, expected);
  if (registryDigest(versionReference) !== registryDigest(shaReference)) {
    throw new Error('The two published Agent Runtime tags do not resolve to the same digest.');
  }
}

if (!selectedImage) throw new Error('Unable to resolve the published image after push/reuse.');
verifyImage(selectedImage, expected);
const digest = registryDigest(versionReference);
const finalShaImage = pullIfPresent(shaReference);
if (!finalShaImage) throw new Error(`Expected commit tag ${shaReference} is missing after publication.`);
verifyImage(finalShaImage, expected);
if (registryDigest(shaReference) !== digest) {
  throw new Error('The version and commit tags do not point to the same image digest.');
}

outputSummary({ repository, version, sha, digest, imageSize: selectedImage.Size ?? 'unknown' });
