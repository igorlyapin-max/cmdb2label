import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCmdbuildProxyPathAllowed,
  isCmdbuildUiCacheSensitive,
  isSafeRelativeRequestTarget,
  rewriteCmdbuildManifest,
  rewriteCmdbuildUiHtml
} from '../../src/server.mjs';

test('CMDBuild generic proxy is disabled by default', () => {
  assert.equal(isCmdbuildProxyPathAllowed('/cmdbuild'), false);
  assert.equal(isCmdbuildProxyPathAllowed('/cmdbuild/'), false);
  assert.equal(isCmdbuildProxyPathAllowed('/cmdbuild/ui/'), false);
  assert.equal(isCmdbuildProxyPathAllowed('/cmdbuild/ui/app/view/custompages/CmdbLabels/CmdbLabels.js'), false);
  assert.equal(isCmdbuildProxyPathAllowed('/cmdbuild/services/rest/v3/sessions/current'), false);

  assert.equal(isCmdbuildProxyPathAllowed('/cmdbuild/services/websocket/v1/main'), false);
  assert.equal(isCmdbuildProxyPathAllowed('/cmdbuild/services/geoserver'), false);
  assert.equal(isCmdbuildProxyPathAllowed('/cmdbuild/labels/ui'), false);
  assert.equal(isCmdbuildProxyPathAllowed('/cmdbuild/ui/', false, 'POST'), false);
});

test('CMDBuild proxy detects cache-sensitive UI resources', () => {
  assert.equal(isCmdbuildUiCacheSensitive('/cmdbuild/ui/'), true);
  assert.equal(isCmdbuildUiCacheSensitive('/cmdbuild/ui/config.js'), true);
  assert.equal(isCmdbuildUiCacheSensitive('/cmdbuild/ui/cmdbuild.json'), true);
  assert.equal(isCmdbuildUiCacheSensitive('/cmdbuild/ui/cmdbuild/app.js'), true);
  assert.equal(isCmdbuildUiCacheSensitive('/cmdbuild/ui/app/view/custompages/CmdbLabels/CmdbLabels.js'), true);
  assert.equal(isCmdbuildUiCacheSensitive('/cmdbuild/services/rest/v3/sessions/current'), false);
});

test('CMDBuild proxy rejects absolute or protocol-relative request targets', () => {
  assert.equal(isSafeRelativeRequestTarget('/cmdbuild/ui/config.js'), true);
  assert.equal(isSafeRelativeRequestTarget('/cmdbuild/ui/config.js?x=1'), true);
  assert.equal(isSafeRelativeRequestTarget('//evil.example/cmdbuild/ui/config.js'), false);
  assert.equal(isSafeRelativeRequestTarget('http://evil.example/cmdbuild/ui/config.js'), false);
});

test('CMDBuild UI HTML rewrite injects dev cache reset once', () => {
  const html = '<!doctype html><html><head><title>CMDBuild</title></head><body></body></html>';
  const rewritten = rewriteCmdbuildUiHtml(html);

  assert.match(rewritten, /cmdb2label-dev-cache-reset/);
  assert.match(rewritten, /window\.localStorage/);
  assert.match(rewritten, /ext-cache=/);
  assert.equal(rewriteCmdbuildUiHtml(rewritten), rewritten);
});

test('CMDBuild manifest rewrite disables Ext cache', () => {
  const rewritten = JSON.parse(rewriteCmdbuildManifest(JSON.stringify({
    hash: 'abc',
    cache: { enable: true },
    loader: {}
  })));

  assert.equal(rewritten.cache.enable, false);
  assert.equal(rewritten.appCacheEnabled, false);
  assert.equal(typeof rewritten.loader.cache, 'string');
  assert.match(rewritten.hash, /^abc-/);
});
