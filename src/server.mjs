import crypto from 'node:crypto';
import dgram from 'node:dgram';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  FIELD_LABELS,
  REQUIRED_FIELDS,
  buildCmdbEqualFilter,
  buildFieldMap,
  buildFieldMetadataMap,
  cleanValue,
  cmdbCardToDevice,
  deviceRequiredErrors,
  displayCmdbValue,
  extractCmdbData,
  fieldMapAttributeName,
  hasLookupKey,
  isCompleteDevice,
  mergeLabelConfig,
  mergeResolvedDevice,
  normalizeDraftDevice,
  uniqueStrings
} from './labels-core.mjs';

const syslogFacilityCodes = {
  kern: 0,
  user: 1,
  mail: 2,
  daemon: 3,
  auth: 4,
  syslog: 5,
  lpr: 6,
  news: 7,
  uucp: 8,
  cron: 9,
  authpriv: 10,
  ftp: 11,
  local0: 16,
  local1: 17,
  local2: 18,
  local3: 19,
  local4: 20,
  local5: 21,
  local6: 22,
  local7: 23
};
const logLevelWeights = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const SERVICE = 'cmdb2label';
const STARTED_AT = new Date();
const LISTEN_HOST = process.env.CMDB_LABELS_HOST || '127.0.0.1';
const LISTEN_PORT = Number(process.env.CMDB_LABELS_PORT || 8094);
const CMDBUILD_ORIGIN = process.env.CMDBUILD_ORIGIN || 'http://127.0.0.1:8090';
const UI_PREFIX = '/cmdbuild/labels/ui';
const API_PREFIX = '/cmdbuild/custom-api/labels';
const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const UI_HTML_PATH = process.env.CMDB_LABELS_UI_HTML || path.join(ROOT_DIR, 'cmdb2label.html');
const DEV_CACHE_BUSTER = String(Date.now());
const REQUEST_TIMEOUT_MS = Math.max(500, Number(process.env.CMDB_LABELS_REQUEST_TIMEOUT_MS || 10000) || 10000);
const HEALTH_TIMEOUT_MS = Math.max(300, Number(process.env.CMDB_LABELS_HEALTH_TIMEOUT_MS || 2000) || 2000);
const CATALOG_TTL_MS = Math.max(10_000, Number(process.env.CMDB_LABELS_CATALOG_TTL_MS || 300_000) || 300_000);
const MAX_CLASSES = Math.max(1, Number(process.env.CMDB_LABELS_MAX_CLASSES || 400) || 400);
const MAX_SEARCH_CLASSES = Math.max(1, Number(process.env.CMDB_LABELS_MAX_SEARCH_CLASSES || 160) || 160);
const MAX_MATCHES = Math.max(1, Number(process.env.CMDB_LABELS_MAX_MATCHES || 50) || 50);
const DEFAULT_MAX_REST_CALLS = Math.max(250, MAX_CLASSES + MAX_SEARCH_CLASSES + 50);
const MAX_REST_CALLS = Math.max(10, Number(process.env.CMDB_LABELS_MAX_REST_CALLS || DEFAULT_MAX_REST_CALLS) || DEFAULT_MAX_REST_CALLS);
const MAX_RESOLVE_DEVICES = Math.max(1, Number(process.env.CMDB_LABELS_MAX_RESOLVE_DEVICES || 100) || 100);
const CARD_SEARCH_LIMIT = Math.max(1, Number(process.env.CMDB_LABELS_CARD_SEARCH_LIMIT || 20) || 20);
const CARD_FALLBACK_LIMIT = Math.max(CARD_SEARCH_LIMIT, Number(process.env.CMDB_LABELS_CARD_FALLBACK_LIMIT || 100) || 100);
const BODY_LIMIT_BYTES = Math.max(1024, Number(process.env.CMDB_LABELS_BODY_LIMIT_BYTES || 512 * 1024) || 512 * 1024);
const CSRF_SECRET = process.env.CMDB_LABELS_CSRF_SECRET || crypto.randomBytes(32).toString('hex');
const DIAGNOSTIC_MODE = normalizeDiagnosticMode(process.env.CMDB_LABELS_DIAGNOSTIC_MODE || 'off');
const LOG_LEVEL = normalizeLogLevel(process.env.CMDB_LABELS_LOG_LEVEL || 'info');
const LOG_FORMAT = normalizeLogFormat(process.env.CMDB_LABELS_LOG_FORMAT || 'json');
const LOG_TARGETS = normalizeLogTargets(process.env.CMDB_LABELS_LOG_TARGET || 'stdout');
const SYSLOG_HOST = process.env.CMDB_LABELS_SYSLOG_HOST || '127.0.0.1';
const SYSLOG_PORT = Number(process.env.CMDB_LABELS_SYSLOG_PORT || 514);
const SYSLOG_PROTOCOL = normalizeSyslogProtocol(process.env.CMDB_LABELS_SYSLOG_PROTOCOL || 'udp');
const SYSLOG_FACILITY = normalizeSyslogFacility(process.env.CMDB_LABELS_SYSLOG_FACILITY || 'local0');
const LOG_REDACT_HEADERS = new Set(['cookie', 'authorization', 'cmdbuild-authorization', 'x-cmdb2label-csrf', 'set-cookie']);
const CMDBUILD_PROXY_ALLOWLIST_STRICT = process.env.CMDB_LABELS_CMDBUILD_PROXY_ALLOWLIST_STRICT !== 'false';
const CMDBUILD_PROXY_ENABLED = process.env.CMDB_LABELS_ENABLE_CMDBUILD_PROXY === 'true';
const PROXY_COOKIE_SAMESITE = process.env.CMDB_LABELS_PROXY_COOKIE_SAMESITE || '';
const PROXY_COOKIE_SECURE = process.env.CMDB_LABELS_PROXY_COOKIE_SECURE || 'false';
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50, maxFreeSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50, maxFreeSockets: 10 });
const catalogCache = new Map();
const metricCounters = new Map();

let shuttingDown = false;

function normalizeDiagnosticMode(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'basic') return 'Basic';
  if (text === 'verbose') return 'Verbose';
  return 'off';
}

function diagnosticAllows(level) {
  if (DIAGNOSTIC_MODE === 'Verbose') return level === 'Basic' || level === 'Verbose';
  return DIAGNOSTIC_MODE === 'Basic' && level === 'Basic';
}

function normalizeLogLevel(value) {
  const text = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(logLevelWeights, text) ? text : 'info';
}

function normalizeLogFormat(value) {
  return String(value || '').trim().toLowerCase() === 'text' ? 'text' : 'json';
}

function normalizeLogTargets(value) {
  const targets = String(value || 'stdout')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item === 'stdout' || item === 'syslog');
  const unique = targets.length ? Array.from(new Set(targets)) : ['stdout'];
  return unique.includes('stdout') ? unique : ['stdout', ...unique];
}

function normalizeSyslogProtocol(value) {
  return String(value || '').trim().toLowerCase() === 'tcp' ? 'tcp' : 'udp';
}

function normalizeSyslogFacility(value) {
  const text = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(syslogFacilityCodes, text) ? text : 'local0';
}

function logLevelEnabled(level) {
  return (logLevelWeights[level] || logLevelWeights.info) >= (logLevelWeights[LOG_LEVEL] || logLevelWeights.info);
}

function sendSyslog(payload) {
  const pri = (syslogFacilityCodes[SYSLOG_FACILITY] * 8) + (payload.level === 'error' ? 3 : payload.level === 'warn' ? 4 : 6);
  const message = `<${pri}>1 ${payload.time} ${os.hostname()} ${SERVICE} ${process.pid} ${payload.event || '-'} - ${JSON.stringify(payload)}`;
  if (SYSLOG_PROTOCOL === 'tcp') {
    const socket = net.createConnection({ host: SYSLOG_HOST, port: SYSLOG_PORT }, () => socket.end(`${message}\n`));
    socket.setTimeout(1000, () => socket.destroy());
    socket.on('error', (error) => writeStderrLog('logging.syslog_failed', error));
    return;
  }
  const socket = dgram.createSocket('udp4');
  socket.send(Buffer.from(message), SYSLOG_PORT, SYSLOG_HOST, (error) => {
    socket.close();
    if (error) writeStderrLog('logging.syslog_failed', error);
  });
}

function writeStderrLog(event, error) {
  process.stderr.write(JSON.stringify({
    time: new Date().toISOString(),
    level: 'warn',
    service: SERVICE,
    event,
    error: error && error.message ? error.message : String(error)
  }) + '\n');
}

function writeLog(level, event, fields = {}, options = {}) {
  const normalizedLevel = normalizeLogLevel(level);
  if (!options.force && !logLevelEnabled(normalizedLevel)) return;
  const payload = {
    time: new Date().toISOString(),
    level: normalizedLevel,
    service: SERVICE,
    event,
    ...fields
  };
  const line = LOG_FORMAT === 'text'
    ? `${payload.time} ${payload.level.toUpperCase()} ${payload.event} ${JSON.stringify(fields)}`
    : JSON.stringify(payload);
  if (LOG_TARGETS.includes('stdout')) {
    const stream = normalizedLevel === 'error' ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
  }
  if (LOG_TARGETS.includes('syslog')) sendSyslog(payload);
}

function logDiagnostic(level, event, fields = {}) {
  if (!diagnosticAllows(level)) return;
  writeLog('info', `diagnostic.${event}`, { diagnosticMode: DIAGNOSTIC_MODE, ...fields }, { force: true });
}

function loggingStatus() {
  return {
    level: LOG_LEVEL,
    format: LOG_FORMAT,
    targets: LOG_TARGETS,
    diagnostic: {
      mode: DIAGNOSTIC_MODE,
      enabled: DIAGNOSTIC_MODE !== 'off',
      levels: ['Basic', 'Verbose']
    },
    redactHeaders: Array.from(LOG_REDACT_HEADERS).sort(),
    syslog: LOG_TARGETS.includes('syslog') ? {
      host: SYSLOG_HOST,
      port: SYSLOG_PORT,
      protocol: SYSLOG_PROTOCOL,
      facility: SYSLOG_FACILITY
    } : null
  };
}

function validateRuntimeConfig(input = {}) {
  const nodeEnv = String(input.nodeEnv === undefined ? process.env.NODE_ENV || '' : input.nodeEnv || '').trim();
  const csrfSecret = String(input.csrfSecret === undefined ? process.env.CMDB_LABELS_CSRF_SECRET || '' : input.csrfSecret || '').trim();
  const logTargets = input.logTargets || LOG_TARGETS;
  const errors = [];
  const warnings = [];

  if (nodeEnv.toLowerCase() === 'production' && !csrfSecret) {
    errors.push({
      code: 'csrf_secret_required',
      env: 'CMDB_LABELS_CSRF_SECRET',
      message: 'Production startup requires a stable external CSRF secret.'
    });
  }
  if (!Array.isArray(logTargets) || !logTargets.includes('stdout')) {
    errors.push({
      code: 'stdout_log_target_required',
      env: 'CMDB_LABELS_LOG_TARGET',
      message: 'Structured logs must always include stdout/stderr.'
    });
  }
  if (nodeEnv.toLowerCase() === 'production' && (!Array.isArray(logTargets) || !logTargets.some((target) => target !== 'stdout'))) {
    errors.push({
      code: 'operational_log_sink_required',
      env: 'CMDB_LABELS_LOG_TARGET',
      message: 'Production startup requires an operational log sink in addition to stdout, for example syslog.'
    });
  }
  if (DIAGNOSTIC_MODE === 'Verbose' && nodeEnv.toLowerCase() === 'production') {
    warnings.push({
      code: 'verbose_diagnostic_in_production',
      env: 'CMDB_LABELS_DIAGNOSTIC_MODE',
      message: 'Verbose diagnostics should be enabled only temporarily.'
    });
  }

  return { ok: errors.length === 0, nodeEnv, diagnosticMode: DIAGNOSTIC_MODE, logTargets, errors, warnings };
}

function runtimeConfigSummary(validation = validateRuntimeConfig()) {
  return {
    nodeEnv: validation.nodeEnv || 'development',
    diagnosticMode: validation.diagnosticMode,
    logTargets: validation.logTargets,
    errors: validation.errors.map((item) => item.code),
    warnings: validation.warnings.map((item) => item.code)
  };
}

function incMetric(name, labels = {}) {
  const key = `${name}|${JSON.stringify(Object.entries(labels).sort())}`;
  const current = metricCounters.get(key) || { name, labels: Object.fromEntries(Object.entries(labels).sort()), value: 0 };
  current.value += 1;
  metricCounters.set(key, current);
}

function renderMetrics() {
  const lines = [
    '# HELP cmdb2label_http_requests_total HTTP requests by route and status.',
    '# TYPE cmdb2label_http_requests_total counter'
  ];
  for (const item of [...metricCounters.values()].sort((left, right) => left.name.localeCompare(right.name))) {
    const labels = Object.entries(item.labels || {});
    const suffix = labels.length ? `{${labels.map(([name, value]) => `${name}="${String(value).replace(/"/g, '\\"')}"`).join(',')}}` : '';
    lines.push(`${item.name}${suffix} ${item.value}`);
  }
  return `${lines.join('\n')}\n`;
}

function securityHeaders(headers = {}) {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'self'",
    ...headers
  };
}

function sendJson(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, securityHeaders({
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...headers
  }));
  res.end(body);
}

function sendHtml(res, statusCode, body) {
  res.writeHead(statusCode, securityHeaders({
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  }));
  res.end(body);
}

function sendText(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, securityHeaders({
    'content-type': contentType,
    'content-length': Buffer.byteLength(body)
  }));
  res.end(body);
}

function getCookieValue(cookieHeader, name) {
  const parts = String(cookieHeader || '').split(';').map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    const separator = part.indexOf('=');
    const key = separator === -1 ? part : part.slice(0, separator);
    if (key === name) {
      const value = separator === -1 ? '' : part.slice(separator + 1);
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return '';
}

function authTokenFromRequest(req) {
  return getCookieValue(req.headers.cookie, 'CMDBuild-Authorization');
}

function csrfTokenFor(authToken) {
  return crypto.createHmac('sha256', CSRF_SECRET).update(String(authToken || '')).digest('hex');
}

function validateCsrf(req, authToken) {
  const actual = String(req.headers['x-cmdb2label-csrf'] || '');
  const expected = csrfTokenFor(authToken);
  if (!actual || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function sameOriginUrlFromRequest(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() || 'http';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

function isSameOriginRequest(req) {
  const expected = sameOriginUrlFromRequest(req);
  if (!expected) return false;
  const origin = req.headers.origin;
  if (origin) return origin === expected;
  const referer = req.headers.referer || req.headers.referrer;
  if (!referer) return false;
  try {
    return new URL(referer).origin === expected;
  } catch {
    return false;
  }
}

function isJsonContentType(req) {
  return String(req.headers['content-type'] || '').toLowerCase().split(';')[0].trim() === 'application/json';
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT_BYTES) {
        reject(Object.assign(new Error('Request body is too large.'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(Object.assign(new Error('Invalid JSON request body.'), { statusCode: 400, cause: error }));
      }
    });
    req.on('error', reject);
  });
}

function httpTransportForTarget(target) {
  return target.protocol === 'https:' ? https : http;
}

function agentForTarget(target) {
  return target.protocol === 'https:' ? httpsAgent : httpAgent;
}

function pathMatchesPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isCmdbuildProxyPathAllowed(pathname, strict = CMDBUILD_PROXY_ALLOWLIST_STRICT, method = 'GET') {
  if (!CMDBUILD_PROXY_ENABLED) return false;
  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (!['GET', 'HEAD'].includes(normalizedMethod)) return false;
  if (!strict) return true;
  const pathText = String(pathname || '/');
  return pathText === '/cmdbuild' ||
    pathText === '/cmdbuild/' ||
    pathMatchesPrefix(pathText, '/cmdbuild/ui');
}

function isCmdbuildUiEntry(pathname) {
  return pathname === '/cmdbuild/ui' || pathname === '/cmdbuild/ui/';
}

function isCmdbuildUiManifest(pathname) {
  return pathname === '/cmdbuild/ui/cmdbuild.json' || pathname === '/cmdbuild/ui/hda.json';
}

function isCmdbLabelsCustomPageScript(pathname) {
  return pathname.endsWith('/view/custompages/CmdbLabels/CmdbLabels.js');
}

function isCmdbuildUiCacheSensitive(pathname) {
  return isCmdbuildUiEntry(pathname) ||
    isCmdbuildUiManifest(pathname) ||
    pathname === '/cmdbuild/ui/config.js' ||
    pathname === '/cmdbuild/ui/cmdbuild/app.js' ||
    pathname === '/cmdbuild/ui/hda/app.js' ||
    isCmdbLabelsCustomPageScript(pathname);
}

function withNoStoreHeaders(headers) {
  const responseHeaders = { ...headers };
  responseHeaders['cache-control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate';
  responseHeaders.pragma = 'no-cache';
  responseHeaders.expires = '0';
  delete responseHeaders.etag;
  delete responseHeaders['content-encoding'];
  delete responseHeaders['content-length'];
  delete responseHeaders['transfer-encoding'];
  return responseHeaders;
}

function normalizeSameSiteValue(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'lax') return 'Lax';
  if (text === 'strict') return 'Strict';
  if (text === 'none') return 'None';
  return '';
}

function shouldMarkProxyCookieSecure() {
  const text = String(PROXY_COOKIE_SECURE || '').trim().toLowerCase();
  return text !== 'false' && text !== '0' && text !== 'no';
}

function rewriteProxySetCookieHeader(header) {
  if (!header) return header;
  const sameSite = normalizeSameSiteValue(PROXY_COOKIE_SAMESITE);
  const secure = shouldMarkProxyCookieSecure();

  function rewriteOne(cookie) {
    const parts = String(cookie || '').split(';').map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return cookie;
    const rewritten = [parts[0]];
    let hasSecure = false;
    for (const part of parts.slice(1)) {
      if (/^samesite=/i.test(part)) continue;
      if (/^secure$/i.test(part)) {
        hasSecure = true;
        rewritten.push('Secure');
        continue;
      }
      rewritten.push(part);
    }
    if (sameSite) rewritten.push(`SameSite=${sameSite}`);
    if (secure && !hasSecure) rewritten.push('Secure');
    return rewritten.join('; ');
  }

  return Array.isArray(header) ? header.map(rewriteOne) : rewriteOne(header);
}

function rewriteProxyResponseHeaders(headers) {
  const responseHeaders = { ...headers };
  if (responseHeaders['set-cookie']) {
    responseHeaders['set-cookie'] = rewriteProxySetCookieHeader(responseHeaders['set-cookie']);
  }
  return responseHeaders;
}

function rewriteCmdbuildUiHtml(body) {
  if (String(body || '').includes('cmdb2label-dev-cache-reset')) return body;
  const injection = [
    '<script type="text/javascript">',
    '(function(){try{',
    'var p="_ext:"+window.location.pathname;',
    'if(window.localStorage){',
    'for(var i=window.localStorage.length-1;i>=0;i--){',
    'var k=window.localStorage.key(i);',
    'if(k&&(k.indexOf(p)===0||k.indexOf("_ext:/cmdbuild/ui/")===0)){window.localStorage.removeItem(k);}',
    '}',
    '}',
    'document.cookie="ext-cache=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";',
    'if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(x){x.unregister();});});}',
    '}catch(e){}})();',
    '</script>'
  ].join('');
  return String(body || '').replace(
    '<head>',
    '<head>\n<meta name="cmdb2label-dev-cache-reset" content="' + DEV_CACHE_BUSTER + '">\n' + injection
  );
}

function rewriteCmdbuildManifest(body) {
  try {
    const manifest = JSON.parse(String(body || ''));
    manifest.cache = manifest.cache || {};
    manifest.cache.enable = false;
    manifest.appCacheEnabled = false;
    manifest.loader = manifest.loader || {};
    manifest.loader.cache = DEV_CACHE_BUSTER;
    manifest.hash = `${manifest.hash || 'dev'}-${DEV_CACHE_BUSTER}`;
    return JSON.stringify(manifest);
  } catch {
    return body;
  }
}

function statusClass(statusCode) {
  const status = Number(statusCode) || 0;
  if (status <= 0) return 'network';
  return `${Math.floor(status / 100)}xx`;
}

function sanitizeHeaders(headers = {}) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    if (LOG_REDACT_HEADERS.has(String(name).toLowerCase())) {
      result[name] = '[REDACTED]';
    } else {
      result[name] = Array.isArray(value) ? value.map((item) => String(item).slice(0, 200)) : String(value || '').slice(0, 200);
    }
  }
  return result;
}

function cmdbuildRequest(pathname, authToken = '', options = {}) {
  const target = new URL(pathname, CMDBUILD_ORIGIN);
  const method = String(options.method || 'GET').toUpperCase();
  const body = options.body === undefined ? null : JSON.stringify(options.body);
  const headers = { accept: 'application/json', ...(options.headers || {}) };
  if (authToken) headers['CMDBuild-Authorization'] = authToken;
  if (body !== null) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const req = httpTransportForTarget(target).request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method,
      headers,
      agent: agentForTarget(target),
      timeout: options.timeoutMs || REQUEST_TIMEOUT_MS
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
        }
        const statusCode = res.statusCode || 0;
        incMetric('cmdb2label_cmdbuild_requests_total', { method, status: statusClass(statusCode) });
        resolve({ ok: statusCode >= 200 && statusCode < 300, statusCode, headers: res.headers, body: text, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('CMDBuild request timeout')));
    req.on('error', (error) => {
      incMetric('cmdb2label_cmdbuild_requests_total', { method, status: 'network' });
      reject(error);
    });
    if (body !== null) req.write(body);
    req.end();
  });
}

async function countedCmdbuildRequest(pathname, authToken, context, options = {}) {
  if (context) assertRestBudget(context);
  const response = await cmdbuildRequest(pathname, authToken, options);
  if (context) context.restCalls += 1;
  return response;
}

async function currentSessionPayload(authToken) {
  if (!authToken) {
    return { ok: false, statusCode: 401, data: null };
  }
  const response = await cmdbuildRequest('/cmdbuild/services/rest/v3/sessions/current', authToken);
  return {
    ok: response.ok,
    statusCode: response.statusCode,
    data: response.json && response.json.data ? response.json.data : null
  };
}

function sanitizeSession(data) {
  if (!data || typeof data !== 'object') return null;
  return {
    active: true,
    username: cleanValue(data.username || data.userName || data.login || data.name),
    role: cleanValue(data.role || data.defaultRole || data.group)
  };
}

async function readinessPayload() {
  const payload = baseHealthPayload();
  try {
    const response = await cmdbuildRequest('/cmdbuild/services/rest/v3/sessions/current', '', { timeoutMs: HEALTH_TIMEOUT_MS });
    const upstreamReachable = response.statusCode > 0 && response.statusCode < 500;
    return {
      ...payload,
      ready: upstreamReachable,
      status: upstreamReachable ? 'ready' : 'not_ready',
      cmdbuild: {
        ok: upstreamReachable,
        statusCode: response.statusCode,
        origin: CMDBUILD_ORIGIN
      }
    };
  } catch (error) {
    return {
      ...payload,
      ready: false,
      status: 'not_ready',
      cmdbuild: {
        ok: false,
        origin: CMDBUILD_ORIGIN,
        error: error.message || String(error)
      }
    };
  }
}

function baseHealthPayload() {
  return {
    service: SERVICE,
    live: true,
    startedAt: STARTED_AT.toISOString(),
    uptimeSec: Math.round(process.uptime())
  };
}

function loadAliasConfig() {
  const text = process.env.CMDB_LABELS_ALIAS_CONFIG ||
    (process.env.CMDB_LABELS_ALIAS_CONFIG_FILE ? fs.readFileSync(process.env.CMDB_LABELS_ALIAS_CONFIG_FILE, 'utf8') : '');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid CMDB labels alias config JSON: ${error.message}`);
  }
}

function authCacheKey(authToken, labelConfig = {}) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      authToken: String(authToken || ''),
      aliases: labelConfig.aliases || {},
      derivedFields: labelConfig.derivedFields || {}
    }))
    .digest('hex')
    .slice(0, 16);
}

async function getClassCatalog(authToken, labelConfig, context) {
  const key = authCacheKey(authToken, labelConfig);
  const cached = catalogCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached && cached.promise) return cached.promise;

  const promise = loadClassCatalog(authToken, labelConfig, context)
    .then((catalog) => {
      catalogCache.set(key, { value: catalog, expiresAt: Date.now() + CATALOG_TTL_MS });
      return catalog;
    })
    .catch((error) => {
      catalogCache.delete(key);
      throw error;
    });
  catalogCache.set(key, { promise, expiresAt: Date.now() + CATALOG_TTL_MS });
  return promise;
}

async function loadClassCatalog(authToken, labelConfig, context) {
  const aliases = labelConfig.aliases || {};
  const response = await countedCmdbuildRequest(`/cmdbuild/services/rest/v3/classes?limit=${MAX_CLASSES}`, authToken, context);
  if (!response.ok) {
    const error = new Error(`CMDBuild classes request failed with HTTP ${response.statusCode}`);
    error.statusCode = response.statusCode;
    throw error;
  }

  const rawClasses = extractCmdbData(response.json)
    .filter((item) => item && item.active !== false && (!item.permissions || item.permissions._can_read !== false))
    .slice(0, MAX_CLASSES);
  const catalog = [];

  for (const item of rawClasses) {
    const className = cleanValue(item.name || item.code);
    if (!className) continue;
    const attrs = await countedCmdbuildRequest(`/cmdbuild/services/rest/v3/classes/${encodeURIComponent(className)}/attributes?limit=1000`, authToken, context);
    if (!attrs.ok) {
      logDiagnostic('Basic', 'catalog.attributes_skipped', { className, statusCode: attrs.statusCode });
      continue;
    }
    const attributes = extractCmdbData(attrs.json)
      .filter((attribute) => attribute && attribute.active !== false && (!attribute.permissions || attribute.permissions._can_read !== false));
    const fieldMap = buildFieldMap(attributes, aliases);
    const fieldMeta = buildFieldMetadataMap(attributes, aliases);
    if (!fieldMap.inv && !fieldMap.sn) continue;
    catalog.push({
      name: className,
      description: cleanValue(item.description || item._description || item.name),
      prototype: Boolean(item.prototype),
      fieldMap,
      fieldMeta,
      attributes: uniqueStrings(Object.values(fieldMap))
    });
  }

  logDiagnostic('Basic', 'catalog.loaded', {
    classesScanned: rawClasses.length,
    searchableClasses: catalog.length
  });
  return catalog;
}

async function resolveDrafts(drafts, authToken, labelConfig) {
  const aliases = labelConfig.aliases || {};
  const context = { restCalls: 0, lookupTypeCache: new Map() };
  const normalized = Array.isArray(drafts)
    ? drafts.map((draft, index) => normalizeDraftDevice({ row: index + 1, ...draft }, aliases))
    : [];
  const devices = [];
  const errors = [];

  for (const draft of normalized) {
    const row = draft.row || devices.length + 1;
    if (isCompleteDevice(draft)) {
      devices.push(pickDeviceFields(draft));
      continue;
    }

    if (!hasLookupKey(draft)) {
      devices.push(pickDeviceFields(draft));
      errors.push({
        row,
        field: 'Ключ поиска',
        message: 'Для дозапроса из CMDBuild нужен Инв. номер или SN'
      });
      errors.push(...deviceRequiredErrors(draft, row));
      continue;
    }

    try {
      const matches = await searchCmdbMatches(draft, authToken, labelConfig, context);
      if (!matches.length) {
        devices.push(pickDeviceFields(draft));
        errors.push({
          row,
          field: 'CMDBuild',
          message: 'Карточки по Инв. номеру или SN не найдены'
        });
        errors.push(...deviceRequiredErrors(draft, row));
        continue;
      }

      for (const match of matches) {
        const merged = mergeResolvedDevice(draft, match.device);
        devices.push({
          ...merged,
          _sourceClass: match.className,
          _sourceId: match.cardId
        });
        errors.push(...deviceRequiredErrors(merged, row));
      }
    } catch (error) {
      devices.push(pickDeviceFields(draft));
      errors.push({
        row,
        field: 'CMDBuild',
        message: safeUserError(error)
      });
    }
  }

  return {
    ok: errors.length === 0,
    devices,
    errors,
    meta: {
      inputCount: normalized.length,
      outputCount: devices.length,
      cmdbuildRestCalls: context.restCalls
    }
  };
}

async function searchCmdbMatches(draft, authToken, labelConfig, context) {
  const catalog = await getClassCatalog(authToken, labelConfig, context);
  const searchable = catalog.slice(0, MAX_SEARCH_CLASSES);
  const fields = [];
  if (draft.inv) fields.push({ field: 'inv', value: draft.inv });
  if (draft.sn) fields.push({ field: 'sn', value: draft.sn });

  const matches = [];
  const seen = new Set();

  for (const key of fields) {
    for (const classInfo of searchable) {
      if (matches.length >= MAX_MATCHES) return matches;
      const attribute = fieldMapAttributeName(classInfo.fieldMap, key.field);
      if (!attribute) continue;
      const cards = await searchClassCards(classInfo, attribute, key.value, authToken, context);
      for (const card of cards) {
        const device = cmdbCardToDevice(card, classInfo, classInfo.fieldMap, {
          classFallbackForCls: !isLookupParentDerivationEnabled(labelConfig)
        });
        await applyDerivedFields(device, card, classInfo, labelConfig, authToken, context);
        const merged = mergeResolvedDevice(draft, device);
        const cardId = cleanValue(card._id || card.Id || card.id);
        const uniqueKey = cardId || `${merged.inv}|${merged.sn}|${merged.model}|${merged.cls}`;
        if (seen.has(uniqueKey)) continue;
        seen.add(uniqueKey);
        matches.push({ className: classInfo.name, cardId, device: merged });
        if (matches.length >= MAX_MATCHES) return matches;
      }
    }
  }

  return matches;
}

async function searchClassCards(classInfo, attribute, value, authToken, context) {
  const query = new URLSearchParams();
  query.set('limit', String(CARD_SEARCH_LIMIT));
  query.set('filter', JSON.stringify(buildCmdbEqualFilter(attribute, value)));
  const attributes = uniqueStrings([attribute, ...Object.values(classInfo.fieldMap)]);
  if (attributes.length) query.set('attributes', attributes.join(','));

  const filteredPath = `/cmdbuild/services/rest/v3/classes/${encodeURIComponent(classInfo.name)}/cards?${query.toString()}`;
  const response = await countedCmdbuildRequest(filteredPath, authToken, context);
  if (response.ok) return extractCmdbData(response.json);
  if (![400, 404].includes(response.statusCode)) {
    if ([401, 403].includes(response.statusCode)) return [];
    throw new Error(`CMDBuild cards request failed with HTTP ${response.statusCode}`);
  }

  const fallbackQuery = new URLSearchParams();
  fallbackQuery.set('limit', String(CARD_FALLBACK_LIMIT));
  if (attributes.length) fallbackQuery.set('attributes', attributes.join(','));
  const fallbackPath = `/cmdbuild/services/rest/v3/classes/${encodeURIComponent(classInfo.name)}/cards?${fallbackQuery.toString()}`;
  const fallback = await countedCmdbuildRequest(fallbackPath, authToken, context);
  if (!fallback.ok) {
    if ([401, 403].includes(fallback.statusCode)) return [];
    throw new Error(`CMDBuild fallback cards request failed with HTTP ${fallback.statusCode}`);
  }
  return extractCmdbData(fallback.json).filter((card) => displayCmdbValue(card[attribute]) === cleanValue(value));
}

async function applyDerivedFields(device, card, classInfo, labelConfig, authToken, context) {
  const rule = labelConfig.derivedFields && labelConfig.derivedFields.groupFromLookupParent;
  if (!rule || !rule.enabled) return device;

  const sourceField = cleanValue(rule.sourceField || 'model');
  const targetField = cleanValue(rule.targetField || 'cls');
  if (!sourceField || !targetField || cleanValue(device && device[targetField])) return device;

  const sourceAttr = fieldMapAttributeName(classInfo.fieldMap, sourceField);
  const sourceMeta = classInfo.fieldMeta && classInfo.fieldMeta[sourceField];
  const lookupType = cleanValue(sourceMeta && sourceMeta.lookupType);
  if (!sourceAttr || !lookupType) return device;

  const ids = lookupIdsFromCard(card, sourceAttr);
  for (const id of ids) {
    const value = await getLookupValueById(authToken, lookupType, id, context);
    const parentType = cleanValue(value && (value.parent_type || value.parentType));
    const parentId = cleanValue(value && (value.parent_id || value.parentId));
    if (!parentType || !parentId) continue;

    const parent = await getLookupValueById(authToken, parentType, parentId, context);
    const text = displayCmdbValue(parent);
    if (text) {
      device[targetField] = text;
      return device;
    }
  }

  return device;
}

function isLookupParentDerivationEnabled(labelConfig) {
  const rule = labelConfig.derivedFields && labelConfig.derivedFields.groupFromLookupParent;
  return Boolean(rule && rule.enabled && cleanValue(rule.targetField || 'cls') === 'cls');
}

function lookupIdsFromCard(card = {}, attrName) {
  const value = card[attrName];
  const values = Array.isArray(value) ? value : [value];
  const ids = [];
  for (const item of values) {
    if (item === undefined || item === null) continue;
    if (typeof item === 'object') {
      const id = cleanValue(item._id || item.id || item.Id);
      if (id) ids.push(id);
      continue;
    }
    const id = cleanValue(item);
    if (id) ids.push(id);
  }
  return uniqueStrings(ids);
}

async function getLookupValueById(authToken, lookupType, id, context) {
  const type = cleanValue(lookupType);
  const lookupId = cleanValue(id);
  if (!type || !lookupId) return null;

  if (!context.lookupTypeCache) context.lookupTypeCache = new Map();
  if (!context.lookupTypeCache.has(type)) {
    const query = new URLSearchParams();
    query.set('limit', '1000');
    const response = await countedCmdbuildRequest(`/cmdbuild/services/rest/v3/lookup_types/${encodeURIComponent(type)}/values?${query.toString()}`, authToken, context);
    if (!response.ok) {
      if ([401, 403, 404].includes(response.statusCode)) {
        context.lookupTypeCache.set(type, []);
      } else {
        throw new Error(`CMDBuild lookup values request failed with HTTP ${response.statusCode}`);
      }
    } else {
      context.lookupTypeCache.set(type, extractCmdbData(response.json));
    }
  }

  const values = context.lookupTypeCache.get(type) || [];
  return values.find((item) => cleanValue(item && (item._id || item.id || item.Id)) === lookupId) || null;
}

function assertRestBudget(context) {
  if (context.restCalls >= MAX_REST_CALLS) {
    const error = new Error('Превышен лимит REST-запросов к CMDBuild для одного действия');
    error.statusCode = 429;
    throw error;
  }
}

function userInputError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateResolveDevices(body) {
  if (!body || !Array.isArray(body.devices)) {
    throw userInputError('Поле devices должно быть массивом', 400);
  }
  if (body.devices.length > MAX_RESOLVE_DEVICES) {
    throw userInputError(`За один запрос можно обработать не более ${MAX_RESOLVE_DEVICES} устройств`, 413);
  }
  return body.devices;
}

function pickDeviceFields(device) {
  const result = {};
  for (const field of REQUIRED_FIELDS) result[field] = cleanValue(device && device[field]);
  return result;
}

function safeUserError(error) {
  const status = Number(error && error.statusCode || 0);
  if (status === 401) return 'Сессия CMDBuild истекла или недоступна';
  if (status === 403) return 'Недостаточно прав для чтения данных CMDBuild';
  if (status === 400 || status === 413) return error.message;
  if (status === 429) return error.message;
  if (status >= 500) return 'CMDBuild временно недоступен';
  return error && error.message ? error.message : 'Ошибка CMDBuild';
}

async function handleHealth(req, res, requestUrl) {
  if (requestUrl.pathname.endsWith('/ready')) {
    const payload = await readinessPayload();
    sendJson(res, payload.ready ? 200 : 503, payload);
    return;
  }
  sendJson(res, 200, baseHealthPayload());
}

async function handleSession(req, res) {
  const authToken = authTokenFromRequest(req);
  const session = await currentSessionPayload(authToken);
  if (!session.ok) {
    sendJson(res, session.statusCode === 403 ? 403 : 401, {
      ok: false,
      message: 'CMDBuild session is missing or expired.'
    });
    return;
  }
  sendJson(res, 200, { ok: true, session: sanitizeSession(session.data) });
}

function handleCsrf(req, res) {
  const authToken = authTokenFromRequest(req);
  if (!authToken) {
    sendJson(res, 401, { ok: false, message: 'CMDBuild session is missing.' });
    return;
  }
  sendJson(res, 200, { ok: true, token: csrfTokenFor(authToken), header: 'X-CMDB2Label-CSRF' });
}

async function handleResolve(req, res) {
  if (!isSameOriginRequest(req)) {
    sendJson(res, 403, { ok: false, message: 'Same-origin Origin or Referer is required.' });
    return;
  }
  if (!isJsonContentType(req)) {
    sendJson(res, 415, { ok: false, message: 'Content-Type must be application/json.' });
    return;
  }
  const authToken = authTokenFromRequest(req);
  if (!authToken) {
    sendJson(res, 401, { ok: false, message: 'CMDBuild session is missing.' });
    return;
  }
  if (!validateCsrf(req, authToken)) {
    sendJson(res, 403, { ok: false, message: 'Invalid CSRF token.' });
    return;
  }

  const body = await readJsonBody(req);
  const devices = validateResolveDevices(body);
  const labelConfig = mergeLabelConfig(loadAliasConfig());
  const result = await resolveDrafts(devices, authToken, labelConfig);
  logDiagnostic('Basic', 'labels.resolve', {
    inputCount: result.meta.inputCount,
    outputCount: result.meta.outputCount,
    errorCount: result.errors.length,
    cmdbuildRestCalls: result.meta.cmdbuildRestCalls
  });
  sendJson(res, result.ok ? 200 : 422, result);
}

async function handleApi(req, res, requestUrl) {
  if (requestUrl.pathname === `${API_PREFIX}/session` && req.method === 'GET') {
    await handleSession(req, res);
    return;
  }
  if (requestUrl.pathname === `${API_PREFIX}/csrf` && req.method === 'GET') {
    handleCsrf(req, res);
    return;
  }
  if (requestUrl.pathname === `${API_PREFIX}/resolve` && req.method === 'POST') {
    await handleResolve(req, res);
    return;
  }
  if (requestUrl.pathname === `${API_PREFIX}/logging/status` && req.method === 'GET') {
    const session = await currentSessionPayload(authTokenFromRequest(req));
    if (!session.ok) {
      sendJson(res, 401, { ok: false, message: 'CMDBuild session is missing.' });
      return;
    }
    sendJson(res, 200, { ok: true, logging: loggingStatus() });
    return;
  }
  if (requestUrl.pathname === `${API_PREFIX}/client-log` && req.method === 'GET') {
    if (!authTokenFromRequest(req)) {
      sendJson(res, 401, { ok: false, message: 'CMDBuild session is missing.' });
      return;
    }
    logDiagnostic('Basic', 'client.event', {
      stage: cleanValue(requestUrl.searchParams.get('stage')).slice(0, 80),
      message: cleanValue(requestUrl.searchParams.get('message')).slice(0, 160)
    });
    sendJson(res, 200, { ok: true });
    return;
  }
  if ((requestUrl.pathname === `${API_PREFIX}/health/live` || requestUrl.pathname === `${API_PREFIX}/health/ready`) && req.method === 'GET') {
    await handleHealth(req, res, requestUrl);
    return;
  }
  sendJson(res, 404, { ok: false, message: 'Labels API route not found.' });
}

function serveUi(res) {
  const html = fs.readFileSync(UI_HTML_PATH, 'utf8');
  sendHtml(res, 200, html);
}

function proxyToCmdbuild(req, res, requestUrl) {
  if (!isCmdbuildProxyPathAllowed(requestUrl.pathname, CMDBUILD_PROXY_ALLOWLIST_STRICT, req.method)) {
    writeLog('warn', 'cmdbuild.proxy_path_rejected', {
      method: req.method,
      path: requestUrl.pathname
    });
    sendJson(res, 403, { ok: false, message: 'CMDBuild proxy path is not allowed.' });
    return;
  }

  const target = new URL(req.url || '/', CMDBUILD_ORIGIN);
  const externalHost = String(req.headers['x-forwarded-host'] || req.headers.host || `${LISTEN_HOST}:${LISTEN_PORT}`).split(',')[0].trim();
  const externalProto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() || 'http';
  const headers = { ...req.headers };
  headers.host = externalHost;
  headers['x-forwarded-host'] = externalHost;
  headers['x-forwarded-proto'] = externalProto;
  if (isCmdbuildUiCacheSensitive(requestUrl.pathname)) {
    headers['accept-encoding'] = 'identity';
  }
  const requestId = res.getHeader('x-request-id');
  if (requestId) headers['x-request-id'] = String(requestId);

  const proxyReq = httpTransportForTarget(target).request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    path: `${target.pathname}${target.search}`,
    method: req.method,
    headers,
    agent: agentForTarget(target),
    timeout: REQUEST_TIMEOUT_MS
  }, (proxyRes) => {
    const shouldRewriteHtml = isCmdbuildUiEntry(requestUrl.pathname);
    const shouldRewriteManifest = isCmdbuildUiManifest(requestUrl.pathname);
    const shouldBuffer = shouldRewriteHtml || shouldRewriteManifest || isCmdbuildUiCacheSensitive(requestUrl.pathname);

    incMetric('cmdb2label_cmdbuild_proxy_requests_total', {
      method: req.method || 'GET',
      status: statusClass(proxyRes.statusCode || 0)
    });

    if (!shouldBuffer) {
      res.writeHead(proxyRes.statusCode || 502, rewriteProxyResponseHeaders(proxyRes.headers));
      proxyRes.pipe(res);
      return;
    }

    const chunks = [];
    proxyRes.on('data', (chunk) => chunks.push(chunk));
    proxyRes.on('end', () => {
      let body = Buffer.concat(chunks).toString('utf8');
      if (shouldRewriteHtml) {
        body = rewriteCmdbuildUiHtml(body);
      } else if (shouldRewriteManifest) {
        body = rewriteCmdbuildManifest(body);
      }
      const responseHeaders = withNoStoreHeaders(rewriteProxyResponseHeaders(proxyRes.headers));
      responseHeaders['content-length'] = Buffer.byteLength(body);
      res.writeHead(proxyRes.statusCode || 502, responseHeaders);
      res.end(body);
    });
  });

  proxyReq.on('timeout', () => proxyReq.destroy(new Error('CMDBuild proxy request timeout')));
  proxyReq.on('error', (error) => {
    incMetric('cmdb2label_cmdbuild_proxy_requests_total', { method: req.method || 'GET', status: 'network' });
    writeLog('error', 'cmdbuild.proxy_failed', {
      method: req.method,
      path: requestUrl.pathname,
      message: error.message || String(error)
    });
    sendJson(res, 502, { ok: false, message: 'CMDBuild proxy error.' });
  });

  req.pipe(proxyReq);
}

function routeName(pathname) {
  if (pathname.startsWith('/health')) return 'health';
  if (pathname.startsWith(API_PREFIX)) return 'labels-api';
  if (pathname === UI_PREFIX || pathname.startsWith(`${UI_PREFIX}/`)) return 'labels-ui';
  if (pathname === '/cmdbuild' || pathname.startsWith('/cmdbuild/')) return 'cmdbuild-proxy';
  if (pathname === '/metrics') return 'metrics';
  return 'other';
}

function attachRequestLogging(req, res, requestUrl) {
  const startedAt = Date.now();
  const requestId = cleanValue(req.headers['x-request-id']) || crypto.randomUUID();
  res.setHeader('x-request-id', requestId);
  logDiagnostic('Verbose', 'http.request.start', {
    requestId,
    method: req.method,
    path: requestUrl.pathname,
    route: routeName(requestUrl.pathname),
    headers: sanitizeHeaders(req.headers)
  });
  res.on('finish', () => {
    const statusCode = res.statusCode || 0;
    const fields = {
      requestId,
      method: req.method,
      path: requestUrl.pathname,
      route: routeName(requestUrl.pathname),
      statusCode,
      durationMs: Date.now() - startedAt,
      hasCmdbuildCookie: Boolean(authTokenFromRequest(req))
    };
    incMetric('cmdb2label_http_requests_total', { route: fields.route, status: statusClass(statusCode) });
    logDiagnostic('Basic', 'http.request.finish', fields);
    if (statusCode >= 500) writeLog('error', 'http.request.finish', fields);
    else if (statusCode >= 400) writeLog('warn', 'http.request.finish', fields);
    else writeLog('info', 'http.request.finish', fields);
  });
}

function createServer() {
  return http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `${LISTEN_HOST}:${LISTEN_PORT}`}`);
    attachRequestLogging(req, res, requestUrl);

    if (shuttingDown && requestUrl.pathname !== '/health/live') {
      sendJson(res, 503, { ok: false, status: 'shutting_down' }, { connection: 'close' });
      return;
    }
    if (requestUrl.pathname === '/metrics') {
      sendText(res, 200, renderMetrics(), 'text/plain; version=0.0.4; charset=utf-8');
      return;
    }
    if (requestUrl.pathname === '/health/live' || requestUrl.pathname === '/health/ready') {
      handleHealth(req, res, requestUrl).catch((error) => {
        sendJson(res, 503, { ...baseHealthPayload(), ready: false, error: error.message || String(error) });
      });
      return;
    }
    if (requestUrl.pathname === UI_PREFIX || requestUrl.pathname === `${UI_PREFIX}/`) {
      serveUi(res);
      return;
    }
    if (requestUrl.pathname.startsWith(`${API_PREFIX}/`)) {
      handleApi(req, res, requestUrl).catch((error) => {
        const statusCode = error.statusCode && Number(error.statusCode) >= 400 ? Number(error.statusCode) : 500;
        writeLog(statusCode >= 500 ? 'error' : 'warn', 'labels.api_failed', {
          path: requestUrl.pathname,
          statusCode,
          message: error.message || String(error)
        });
        sendJson(res, statusCode, { ok: false, message: safeUserError(error) });
      });
      return;
    }
    if (requestUrl.pathname === '/cmdbuild' || requestUrl.pathname.startsWith('/cmdbuild/')) {
      proxyToCmdbuild(req, res, requestUrl);
      return;
    }
    sendJson(res, 404, { ok: false, message: 'Not found.' });
  });
}

function installGracefulShutdown(server) {
  let started = false;
  const shutdown = (signal) => {
    if (started) return;
    started = true;
    shuttingDown = true;
    writeLog('warn', 'app.shutdown_started', { signal });
    server.close((error) => {
      httpAgent.destroy();
      httpsAgent.destroy();
      if (error) {
        writeLog('error', 'app.shutdown_failed', { signal, error: error.message || String(error) });
        process.exit(1);
      }
      writeLog('info', 'app.shutdown_complete', { signal });
      process.exit(0);
    });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const validation = validateRuntimeConfig();
  if (!validation.ok) {
    writeLog('error', 'app.config_invalid', runtimeConfigSummary(validation), { force: true });
    process.exit(1);
  }
  const server = createServer();
  installGracefulShutdown(server);
  server.listen(LISTEN_PORT, LISTEN_HOST, () => {
    writeLog('info', 'app.started', {
      listen: `http://${LISTEN_HOST}:${LISTEN_PORT}`,
      cmdbuildOrigin: CMDBUILD_ORIGIN,
      uiPrefix: UI_PREFIX,
      apiPrefix: API_PREFIX,
      runtimeConfig: runtimeConfigSummary(validation),
      logging: loggingStatus()
    }, { force: true });
  });
}

export {
  API_PREFIX,
  UI_PREFIX,
  createServer,
  isCmdbuildProxyPathAllowed,
  isCmdbuildUiCacheSensitive,
  isJsonContentType,
  isSameOriginRequest,
  loggingStatus,
  normalizeDiagnosticMode,
  normalizeLogTargets,
  resolveDrafts,
  rewriteCmdbuildManifest,
  rewriteCmdbuildUiHtml,
  securityHeaders,
  validateRuntimeConfig
};
