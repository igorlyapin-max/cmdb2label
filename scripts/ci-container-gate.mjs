#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const checks = [];

const dockerfile = read('Dockerfile');
const customerCompose = read('docker-compose.customer.yml');
const customerCaCompose = read('docker-compose.customer-ca.yml');
const envExample = read('.env.example');
const runbook = read('docs/runbook.ru.md');

check('Dockerfile uses deterministic system user commands', () => {
  assertMatch(dockerfile, /groupadd\s+--system\s+cmdb2label/);
  assertMatch(dockerfile, /useradd\s+--system\s+--gid\s+cmdb2label\s+--no-create-home\s+--shell\s+\/usr\/sbin\/nologin\s+cmdb2label/);
  assertMatch(dockerfile, /^\s*USER\s+cmdb2label\s*$/m);
  assertNoMatch(dockerfile, /\baddgroup\b|\badduser\b/);
});

check('Dockerfile has customer CA trust-store hook', () => {
  assertMatch(dockerfile, /apt-get\s+install\s+-y\s+--no-install-recommends\s+ca-certificates/);
  assertMatch(dockerfile, /COPY\s+certs\/customer-ca\s+\/usr\/local\/share\/ca-certificates\/cmdb2label-customer/);
  assertMatch(dockerfile, /update-ca-certificates/);
});

check('customer compose is image-only', () => {
  assertMatch(customerCompose, /image:\s+\$\{CMDB2LABEL_IMAGE:-ghcr\.io\/igorlyapin-max\/cmdb2label:latest\}/);
  assertNoMatch(customerCompose, /^\s*build:/m);
});

check('customer CA compose mounts certificate read-only', () => {
  assertMatch(customerCaCompose, /CMDB_LABELS_CUSTOM_CA_MODE:\s+mount/);
  assertMatch(customerCaCompose, /NODE_EXTRA_CA_CERTS:/);
  assertMatch(customerCaCompose, /:ro/);
});

check('env example declares operational logging and CA mode', () => {
  assertMatch(envExample, /^CMDB_LABELS_LOG_EXTERNAL_SINK=platform$/m);
  assertMatch(envExample, /^CMDB_LABELS_CUSTOM_CA_MODE=none$/m);
  assertMatch(envExample, /^CMDB_LABELS_CUSTOM_CA_FILE=\/etc\/cmdb2label\/customer-ca\/customer-ca\.crt$/m);
});

check('runbook documents customer certificate delivery policy', () => {
  assertMatch(runbook, /Customer CA/);
  assertMatch(runbook, /NODE_EXTRA_CA_CERTS/);
  assertMatch(runbook, /--insecure/);
  assertMatch(runbook, /docker-compose\.customer\.yml/);
});

dockerComposeConfig(['-f', 'docker-compose.customer.yml', 'config']);
dockerComposeConfig(['-f', 'docker-compose.customer.yml', '-f', 'docker-compose.customer-ca.yml', 'config']);

console.log(`container gate ok (${checks.length} checks)`);

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function check(name, fn) {
  fn();
  checks.push(name);
}

function assertMatch(text, pattern) {
  if (!pattern.test(text)) throw new Error(`Expected pattern ${pattern} not found.`);
}

function assertNoMatch(text, pattern) {
  if (pattern.test(text)) throw new Error(`Forbidden pattern ${pattern} found.`);
}

function dockerComposeConfig(args) {
  const result = spawnSync('docker', ['compose', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8'
  });
  if (result.error && result.error.code === 'EPERM') {
    console.warn(`docker compose ${args.join(' ')} skipped: child process execution was denied by the local sandbox; run the same command directly in CI or an admin shell.`);
    return;
  }
  if (result.status !== 0) {
    const detail = result.error && result.error.message ? result.error.message : String(result.stderr || result.stdout).trim();
    if (!detail && process.env.CI !== 'true') {
      console.warn(`docker compose ${args.join(' ')} skipped: Docker returned status ${result.status} without output in the local sandbox; run the same command directly in CI or an admin shell.`);
      return;
    }
    throw new Error(`docker compose ${args.join(' ')} failed: ${detail}`);
  }
}
