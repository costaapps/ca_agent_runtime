import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

const tag = required('RELEASE_TAG');
const releaseSha = required('RELEASE_SHA').toLowerCase();
const prerelease = required('RELEASE_PRERELEASE');
const dockerHubUsername = required('DOCKERHUB_USERNAME');
const dockerHubImage = required('DOCKERHUB_IMAGE');
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);

if (prerelease !== 'false') throw new Error('Docker Hub publication accepts stable releases only.');
if (!match) throw new Error(`Release tag must be stable vX.Y.Z; received ${tag}.`);
const version = `${match[1]}.${match[2]}.${match[3]}`;
if (version !== manifest.version) {
  throw new Error(`Release version ${version} differs from package version ${manifest.version}.`);
}
if (dockerHubUsername !== 'eduardomatuellacostaapps' || dockerHubImage !== `${dockerHubUsername}/ca`) {
  throw new Error('Set the approved repository variables DOCKERHUB_USERNAME=eduardomatuellacostaapps and DOCKERHUB_IMAGE=eduardomatuellacostaapps/ca.');
}

const head = git(['rev-parse', 'HEAD']).toLowerCase();
const taggedCommit = git(['rev-parse', `${tag}^{commit}`]).toLowerCase();
if (head !== releaseSha || taggedCommit !== releaseSha) {
  throw new Error(`Checked-out commit, release event SHA, and tag target must match exactly (HEAD=${head}, event=${releaseSha}, tag=${taggedCommit}).`);
}

let mainRef = 'refs/remotes/origin/main';
let mainAvailable = spawnSync('git', ['rev-parse', '--verify', mainRef], { encoding: 'utf8' }).status === 0;
if (!mainAvailable) {
  const fetch = spawnSync('git', ['fetch', '--no-tags', 'origin', `+refs/heads/main:${mainRef}`], { encoding: 'utf8' });
  if (fetch.status !== 0) throw new Error(`Unable to fetch main for ancestry validation: ${fetch.stderr.trim()}`);
}
const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', releaseSha, mainRef], { encoding: 'utf8' });
if (ancestry.status !== 0) throw new Error(`Release commit ${releaseSha} is not an ancestor of main.`);

const repository = dockerHubImage;
const image = `${repository}:agent-runtime-${version}`;
const output = required('GITHUB_OUTPUT');
appendFileSync(output, `version=${version}\nsha=${releaseSha}\nimage=${image}\n`);
process.stdout.write(`Validated stable release ${tag} at ${releaseSha}, included in main.\n`);
