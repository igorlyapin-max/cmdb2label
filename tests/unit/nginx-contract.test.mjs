import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const nginxConfig = fs.readFileSync(new URL('../../nginx/cmdb2label-dev.conf', import.meta.url), 'utf8');
const nginxCompose = fs.readFileSync(new URL('../../docker-compose.nginx.yml', import.meta.url), 'utf8');
const dockerfile = fs.readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
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
