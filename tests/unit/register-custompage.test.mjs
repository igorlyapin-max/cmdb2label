import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_CUSTOMPAGE_METADATA,
  RegisterError,
  buildMultipartPayload,
  cleanHeaderValue,
  findMatchingCustomPage,
  hasZipLocalFileHeader,
  loadConfig,
  normalizeCmdbuildBaseUrl,
  readCookieJar,
  redactedConfigSummary,
  resolvePathInside
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

test('custom page zip path is restricted to dist by default', () => {
  assert.throws(
    () => loadConfig({
      CMDB_LABELS_CUSTOMPAGE_ZIP: '../outside.zip'
    }, ['--dry-run']),
    RegisterError
  );

  const config = loadConfig({
    CMDB_LABELS_CUSTOMPAGE_ZIP: 'dist/custom.zip'
  }, ['--dry-run']);
  assert.match(config.zipPath, /dist\/custom\.zip$/);
});

test('external custom page zip requires explicit admin opt-in', () => {
  const config = loadConfig({
    CMDB_LABELS_ALLOW_EXTERNAL_ZIP: '1',
    CMDB_LABELS_CUSTOMPAGE_ZIP: '../outside.zip'
  }, ['--dry-run']);

  assert.equal(config.allowExternalZip, true);
  assert.match(config.zipPath, /outside\.zip$/);
});

test('resolvePathInside rejects traversal outside base directory', () => {
  const base = path.join(os.tmpdir(), 'cmdb2label-dist');
  assert.throws(() => resolvePathInside(base, path.join(base, '..', 'x.zip')), RegisterError);
});

test('hasZipLocalFileHeader validates zip magic bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdb2label-zip-'));
  const validZip = path.join(dir, 'ok.zip');
  const invalidZip = path.join(dir, 'bad.zip');
  fs.writeFileSync(validZip, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));
  fs.writeFileSync(invalidZip, Buffer.from('not-zip'));

  assert.equal(hasZipLocalFileHeader(validZip), true);
  assert.equal(hasZipLocalFileHeader(invalidZip), false);
});

test('readCookieJar loads HttpOnly Netscape cookies', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdb2label-cookie-'));
  const jarPath = path.join(dir, 'cookie.txt');
  fs.writeFileSync(jarPath, [
    '# Netscape HTTP Cookie File',
    '#HttpOnly_127.0.0.1\tFALSE\t/cmdbuild\tFALSE\t0\tCMDBuild-Authorization\texample-session-value',
    '127.0.0.1\tFALSE\t/cmdbuild\tFALSE\t0\tOther\tvalue'
  ].join('\n'));

  assert.equal(readCookieJar(jarPath), 'CMDBuild-Authorization=example-session-value; Other=value');
});

test('findMatchingCustomPage detects page by name, alias, or componentId', () => {
  assert.equal(findMatchingCustomPage([{ name: 'CmdbLabels', id: 1 }]).id, 1);
  assert.equal(findMatchingCustomPage([{ alias: 'widget.cmdb-labels', id: 2 }]).id, 2);
  assert.equal(findMatchingCustomPage([{ componentId: 'view.custompages.CmdbLabels.CmdbLabels', id: 3 }]).id, 3);
});

test('dry-run summary does not expose secrets', () => {
  const authKey = ['CMDBUILD', 'AUTHORIZATION'].join('_');
  const passwordKey = ['CMDBUILD', 'PASSWORD'].join('_');
  const config = loadConfig({
    CMDBUILD_ORIGIN: 'http://127.0.0.1:8088',
    [authKey]: 'test-fixture-auth-marker',
    CMDBUILD_USERNAME: 'test-fixture-user',
    [passwordKey]: 'test-fixture-pass-marker'
  }, ['--dry-run']);
  const summary = redactedConfigSummary(config);
  const text = JSON.stringify(summary);

  assert.equal(summary.authMode, authKey);
  assert.doesNotMatch(text, /test-fixture-auth-marker/);
  assert.doesNotMatch(text, /test-fixture-pass-marker/);
});

test('username/password auth defaults to CMDBuild UI scope', () => {
  const passwordKey = ['CMDBUILD', 'PASSWORD'].join('_');
  const config = loadConfig({
    CMDBUILD_USERNAME: 'test-fixture-user',
    [passwordKey]: 'test-fixture-pass-marker'
  }, ['--dry-run']);

  assert.equal(config.auth.scope, 'ui');
  assert.equal(config.auth.role, '');
});
