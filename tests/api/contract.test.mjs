import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const proxyOrigin = process.env.CMDB_LABELS_PROXY || 'http://127.0.0.1:8094';
const apiPrefix = '/cmdbuild/custom-api/labels';
const proxyAvailable = await canReach(`${proxyOrigin}${apiPrefix}/health/live`);
const skipWhenUnavailable = proxyAvailable ? false : `cmdb2label service is not reachable at ${proxyOrigin}`;

test('labels health live endpoint reports process liveness', { skip: skipWhenUnavailable }, async () => {
  const result = await request('GET', `${proxyOrigin}${apiPrefix}/health/live`);

  assert.equal(result.statusCode, 200);
  const json = JSON.parse(result.body);
  assert.equal(json.service, 'cmdb2label');
  assert.equal(json.live, true);
});

test('labels health ready endpoint reports CMDBuild readiness state', { skip: skipWhenUnavailable }, async () => {
  const result = await request('GET', `${proxyOrigin}${apiPrefix}/health/ready`);

  assert.ok([200, 503].includes(result.statusCode), `unexpected HTTP ${result.statusCode}`);
  const json = JSON.parse(result.body);
  assert.equal(json.service, 'cmdb2label');
  assert.equal(typeof json.ready, 'boolean');
  assert.ok(json.cmdbuild);
});

test('labels UI is served from backend-owned route', { skip: skipWhenUnavailable }, async () => {
  const result = await request('GET', `${proxyOrigin}/cmdbuild/labels/ui`);

  assert.equal(result.statusCode, 200);
  assert.match(String(result.headers['content-type'] || ''), /^text\/html/);
  assert.match(result.body, /Генератор этикеток/);
});

test('csrf endpoint requires CMDBuild session cookie', { skip: skipWhenUnavailable }, async () => {
  const result = await request('GET', `${proxyOrigin}${apiPrefix}/csrf`);

  assert.equal(result.statusCode, 401);
});

test('resolve rejects missing same-origin metadata before CMDBuild call', { skip: skipWhenUnavailable }, async () => {
  const result = await request('POST', `${proxyOrigin}${apiPrefix}/resolve`, {
    devices: [{ sn: 'SN123' }]
  }, {
    cookie: 'CMDBuild-Authorization=fake'
  });

  assert.equal(result.statusCode, 403);
});

test('resolve rejects non-json content type', { skip: skipWhenUnavailable }, async () => {
  const token = await fakeCsrfToken();

  const result = await request('POST', `${proxyOrigin}${apiPrefix}/resolve`, 'not-json', {
    cookie: 'CMDBuild-Authorization=fake',
    origin: proxyOrigin,
    'x-cmdb2label-csrf': token,
    'content-type': 'text/plain'
  });

  assert.equal(result.statusCode, 415);
});

test('resolve rejects non-array devices payload before CMDBuild lookup', { skip: skipWhenUnavailable }, async () => {
  const token = await fakeCsrfToken();

  const result = await request('POST', `${proxyOrigin}${apiPrefix}/resolve`, {
    devices: { sn: 'SN123' }
  }, {
    cookie: 'CMDBuild-Authorization=fake',
    origin: proxyOrigin,
    'x-cmdb2label-csrf': token
  });

  assert.equal(result.statusCode, 400);
  assert.match(result.body, /devices/);
});

test('resolve rejects oversized device batches before CMDBuild lookup', { skip: skipWhenUnavailable }, async () => {
  const token = await fakeCsrfToken();
  const devices = Array.from({ length: 101 }, (_, index) => ({ sn: `SN-${index}` }));

  const result = await request('POST', `${proxyOrigin}${apiPrefix}/resolve`, { devices }, {
    cookie: 'CMDBuild-Authorization=fake',
    origin: proxyOrigin,
    'x-cmdb2label-csrf': token
  });

  assert.equal(result.statusCode, 413);
  assert.match(result.body, /100/);
});

test('logging status does not expose config to an invalid CMDBuild session', { skip: skipWhenUnavailable }, async () => {
  const result = await request('GET', `${proxyOrigin}${apiPrefix}/logging/status`, undefined, {
    cookie: 'CMDBuild-Authorization=fake'
  });

  assert.notEqual(result.statusCode, 200);
  assert.doesNotMatch(result.body, /"logging"/);
});

test('backend refuses generic CMDBuild REST proxy paths by default', { skip: skipWhenUnavailable }, async () => {
  const result = await request('GET', `${proxyOrigin}/cmdbuild/services/rest/v3/sessions/current`);

  assert.equal(result.statusCode, 403);
  assert.match(result.body, /not allowed/);
});

async function canReach(url) {
  try {
    const result = await request('GET', url, undefined, {}, 1500);
    return result.statusCode > 0;
  } catch {
    return false;
  }
}

async function fakeCsrfToken() {
  const csrf = await request('GET', `${proxyOrigin}${apiPrefix}/csrf`, undefined, {
    cookie: 'CMDBuild-Authorization=fake'
  });
  assert.equal(csrf.statusCode, 200);
  return JSON.parse(csrf.body).token;
}

function request(method, url, body, extraHeaders = {}, timeoutMs = 5000) {
  const target = new URL(url);
  const transport = target.protocol === 'https:' ? https : http;
  const payload = body === undefined
    ? null
    : typeof body === 'string'
      ? body
      : JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const headers = {
      accept: 'application/json,text/html,*/*',
      ...extraHeaders
    };
    if (payload !== null) {
      if (!hasHeader(headers, 'content-type')) headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }
    const req = transport.request({
      method,
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      headers,
      timeout: timeoutMs
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8')
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function hasHeader(headers, name) {
  const normalized = String(name || '').toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === normalized);
}
