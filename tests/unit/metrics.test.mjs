import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {
  createServer,
  incMetric,
  observeHistogram,
  renderMetrics,
  resetMetricsForTests
} from '../../src/server.mjs';

const metricsMap = fs.readFileSync(new URL('../../aa/metrics-map.md', import.meta.url), 'utf8');

test('cold metrics exposition includes metadata and build identity without stale samples', () => {
  resetMetricsForTests();

  const text = renderMetrics();

  assert.match(text, /^# TYPE cmdb2label_http_requests_total counter$/m);
  assert.match(text, /^# TYPE cmdb2label_http_request_duration_seconds histogram$/m);
  assert.match(text, /^# TYPE cmdb2label_cmdbuild_proxy_request_duration_seconds histogram$/m);
  assert.match(text, /^cmdb2label_build_info\{build_mode="[^"]+",revision="[^"]+",source_state="[^"]+",version="[^"]+"\} 1$/m);
  assert.doesNotMatch(text, /^cmdb2label_http_requests_total\{/m);
  assert.doesNotMatch(text, /^cmdb2label_http_request_duration_seconds_bucket\{/m);
});

test('Prometheus metrics expose counters, histograms, and build identity', () => {
  resetMetricsForTests();

  incMetric('cmdb2label_http_requests_total', { route: 'labels-api', status: '2xx' });
  incMetric('cmdb2label_cmdbuild_requests_total', { method: 'GET', status: '2xx' });
  incMetric('cmdb2label_cmdbuild_proxy_requests_total', { method: 'GET', status: '2xx' });
  observeHistogram('cmdb2label_http_request_duration_seconds', 0.012, { route: 'labels-api', status: '2xx' });
  observeHistogram('cmdb2label_cmdbuild_request_duration_seconds', 0.034, { method: 'GET', status: '2xx' });
  observeHistogram('cmdb2label_cmdbuild_proxy_request_duration_seconds', 0.023, { method: 'GET', status: '2xx' });

  const text = renderMetrics();

  assert.match(text, /^# TYPE cmdb2label_http_requests_total counter$/m);
  assert.match(text, /^# TYPE cmdb2label_http_request_duration_seconds histogram$/m);
  assert.match(text, /^# TYPE cmdb2label_cmdbuild_requests_total counter$/m);
  assert.match(text, /^# TYPE cmdb2label_cmdbuild_request_duration_seconds histogram$/m);
  assert.match(text, /^# TYPE cmdb2label_cmdbuild_proxy_requests_total counter$/m);
  assert.match(text, /^# TYPE cmdb2label_cmdbuild_proxy_request_duration_seconds histogram$/m);
  assert.match(text, /^# TYPE cmdb2label_build_info gauge$/m);
  assert.match(text, /^cmdb2label_http_requests_total\{route="labels-api",status="2xx"\} 1$/m);
  assert.match(text, /^cmdb2label_http_request_duration_seconds_bucket\{route="labels-api",status="2xx",le="0.025"\} 1$/m);
  assert.match(text, /^cmdb2label_http_request_duration_seconds_bucket\{route="labels-api",status="2xx",le="\+Inf"\} 1$/m);
  assert.match(text, /^cmdb2label_http_request_duration_seconds_sum\{route="labels-api",status="2xx"\} 0.012$/m);
  assert.match(text, /^cmdb2label_http_request_duration_seconds_count\{route="labels-api",status="2xx"\} 1$/m);
  assert.match(text, /^cmdb2label_cmdbuild_request_duration_seconds_bucket\{method="GET",status="2xx",le="0.05"\} 1$/m);
  assert.match(text, /^cmdb2label_cmdbuild_proxy_request_duration_seconds_bucket\{method="GET",status="2xx",le="0.025"\} 1$/m);
  assert.match(text, /^cmdb2label_build_info\{build_mode="[^"]+",revision="[^"]+",source_state="[^"]+",version="[^"]+"\} 1$/m);
});

test('real server request records HTTP duration metrics through finish hook', async () => {
  resetMetricsForTests();
  const server = createServer();
  await listen(server);
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    await request(`${origin}/about`);
    const metrics = await request(`${origin}/metrics`);

    assert.match(metrics.body, /^cmdb2label_http_requests_total\{route="other",status="2xx"\} 1$/m);
    assert.match(metrics.body, /^cmdb2label_http_request_duration_seconds_bucket\{route="other",status="2xx",le="\+Inf"\} 1$/m);
    assert.match(metrics.body, /^cmdb2label_http_request_duration_seconds_sum\{route="other",status="2xx"\} [0-9.]+$/m);
    assert.match(metrics.body, /^cmdb2label_http_request_duration_seconds_count\{route="other",status="2xx"\} 1$/m);
  } finally {
    await close(server);
  }
});

test('real CMDBuild network error records request duration metric', async () => {
  const previousOrigin = process.env.CMDBUILD_ORIGIN;
  const previousTimeout = process.env.CMDB_LABELS_REQUEST_TIMEOUT_MS;
  const unavailablePort = await findUnusedPort();
  process.env.CMDBUILD_ORIGIN = `http://127.0.0.1:${unavailablePort}`;
  process.env.CMDB_LABELS_REQUEST_TIMEOUT_MS = '500';
  const fresh = await import(`../../src/server.mjs?metrics-network-${Date.now()}-${Math.random()}`);

  try {
    fresh.resetMetricsForTests();
    const payload = await fresh.readinessPayload();

    assert.equal(payload.ready, false);
    assert.equal(payload.status, 'not_ready');
    const metrics = fresh.renderMetrics();

    assert.match(metrics, /^cmdb2label_cmdbuild_requests_total\{method="GET",status="network"\} 1$/m);
    assert.match(metrics, /^cmdb2label_cmdbuild_request_duration_seconds_bucket\{method="GET",status="network",le="\+Inf"\} 1$/m);
    assert.match(metrics, /^cmdb2label_cmdbuild_request_duration_seconds_count\{method="GET",status="network"\} 1$/m);
  } finally {
    if (previousOrigin === undefined) delete process.env.CMDBUILD_ORIGIN;
    else process.env.CMDBUILD_ORIGIN = previousOrigin;
    if (previousTimeout === undefined) delete process.env.CMDB_LABELS_REQUEST_TIMEOUT_MS;
    else process.env.CMDB_LABELS_REQUEST_TIMEOUT_MS = previousTimeout;
  }
});

test('metrics labels remain bounded and do not include sensitive dynamic values', () => {
  resetMetricsForTests();

  incMetric('cmdb2label_http_requests_total', { route: 'labels-api', status: '4xx' });
  observeHistogram('cmdb2label_cmdbuild_request_duration_seconds', 0.001, { method: 'GET', status: 'network' });

  const text = renderMetrics();

  assert.doesNotMatch(text, /serial|inventory|username|payload|query|token|cookie|CNDDJSTGFT|7700010000160724/i);
  assert.doesNotMatch(text, /\/cmdbuild\/custom-api\/labels\/resolve/);
});

test('AA metrics map follows collection contract and catalogue requirements', () => {
  for (const marker of [
    '## Контракт сбора',
    'Collector',
    'Collection model',
    'Endpoint / protocol / port',
    'Cadence',
    'Expected response',
    'Failure semantics',
    'Operational purpose',
    '## Каталог метрик',
    'Implementation status',
    'Alert rule / dashboard',
    'Требует согласования'
  ]) {
    assert.match(metricsMap, new RegExp(escapeRegExp(marker)));
  }

  for (const metric of [
    'cmdb2label_http_requests_total',
    'cmdb2label_http_request_duration_seconds',
    'cmdb2label_cmdbuild_requests_total',
    'cmdb2label_cmdbuild_request_duration_seconds',
    'cmdb2label_cmdbuild_proxy_requests_total',
    'cmdb2label_cmdbuild_proxy_request_duration_seconds',
    'cmdb2label_build_info'
  ]) {
    assert.match(metricsMap, new RegExp(escapeRegExp(metric)));
  }

  assert.match(metricsMap, /OAPI1/);
  assert.match(metricsMap, /M0/);
  assert.match(metricsMap, /идентификаторы объектов, имена пользователей, request payloads, тексты ошибок, tokens/);
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function request(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode || 0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('request timeout')));
  });
}

function findUnusedPort() {
  const server = http.createServer();
  return listen(server)
    .then(() => {
      const port = server.address().port;
      return close(server).then(() => port);
    });
}
