import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const nginxConfig = fs.readFileSync(new URL('../../nginx/cmdb2label-dev.conf', import.meta.url), 'utf8');
const nginxCompose = fs.readFileSync(new URL('../../docker-compose.nginx.yml', import.meta.url), 'utf8');
const customerCompose = fs.readFileSync(new URL('../../docker-compose.customer.yml', import.meta.url), 'utf8');
const customerCaCompose = fs.readFileSync(new URL('../../docker-compose.customer-ca.yml', import.meta.url), 'utf8');
const dockerfile = fs.readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
const aptSources = fs.readFileSync(new URL('../../apt/debian.sources', import.meta.url), 'utf8');
const sharedNginxUrl = new URL('../../../cmdbcustompages/nginx/cmdbdynamicpages.conf', import.meta.url);
const sharedNginxConfig = fs.existsSync(sharedNginxUrl) ? fs.readFileSync(sharedNginxUrl, 'utf8') : '';

test('cmdb2label dev nginx exposes only backend-owned labels routes', () => {
  assert.match(nginxConfig, /location\s+\/cmdbuild\/custom-api\/labels\//);
  assert.match(nginxConfig, /location\s+\/cmdbuild\/labels\//);
  assert.match(nginxConfig, /location\s+\/health\//);
  assert.doesNotMatch(nginxConfig, /^\s*location\s+=\s+\/cmdbuild\s*\{/m);
  assert.doesNotMatch(nginxConfig, /^\s*location\s+\/cmdbuild\/\s*\{/m);
  assert.doesNotMatch(nginxConfig, /proxy_pass\s+http:\/\/127\.0\.0\.1:8094\/cmdbuild\/;/);
});

test('cmdb2label optional dev nginx does not claim the shared front port', () => {
  assert.match(nginxConfig, /^\s*listen\s+8095\s+default_server;/m);
  assert.match(nginxCompose, /"nginx", "-t"/);
  assert.equal(nginxCompose.includes(['w', 'get'].join('')), false);
  assert.doesNotMatch(nginxCompose, /http:\/\/127\.0\.0\.1:8095/);
  assert.doesNotMatch(nginxConfig, /^\s*listen\s+8088;/m);
});

test('container healthchecks avoid downloader over cleartext URLs', () => {
  assert.equal(dockerfile.includes(['w', 'get'].join('')), false);
  assert.doesNotMatch(dockerfile, /http:\/\/127\.0\.0\.1:8094/);
  assert.match(dockerfile, /node -e/);
});

test('container image embeds handoff VERSION source of truth', () => {
  assert.match(dockerfile, /^\s*COPY\s+VERSION\s+\.\/VERSION\s*$/m);
});

test('container image declares build provenance args and OCI labels', () => {
  assert.match(dockerfile, /^\s*ARG\s+CMDB_LABELS_BUILD_VERSION=/m);
  assert.match(dockerfile, /^\s*ARG\s+CMDB_LABELS_BUILD_REVISION=/m);
  assert.match(dockerfile, /^\s*ARG\s+CMDB_LABELS_BUILD_SOURCE_STATE=/m);
  assert.match(dockerfile, /^\s*ARG\s+CMDB_LABELS_RUNTIME_ARTIFACT_SHA256=/m);
  assert.match(dockerfile, /^\s*ARG\s+CMDB_LABELS_BUILD_MODE=manual/m);
  assert.match(dockerfile, /org\.opencontainers\.image\.version="\$\{CMDB_LABELS_BUILD_VERSION\}"/);
  assert.match(dockerfile, /org\.opencontainers\.image\.revision="\$\{CMDB_LABELS_BUILD_REVISION\}"/);
  assert.match(dockerfile, /org\.opencontainers\.image\.source-state="\$\{CMDB_LABELS_BUILD_SOURCE_STATE\}"/);
  assert.match(dockerfile, /org\.opencontainers\.image\.runtime-artifact-sha256="\$\{CMDB_LABELS_RUNTIME_ARTIFACT_SHA256\}"/);
  assert.match(dockerfile, /org\.opencontainers\.image\.build-mode="\$\{CMDB_LABELS_BUILD_MODE\}"/);
  assert.match(dockerfile, /build-identity\.json/);
  assert.match(dockerfile, /verified image provenance does not match build context/);
});

test('container image installs CA tooling for customer trust store', () => {
  assert.match(dockerfile, /apt-get\s+install\s+-y\s+--no-install-recommends\s+ca-certificates/);
  assert.match(dockerfile, /^\s*ARG\s+CMDB_LABELS_EMBED_CUSTOM_CA=optional$/m);
  assert.ok(
    dockerfile.indexOf('COPY certs/customer-ca /usr/local/share/ca-certificates/cmdb2label-customer') < dockerfile.indexOf('apt-get update'),
    'customer CA must be copied before apt-get update so OS repositories can use it'
  );
  assert.ok(
    dockerfile.indexOf('ca-certificates.crt') < dockerfile.indexOf('apt-get update'),
    'customer CA must be appended to the system bundle before apt-get update'
  );
  assert.match(dockerfile, /CMDB_LABELS_EMBED_CUSTOM_CA=required but certs\/customer-ca has no real \*\.crt or \*\.pem customer CA file/);
  assert.match(dockerfile, /!\s+-name '\*\.example'/);
  assert.match(dockerfile, /update-ca-certificates/);
});

test('container image declares APT sources before package manager network access', () => {
  assert.match(dockerfile, /^\s*COPY\s+apt\/debian\.sources\s+\/etc\/apt\/sources\.list\.d\/debian\.sources\s*$/m);
  assert.ok(
    dockerfile.indexOf('COPY apt/debian.sources /etc/apt/sources.list.d/debian.sources') < dockerfile.indexOf('apt-get update'),
    'APT sources must be copied before apt-get update'
  );
  assert.match(aptSources, /URIs:\s+http:\/\/deb\.debian\.org\/debian/);
  assert.match(aptSources, /URIs:\s+http:\/\/deb\.debian\.org\/debian-security/);
  assert.match(aptSources, /Suites:\s+bookworm bookworm-updates/);
  assert.match(aptSources, /Suites:\s+bookworm-security/);
});

test('container image uses deterministic non-root system user', () => {
  assert.match(dockerfile, /groupadd\s+--system\s+cmdb2label/);
  assert.match(dockerfile, /useradd\s+--system\s+--gid\s+cmdb2label\s+--no-create-home\s+--shell\s+\/usr\/sbin\/nologin\s+cmdb2label/);
  assert.match(dockerfile, /^\s*USER\s+cmdb2label\s*$/m);
  assert.doesNotMatch(dockerfile, /\baddgroup\b|\badduser\b/);
});

test('customer runtime compose is image-only and custom CA is an explicit override', () => {
  assert.match(customerCompose, /image:\s+\$\{CMDB2LABEL_IMAGE:-ghcr\.io\/igorlyapin-max\/cmdb2label:latest\}/);
  assert.doesNotMatch(customerCompose, /^\s*build:/m);
  assert.match(customerCompose, /env_file:/);
  assert.match(customerCaCompose, /CMDB_LABELS_CUSTOM_CA_MODE:\s+mount/);
  assert.match(customerCaCompose, /NODE_EXTRA_CA_CERTS:/);
  assert.match(customerCaCompose, /:ro/);
});

test('cmdb2label dev nginx rejects host injection and h2c upgrade forwarding', () => {
  assert.match(nginxConfig, /return\s+444;/);
  assert.match(nginxConfig, /proxy_set_header\s+Host\s+localhost:8095;/);
  assert.match(nginxConfig, /proxy_set_header\s+X-Forwarded-Host\s+localhost:8095;/);
  assert.doesNotMatch(nginxConfig, /\$http_host|\$host;/);
  assert.doesNotMatch(nginxConfig, /proxy_set_header\s+Upgrade/);
  assert.doesNotMatch(nginxConfig, /proxy_set_header\s+Connection/);
});

test('shared cmdbcustompages nginx keeps labels routes before broad routes', {
  skip: sharedNginxConfig ? false : 'shared cmdbcustompages nginx config is not present'
}, () => {
  const labelsApi = sharedNginxConfig.indexOf('location /cmdbuild/custom-api/labels/');
  const labelsUi = sharedNginxConfig.indexOf('location /cmdbuild/labels/');
  const broadApi = sharedNginxConfig.indexOf('location /cmdbuild/custom-api/ {');
  const broadUi = sharedNginxConfig.indexOf('location /cmdbuild/ {');

  assert.ok(labelsApi >= 0, 'labels custom-api route must exist in shared nginx');
  assert.ok(labelsUi >= 0, 'labels UI route must exist in shared nginx');
  assert.ok(broadApi >= 0, 'broad custom-api route must exist in shared nginx');
  assert.ok(broadUi >= 0, 'broad cmdbuild route must exist in shared nginx');
  assert.ok(labelsApi < broadApi, 'labels custom-api route must be before broad custom-api route');
  assert.ok(labelsUi < broadUi, 'labels UI route must be before broad cmdbuild route');
  assert.match(blockFor(sharedNginxConfig, 'location /cmdbuild/custom-api/labels/'), /proxy_pass\s+http:\/\/127\.0\.0\.1:8094\/cmdbuild\/custom-api\/labels\/;/);
  assert.match(blockFor(sharedNginxConfig, 'location /cmdbuild/labels/'), /proxy_pass\s+http:\/\/127\.0\.0\.1:8094\/cmdbuild\/labels\/;/);
  assert.match(blockFor(sharedNginxConfig, 'location /cmdbuild/custom-api/ {'), /proxy_pass\s+http:\/\/127\.0\.0\.1:8093\/cmdbuild\/custom-api\/;/);
});

function blockFor(config, marker) {
  const start = config.indexOf(marker);
  assert.ok(start >= 0, `missing nginx block marker: ${marker}`);
  let depth = 0;
  let bodyStarted = false;
  for (let index = start; index < config.length; index += 1) {
    const char = config[index];
    if (char === '{') {
      depth += 1;
      bodyStarted = true;
    } else if (char === '}') {
      depth -= 1;
      if (bodyStarted && depth === 0) return config.slice(start, index + 1);
    }
  }
  throw new Error(`nginx block is not closed: ${marker}`);
}
