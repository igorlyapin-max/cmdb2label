import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const openapi = fs.readFileSync(new URL('../../aa/openapi.yaml', import.meta.url), 'utf8');
const cmdbuildConsumedOpenapi = fs.readFileSync(
  new URL('../../aa/openapi/cmdbuild-consumed.openapi.yaml', import.meta.url),
  'utf8'
);
const aaReadme = fs.readFileSync(new URL('../../aa/README.md', import.meta.url), 'utf8');

test('OpenAPI documents accepted risk only for operational public endpoints', () => {
  const publicPaths = [
    '/cmdbuild/labels/ui',
    '/cmdbuild/custom-api/labels/health/live',
    '/cmdbuild/custom-api/labels/health/ready',
    '/cmdbuild/custom-api/labels/about',
    '/health/live',
    '/health/ready',
    '/about',
    '/metrics'
  ];

  for (const path of publicPaths) {
    const block = pathBlock(path);
    assert.match(block, /security:\s*\[\]/);
    assert.match(block, /x-aspm-risk-accepted:\s*true/);
  }

  for (const path of [
    '/cmdbuild/custom-api/labels/session',
    '/cmdbuild/custom-api/labels/csrf',
    '/cmdbuild/custom-api/labels/resolve',
    '/cmdbuild/custom-api/labels/logging/status',
    '/cmdbuild/custom-api/labels/client-log'
  ]) {
    assert.doesNotMatch(pathBlock(path), /security:\s*\[\]/);
  }
});

test('OpenAPI constrains arrays and strings used by labels API', () => {
  const resolveRequest = schemaBlock('ResolveRequest');
  const resolveResponse = schemaBlock('ResolveResponse');
  const deviceDraft = schemaBlock('DeviceDraft');
  const errorResponse = schemaBlock('ErrorResponse');
  const csrfResponse = schemaBlock('CsrfResponse');
  const buildIdentity = schemaBlock('BuildIdentity');

  assert.match(propertyBlock(resolveRequest, 'devices'), /type:\s*array[\s\S]*maxItems:\s*100/);
  assert.match(propertyBlock(resolveResponse, 'devices'), /type:\s*array[\s\S]*maxItems:\s*100/);
  assert.match(propertyBlock(resolveResponse, 'errors'), /type:\s*array[\s\S]*maxItems:\s*100/);
  assert.match(propertyBlock(deviceDraft, 'inv'), /maxLength:\s*256[\s\S]*pattern:/);
  assert.match(propertyBlock(deviceDraft, 'model'), /maxLength:\s*256[\s\S]*pattern:/);
  assert.match(propertyBlock(deviceDraft, 'sn'), /maxLength:\s*256[\s\S]*pattern:/);
  assert.match(propertyBlock(errorResponse, 'message'), /maxLength:\s*512[\s\S]*pattern:/);
  assert.match(propertyBlock(csrfResponse, 'token'), /maxLength:\s*64[\s\S]*pattern:\s*'\^\[0-9a-f\]\{64\}\$'/);
  assert.match(propertyBlock(buildIdentity, 'version'), /pattern:\s*'\^\[0-9\]\{2\}\\\.\[0-9\]\{2\}\\\.\[0-9\]\{2\}\\\.\[0-9\]\{2\}\$'/);
});

test('OpenAPI response errors include content schemas without response $ref shortcuts', () => {
  assert.doesNotMatch(openapi, /^\s+"(?:400|401|403|413|415|502)":\n\s+\$ref:/m);
  for (const status of ['"400"', '"401"', '"403"', '"413"', '"415"', '"502"']) {
    const block = responseBlock(status);
    assert.match(block, /content:\n\s+application\/json:\n\s+schema:\n\s+\$ref: "#\/components\/schemas\/ErrorResponse"/);
  }
});

test('AA documents consumed CMDBuild REST endpoints separately from owned API', () => {
  assert.match(aaReadme, /openapi\/cmdbuild-consumed\.openapi\.yaml/);
  assert.doesNotMatch(openapi, /cmdbuild-consumed/);
  assert.match(openapi, /x-aa-flow-id:\s*OAPI0/);
  assert.match(openapi, /x-aa-flow-id:\s*H0/);
  assert.match(openapi, /x-aa-flow-id:\s*M0/);
  assert.match(cmdbuildConsumedOpenapi, /x-aa-flow-id:\s*OAPI1/);
  assert.match(cmdbuildConsumedOpenapi, /x-aa-flow-id:\s*OAPI2/);

  for (const path of [
    '/services/rest/v3/sessions/current',
    '/services/rest/v3/sessions/',
    '/services/rest/v3/classes',
    '/services/rest/v3/classes/{className}',
    '/services/rest/v3/classes/{className}/attributes',
    '/services/rest/v3/classes/{className}/cards',
    '/services/rest/v3/lookup_types/{lookupType}/values',
    '/services/rest/v3/custompages',
    '/services/rest/v3/custompages/{customPageId}'
  ]) {
    assert.match(cmdbuildConsumedOpenapi, new RegExp(`^  ${escapeRegExp(path)}:`, 'm'), `missing ${path}`);
  }

  assert.doesNotMatch(cmdbuildConsumedOpenapi, /^  \/services\/rest\/v3\/\*:/m);
  assert.doesNotMatch(cmdbuildConsumedOpenapi, /admin\/admin|BEGIN CERTIFICATE|password:\s*admin|set-cookie:\s*CMDBuild-Authorization=/i);
  assert.match(cmdbuildConsumedOpenapi, /Используется backend/);
  assert.match(cmdbuildConsumedOpenapi, /Регистрация thin launcher custom page/);
});

function pathBlock(marker) {
  return blockFromLine(`  ${marker}:`, /^  \/[^:\n]+:/m);
}

function schemaBlock(marker) {
  return blockFromLine(`    ${marker}:`, /^\s{4}[A-Za-z][A-Za-z0-9]*:/m);
}

function propertyBlock(parentBlock, marker) {
  return blockFromLine(`        ${marker}:`, /^\s{8}[A-Za-z][A-Za-z0-9]*:/m, parentBlock);
}

function responseBlock(marker) {
  return blockFromLine(`        ${marker}:`, /^\s{8}"[0-9]{3}":/m);
}

function blockFromLine(marker, nextPattern, source = openapi) {
  const start = source.search(new RegExp(`^${escapeRegExp(marker)}$`, 'm'));
  assert.ok(start >= 0, `missing marker ${marker}`);
  const rest = source.slice(start + marker.length);
  const match = nextPattern.exec(rest);
  const end = match ? start + marker.length + match.index : source.length;
  return source.slice(start, end);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
