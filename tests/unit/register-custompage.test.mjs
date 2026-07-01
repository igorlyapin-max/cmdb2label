import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_CUSTOMPAGE_METADATA,
  buildMultipartPayload,
  cleanHeaderValue,
  findMatchingCustomPage,
  loadConfig,
  normalizeCmdbuildBaseUrl,
  readCookieJar,
  redactedConfigSummary
} from '../../scripts/register-custompage.mjs';

test('custom page metadata matches CMDBuild registration contract', () => {
  assert.deepEqual(DEFAULT_CUSTOMPAGE_METADATA, {
    name: 'CmdbLabels',
    description: 'CMDB Labels',
    alias: 'widget.cmdb-labels',
    componentId: 'view.custompages.CmdbLabels.CmdbLabels',
    active: true
  });
});

test('normalizeCmdbuildBaseUrl accepts origin, cmdbuild path, and REST base', () => {
  assert.equal(normalizeCmdbuildBaseUrl('http://cmdb.example.org'), 'http://cmdb.example.org/cmdbuild');
  assert.equal(normalizeCmdbuildBaseUrl('http://cmdb.example.org/cmdbuild/'), 'http://cmdb.example.org/cmdbuild');
  assert.equal(
    normalizeCmdbuildBaseUrl('http://cmdb.example.org/cmdbuild/services/rest/v3'),
    'http://cmdb.example.org/cmdbuild'
  );
});

test('cleanHeaderValue accepts raw token or cookie-style value', () => {
  assert.equal(cleanHeaderValue('token-123'), 'token-123');
  assert.equal(cleanHeaderValue('CMDBuild-Authorization=token-123'), 'token-123');
});

test('buildMultipartPayload includes JSON data and zip file parts', () => {
  const { body, contentType } = buildMultipartPayload(DEFAULT_CUSTOMPAGE_METADATA, Buffer.from('ZIPDATA'), 'labels.zip');
  const text = body.toString('latin1');

  assert.match(contentType, /^multipart\/form-data; boundary=----cmdb2label-/);
  assert.match(text, /Content-Disposition: form-data; name="data"/);
  assert.match(text, /Content-Type: application\/json/);
  assert.match(text, /"componentId":"view.custompages.CmdbLabels.CmdbLabels"/);
  assert.match(text, /Content-Disposition: form-data; name="file"; filename="labels.zip"/);
  assert.match(text, /Content-Type: application\/zip/);
  assert.match(text, /ZIPDATA/);
});

test('readCookieJar loads HttpOnly Netscape cookies', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdb2label-cookie-'));
  const jarPath = path.join(dir, 'cookie.txt');
  fs.writeFileSync(jarPath, [
    '# Netscape HTTP Cookie File',
    '#HttpOnly_127.0.0.1\tFALSE\t/cmdbuild\tFALSE\t0\tCMDBuild-Authorization\tsecret-token',
    '127.0.0.1\tFALSE\t/cmdbuild\tFALSE\t0\tOther\tvalue'
  ].join('\n'));

  assert.equal(readCookieJar(jarPath), 'CMDBuild-Authorization=secret-token; Other=value');
});

test('findMatchingCustomPage detects page by name, alias, or componentId', () => {
  assert.equal(findMatchingCustomPage([{ name: 'CmdbLabels', id: 1 }]).id, 1);
  assert.equal(findMatchingCustomPage([{ alias: 'widget.cmdb-labels', id: 2 }]).id, 2);
  assert.equal(findMatchingCustomPage([{ componentId: 'view.custompages.CmdbLabels.CmdbLabels', id: 3 }]).id, 3);
});

test('dry-run summary does not expose secrets', () => {
  const config = loadConfig({
    CMDBUILD_ORIGIN: 'http://127.0.0.1:8088',
    CMDBUILD_AUTHORIZATION: 'very-secret-token',
    CMDBUILD_USERNAME: 'admin',
    CMDBUILD_PASSWORD: 'secret-password'
  }, ['--dry-run']);
  const summary = redactedConfigSummary(config);
  const text = JSON.stringify(summary);

  assert.equal(summary.authMode, 'CMDBUILD_AUTHORIZATION');
  assert.doesNotMatch(text, /very-secret-token/);
  assert.doesNotMatch(text, /secret-password/);
});

test('username/password auth defaults to CMDBuild UI scope', () => {
  const config = loadConfig({
    CMDBUILD_USERNAME: 'admin',
    CMDBUILD_PASSWORD: 'short'
  }, ['--dry-run']);

  assert.equal(config.auth.scope, 'ui');
  assert.equal(config.auth.role, '');
});
