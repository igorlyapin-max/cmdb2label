#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const tags = [];
let verified = false;
let pull = true;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--tag' || arg === '-t') {
    const value = args[index + 1];
    if (!value) usage('Missing value for --tag.');
    tags.push(value);
    index += 1;
  } else if (arg === '--verified') {
    verified = true;
  } else if (arg === '--no-pull') {
    pull = false;
  } else {
    usage(`Unsupported argument: ${arg}`);
  }
}

if (!tags.length) usage('At least one --tag is required.');

const version = fs.readFileSync('VERSION', 'utf8').trim();
if (!/^\d{2}\.\d{2}\.\d{2}\.\d{2}$/.test(version)) {
  throw new Error(`Invalid VERSION: ${version}`);
}

const revision = git(['rev-parse', 'HEAD']).trim();
const sourceStatus = git(['status', '--porcelain', '--untracked-files=no']).trim();
const sourceState = verified ? 'verified' : 'unverified-local';
if (verified && sourceStatus) {
  throw new Error('Refusing verified image build from dirty tracked source.');
}

const artifactSha256 = crypto.createHash('sha256').update(fs.readFileSync('cmdb2label.html')).digest('hex');
const dockerArgs = [
  'build',
  ...(pull ? ['--pull'] : []),
  '--build-arg', `CMDB_LABELS_BUILD_VERSION=${version}`,
  '--build-arg', `CMDB_LABELS_BUILD_REVISION=${revision}`,
  '--build-arg', `CMDB_LABELS_BUILD_SOURCE_STATE=${sourceState}`,
  '--build-arg', `CMDB_LABELS_RUNTIME_ARTIFACT_SHA256=${artifactSha256}`,
  ...tags.flatMap((tag) => ['-t', tag]),
  '.'
];

run('docker', dockerArgs);

const primaryTag = tags[0];
const labels = JSON.parse(run('docker', [
  'image',
  'inspect',
  primaryTag,
  '--format',
  '{{json .Config.Labels}}'
], { capture: true }).trim());

assertEqual(labels['org.opencontainers.image.version'], version, 'OCI version label');
assertEqual(labels['org.opencontainers.image.revision'], revision, 'OCI revision label');
assertEqual(labels['org.opencontainers.image.source-state'], sourceState, 'OCI source-state label');
assertEqual(labels['org.opencontainers.image.runtime-artifact-sha256'], artifactSha256, 'OCI runtime artifact label');

const imageVersion = run('docker', ['run', '--rm', primaryTag, 'cat', '/app/VERSION'], { capture: true }).trim();
assertEqual(imageVersion, version, 'image /app/VERSION');

console.log(JSON.stringify({
  image: primaryTag,
  tags,
  version,
  revision,
  sourceState,
  runtimeArtifactSha256: artifactSha256
}, null, 2));

function usage(message) {
  if (message) console.error(message);
  console.error('Usage: node scripts/build-image.mjs --tag <image:tag> [--tag <image:tag>] [--verified] [--no-pull]');
  process.exit(2);
}

function git(gitArgs) {
  return run('git', gitArgs, { capture: true });
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: options.capture ? 'utf8' : undefined
  });
  if (result.status !== 0) {
    const stderr = options.capture ? String(result.stderr || '') : '';
    throw new Error(`${command} ${commandArgs.join(' ')} failed${stderr ? `: ${stderr.trim()}` : ''}`);
  }
  return options.capture ? String(result.stdout || '') : '';
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}
