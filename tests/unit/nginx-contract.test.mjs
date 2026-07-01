import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const nginxConfig = fs.readFileSync(new URL('../../nginx/cmdb2label-dev.conf', import.meta.url), 'utf8');
const nginxCompose = fs.readFileSync(new URL('../../docker-compose.nginx.yml', import.meta.url), 'utf8');

test('cmdb2label dev nginx exposes only backend-owned labels routes', () => {
  assert.match(nginxConfig, /location\s+\/cmdbuild\/custom-api\/labels\//);
  assert.match(nginxConfig, /location\s+\/cmdbuild\/labels\//);
  assert.match(nginxConfig, /location\s+\/health\//);
  assert.doesNotMatch(nginxConfig, /^\s*location\s+=\s+\/cmdbuild\s*\{/m);
  assert.doesNotMatch(nginxConfig, /^\s*location\s+\/cmdbuild\/\s*\{/m);
  assert.doesNotMatch(nginxConfig, /proxy_pass\s+http:\/\/127\.0\.0\.1:8094\/cmdbuild\/;/);
});

test('cmdb2label optional dev nginx does not claim the shared front port', () => {
  assert.match(nginxConfig, /^\s*listen\s+8095;/m);
  assert.match(nginxCompose, /127\.0\.0\.1:8095\/health\/live/);
  assert.doesNotMatch(nginxConfig, /^\s*listen\s+8088;/m);
});
