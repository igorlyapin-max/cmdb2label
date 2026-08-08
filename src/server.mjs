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
  uniqueStrings,
  validateLabelConfig
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
const VERSION_FILE_PATH = path.join(ROOT_DIR, 'VERSION');
const BUILD_IDENTITY_FILE_PATH = path.join(ROOT_DIR, 'build-identity.json');
const APP_VERSION_FALLBACK = '0.0.0.0';
const APP_VERSION_PATTERN = /^\d{2}\.\d{2}\.\d{2}\.\d{2}$/;
const BUILD_REVISION_PATTERN = /^[0-9a-f]{40}$|^unknown$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$|^unknown$/;
const DEV_CACHE_BUSTER = String(Date.now());
const REQUEST_TIMEOUT_MS = readRuntimeInteger('CMDB_LABELS_REQUEST_TIMEOUT_MS', 10000, 500, 300000);
const HEALTH_TIMEOUT_MS = readRuntimeInteger('CMDB_LABELS_HEALTH_TIMEOUT_MS', 2000, 300, 60000);
const CATALOG_TTL_MS = readRuntimeInteger('CMDB_LABELS_CATALOG_TTL_MS', 300_000, 10_000, 86_400_000);
const MAX_CLASSES = readRuntimeInteger('CMDB_LABELS_MAX_CLASSES', 400, 1, 10000);
const MAX_SEARCH_CLASSES = readRuntimeInteger('CMDB_LABELS_MAX_SEARCH_CLASSES', 160, 1, 10000);
const MAX_MATCHES = readRuntimeInteger('CMDB_LABELS_MAX_MATCHES', 50, 1, 1000);
const DEFAULT_MAX_REST_CALLS = Math.max(250, MAX_CLASSES + MAX_SEARCH_CLASSES + 50);
const MAX_REST_CALLS = readRuntimeInteger('CMDB_LABELS_MAX_REST_CALLS', DEFAULT_MAX_REST_CALLS, 10, 50000);
const MAX_RESOLVE_DEVICES = readRuntimeInteger('CMDB_LABELS_MAX_RESOLVE_DEVICES', 100, 1, 10000);
const CARD_SEARCH_LIMIT = readRuntimeInteger('CMDB_LABELS_CARD_SEARCH_LIMIT', 20, 1, 1000);
const CARD_FALLBACK_LIMIT = Math.max(CARD_SEARCH_LIMIT, readRuntimeInteger('CMDB_LABELS_CARD_FALLBACK_LIMIT', 100, 1, 5000));
const BODY_LIMIT_BYTES = readRuntimeInteger('CMDB_LABELS_BODY_LIMIT_BYTES', 512 * 1024, 1024, 10 * 1024 * 1024);
const CLASS_ROOT_PATH = normalizeClassRootPath(process.env.CMDB_LABELS_CLASS_ROOT_PATH || '').path;
const CSRF_SECRET = process.env.CMDB_LABELS_CSRF_SECRET || crypto.randomBytes(32).toString('hex');
const DIAGNOSTIC_MODE = normalizeDiagnosticMode(process.env.CMDB_LABELS_DIAGNOSTIC_MODE || 'off');
const LOG_LEVEL = normalizeLogLevel(process.env.CMDB_LABELS_LOG_LEVEL || 'info');
const LOG_FORMAT = normalizeLogFormat(process.env.CMDB_LABELS_LOG_FORMAT || 'json');
const LOG_TARGETS = normalizeLogTargets(process.env.CMDB_LABELS_LOG_TARGET || 'stdout');
const LOG_EXTERNAL_SINK = normalizeExternalLogSink(process.env.CMDB_LABELS_LOG_EXTERNAL_SINK || 'none');
const SYSLOG_HOST = process.env.CMDB_LABELS_SYSLOG_HOST || '127.0.0.1';
const SYSLOG_PORT = Number(process.env.CMDB_LABELS_SYSLOG_PORT || 514);
const SYSLOG_PROTOCOL = normalizeSyslogProtocol(process.env.CMDB_LABELS_SYSLOG_PROTOCOL || 'udp');
const SYSLOG_FACILITY = normalizeSyslogFacility(process.env.CMDB_LABELS_SYSLOG_FACILITY || 'local0');
const CUSTOM_CA_MODE = normalizeCustomCaMode(process.env.CMDB_LABELS_CUSTOM_CA_MODE || 'none');
const CUSTOM_CA_FILE = process.env.CMDB_LABELS_CUSTOM_CA_FILE || process.env.NODE_EXTRA_CA_CERTS || '';
const LOG_REDACT_HEADERS = new Set(['cookie', 'authorization', 'cmdbuild-authorization', 'x-cmdb2label-csrf', 'set-cookie']);
const PLACEHOLDER_CSRF_SECRETS = new Set(['change-me-to-a-stable-secret-from-secret-store']);
const CMDBUILD_PROXY_ALLOWLIST_STRICT = process.env.CMDB_LABELS_CMDBUILD_PROXY_ALLOWLIST_STRICT !== 'false';
const CMDBUILD_PROXY_ENABLED = process.env.CMDB_LABELS_ENABLE_CMDBUILD_PROXY === 'true';
const PROXY_COOKIE_SAMESITE = process.env.CMDB_LABELS_PROXY_COOKIE_SAMESITE || '';
const PROXY_COOKIE_SECURE = process.env.CMDB_LABELS_PROXY_COOKIE_SECURE || 'false';
const FOOTER_ENABLED = process.env.CMDB_LABELS_FOOTER_ENABLED !== 'false';
const FOOTER_TITLE = process.env.CMDB_LABELS_FOOTER_TITLE || 'Разработано Департаментом информационных технологий';
const FOOTER_TEXT = process.env.CMDB_LABELS_FOOTER_TEXT || 'Предложения и замечания направлять на почту:';
const FOOTER_EMAIL = process.env.CMDB_LABELS_FOOTER_EMAIL || 'ritm.all@gkm.ru';
const FOOTER_SUBJECT = process.env.CMDB_LABELS_FOOTER_SUBJECT || 'Предложения по CMDBuild Label';
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50, maxFreeSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50, maxFreeSockets: 10 });
const catalogCache = new Map();
const metricCounters = new Map();

let shuttingDown = false;

function integerConfigSpecs(defaultMaxRestCalls = DEFAULT_MAX_REST_CALLS) {
  return [
    { env: 'CMDB_LABELS_REQUEST_TIMEOUT_MS', defaultValue: 10000, min: 500, max: 300000 },
    { env: 'CMDB_LABELS_HEALTH_TIMEOUT_MS', defaultValue: 2000, min: 300, max: 60000 },
    { env: 'CMDB_LABELS_CATALOG_TTL_MS', defaultValue: 300_000, min: 10_000, max: 86_400_000 },
    { env: 'CMDB_LABELS_MAX_CLASSES', defaultValue: 400, min: 1, max: 10000 },
    { env: 'CMDB_LABELS_MAX_SEARCH_CLASSES', defaultValue: 160, min: 1, max: 10000 },
    { env: 'CMDB_LABELS_MAX_REST_CALLS', defaultValue: defaultMaxRestCalls, min: 10, max: 50000 },
    { env: 'CMDB_LABELS_MAX_RESOLVE_DEVICES', defaultValue: 100, min: 1, max: 10000 },
    { env: 'CMDB_LABELS_MAX_MATCHES', defaultValue: 50, min: 1, max: 1000 },
    { env: 'CMDB_LABELS_CARD_SEARCH_LIMIT', defaultValue: 20, min: 1, max: 1000 },
    { env: 'CMDB_LABELS_CARD_FALLBACK_LIMIT', defaultValue: 100, min: 1, max: 5000 },
    { env: 'CMDB_LABELS_BODY_LIMIT_BYTES', defaultValue: 512 * 1024, min: 1024, max: 10 * 1024 * 1024 }
  ];
}

function parseRuntimeInteger(raw, spec) {
  const text = String(raw === undefined ? '' : raw).trim();
  if (!text) return { ok: true, value: spec.defaultValue, configured: false };
  if (!/^\d+$/.test(text)) {
    return {
      ok: false,
      value: spec.defaultValue,
      configured: true,
      error: runtimeIntegerError(spec, `must be an integer between ${spec.min} and ${spec.max}`)
    };
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < spec.min || value > spec.max) {
    return {
      ok: false,
      value: spec.defaultValue,
      configured: true,
      error: runtimeIntegerError(spec, `must be between ${spec.min} and ${spec.max}`)
    };
  }
  return { ok: true, value, configured: true };
}

function runtimeIntegerError(spec, detail) {
  return {
    code: 'runtime_integer_invalid',
    env: spec.env,
    message: `${spec.env} ${detail}.`
  };
}

function readRuntimeInteger(envName, defaultValue, min, max) {
  return parseRuntimeInteger(process.env[envName], { env: envName, defaultValue, min, max }).value;
}

function validateRuntimeIntegers(env = process.env) {
  const maxClasses = parseRuntimeInteger(env.CMDB_LABELS_MAX_CLASSES, {
    env: 'CMDB_LABELS_MAX_CLASSES',
    defaultValue: 400,
    min: 1,
    max: 10000
  }).value;
  const maxSearchClasses = parseRuntimeInteger(env.CMDB_LABELS_MAX_SEARCH_CLASSES, {
    env: 'CMDB_LABELS_MAX_SEARCH_CLASSES',
    defaultValue: 160,
    min: 1,
    max: 10000
  }).value;
  const defaultMaxRestCalls = Math.max(250, maxClasses + maxSearchClasses + 50);
  const results = integerConfigSpecs(defaultMaxRestCalls).map((spec) => parseRuntimeInteger(env[spec.env], spec));
  const errors = results.filter((result) => !result.ok).map((result) => result.error);
  return { ok: errors.length === 0, errors };
}

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

function normalizeExternalLogSink(value) {
  const text = String(value || '').trim().toLowerCase();
  return ['platform', 'collector', 'sidecar', 'docker-driver'].includes(text) ? text : 'none';
}

function normalizeCustomCaMode(value) {
  const text = String(value || '').trim().toLowerCase();
  return ['mount', 'embedded'].includes(text) ? text : 'none';
}

function normalizeSyslogProtocol(value) {
  return String(value || '').trim().toLowerCase() === 'tcp' ? 'tcp' : 'udp';
}

function normalizeSyslogFacility(value) {
  const text = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(syslogFacilityCodes, text) ? text : 'local0';
}

function normalizeClassRootPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return { ok: true, path: '', rootName: '', segments: [] };
  const withoutLeadingSlash = raw.replace(/^\/+/, '').replace(/\/+$/, '');
  const segments = withoutLeadingSlash.split('/').map((item) => item.trim()).filter(Boolean);
  if (segments[0] !== 'classes' || segments.length < 2) {
    return {
      ok: false,
      path: raw,
      rootName: '',
      segments,
      error: {
        code: 'class_root_path_invalid',
        env: 'CMDB_LABELS_CLASS_ROOT_PATH',
        message: 'CMDB_LABELS_CLASS_ROOT_PATH must be empty or use /classes/<ClassName> format.'
      }
    };
  }
  const classSegments = segments.slice(1);
  return {
    ok: true,
    path: `/classes/${classSegments.join('/')}`,
    rootName: classSegments[classSegments.length - 1],
    segments
  };
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
    externalSink: LOG_EXTERNAL_SINK,
    syslog: LOG_TARGETS.includes('syslog') ? {
      host: SYSLOG_HOST,
      port: SYSLOG_PORT,
      protocol: SYSLOG_PROTOCOL,
      facility: SYSLOG_FACILITY
    } : null
  };
}

function validateRuntimeConfig(input = {}) {
  const env = input.env || process.env;
  const nodeEnv = String(input.nodeEnv === undefined ? env.NODE_ENV || '' : input.nodeEnv || '').trim();
  const csrfSecret = String(input.csrfSecret === undefined ? env.CMDB_LABELS_CSRF_SECRET || '' : input.csrfSecret || '').trim();
  const logTargets = input.logTargets || LOG_TARGETS;
  const externalLogSink = input.externalLogSink === undefined ?
    normalizeExternalLogSink(env.CMDB_LABELS_LOG_EXTERNAL_SINK || LOG_EXTERNAL_SINK) :
    normalizeExternalLogSink(input.externalLogSink);
  const aliasConfigValidation = input.aliasConfigValidation || readAliasConfigFromEnv(env);
  const classRoot = normalizeClassRootPath(env.CMDB_LABELS_CLASS_ROOT_PATH || '');
  const integerValidation = validateRuntimeIntegers(env);
  const customCaValidation = validateCustomCaConfig(env);
  const errors = [];
  const warnings = [];

  if (nodeEnv.toLowerCase() === 'production' && !csrfSecret) {
    errors.push({
      code: 'csrf_secret_required',
      env: 'CMDB_LABELS_CSRF_SECRET',
      message: 'Production startup requires a stable external CSRF secret.'
    });
  }
  if (nodeEnv.toLowerCase() === 'production' && PLACEHOLDER_CSRF_SECRETS.has(csrfSecret)) {
    errors.push({
      code: 'csrf_secret_placeholder',
      env: 'CMDB_LABELS_CSRF_SECRET',
      message: 'Production startup rejects the example CSRF secret placeholder.'
    });
  }
  if (!Array.isArray(logTargets) || !logTargets.includes('stdout')) {
    errors.push({
      code: 'stdout_log_target_required',
      env: 'CMDB_LABELS_LOG_TARGET',
      message: 'Structured logs must always include stdout/stderr.'
    });
  }
  if (DIAGNOSTIC_MODE === 'Verbose' && nodeEnv.toLowerCase() === 'production') {
    warnings.push({
      code: 'verbose_diagnostic_in_production',
      env: 'CMDB_LABELS_DIAGNOSTIC_MODE',
      message: 'Verbose diagnostics should be enabled only temporarily.'
    });
  }
  if (!classRoot.ok) {
    errors.push(classRoot.error);
  }
  if (Array.isArray(logTargets) && logTargets.includes('syslog')) {
    errors.push(...validateSyslogConfig(env));
  }
  if (nodeEnv.toLowerCase() === 'production' && Array.isArray(logTargets) && !logTargets.includes('syslog') && externalLogSink === 'none') {
    errors.push({
      code: 'external_log_sink_required',
      env: 'CMDB_LABELS_LOG_EXTERNAL_SINK',
      message: 'Production stdout-only logging requires a documented external platform, collector, sidecar, or docker-driver sink.'
    });
  }
  errors.push(...integerValidation.errors);
  errors.push(...aliasConfigValidation.errors);
  errors.push(...customCaValidation.errors);
  warnings.push(...aliasConfigValidation.warnings);

  return {
    ok: errors.length === 0,
    nodeEnv,
    diagnosticMode: DIAGNOSTIC_MODE,
    logTargets,
    externalLogSink,
    classRoot: {
      path: classRoot.ok ? classRoot.path : String(env.CMDB_LABELS_CLASS_ROOT_PATH || '').trim(),
      rootName: classRoot.ok ? classRoot.rootName : ''
    },
    customCa: customCaValidation.summary,
    aliasConfig: {
      source: aliasConfigValidation.source,
      configured: aliasConfigValidation.configured
    },
    errors,
    warnings
  };
}

function validateCustomCaConfig(env = process.env) {
  const mode = normalizeCustomCaMode(env.CMDB_LABELS_CUSTOM_CA_MODE || CUSTOM_CA_MODE);
  const filePath = cleanValue(env.CMDB_LABELS_CUSTOM_CA_FILE || env.NODE_EXTRA_CA_CERTS || CUSTOM_CA_FILE);
  const errors = [];

  if (mode === 'none') {
    return {
      ok: true,
      summary: { mode, file: filePath || '', configured: false },
      errors
    };
  }

  if (!filePath) {
    errors.push({
      code: 'custom_ca_file_required',
      env: 'CMDB_LABELS_CUSTOM_CA_FILE',
      message: 'Custom CA mode requires CMDB_LABELS_CUSTOM_CA_FILE or NODE_EXTRA_CA_CERTS.'
    });
  } else {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        errors.push({
          code: 'custom_ca_file_invalid',
          env: 'CMDB_LABELS_CUSTOM_CA_FILE',
          path: filePath,
          message: 'Custom CA path must point to a certificate file.'
        });
      }
    } catch (error) {
      errors.push({
        code: 'custom_ca_file_unreadable',
        env: 'CMDB_LABELS_CUSTOM_CA_FILE',
        path: filePath,
        message: 'Custom CA certificate file is not readable.'
      });
    }
  }

  return {
    ok: errors.length === 0,
    summary: { mode, file: filePath, configured: mode !== 'none' },
    errors
  };
}

function validateSyslogConfig(env = process.env) {
  const errors = [];
  const host = String(env.CMDB_LABELS_SYSLOG_HOST || SYSLOG_HOST || '').trim();
  const portText = String(env.CMDB_LABELS_SYSLOG_PORT || SYSLOG_PORT || '').trim();
  const protocol = String(env.CMDB_LABELS_SYSLOG_PROTOCOL || SYSLOG_PROTOCOL || '').trim().toLowerCase();
  const facility = String(env.CMDB_LABELS_SYSLOG_FACILITY || SYSLOG_FACILITY || '').trim().toLowerCase();

  if (!host) {
    errors.push({
      code: 'syslog_host_required',
      env: 'CMDB_LABELS_SYSLOG_HOST',
      message: 'Syslog logging requires CMDB_LABELS_SYSLOG_HOST.'
    });
  }
  if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
    errors.push({
      code: 'syslog_port_invalid',
      env: 'CMDB_LABELS_SYSLOG_PORT',
      message: 'CMDB_LABELS_SYSLOG_PORT must be an integer between 1 and 65535.'
    });
  }
  if (!['udp', 'tcp'].includes(protocol)) {
    errors.push({
      code: 'syslog_protocol_invalid',
      env: 'CMDB_LABELS_SYSLOG_PROTOCOL',
      message: 'CMDB_LABELS_SYSLOG_PROTOCOL must be udp or tcp.'
    });
  }
  if (!Object.prototype.hasOwnProperty.call(syslogFacilityCodes, facility)) {
    errors.push({
      code: 'syslog_facility_invalid',
      env: 'CMDB_LABELS_SYSLOG_FACILITY',
      message: 'CMDB_LABELS_SYSLOG_FACILITY is not supported.'
    });
  }

  return errors;
}

function runtimeConfigSummary(validation = validateRuntimeConfig()) {
  return {
    nodeEnv: validation.nodeEnv || 'development',
    diagnosticMode: validation.diagnosticMode,
    logTargets: validation.logTargets,
    externalLogSink: validation.externalLogSink,
    classRoot: validation.classRoot,
    customCa: validation.customCa,
    aliasConfig: validation.aliasConfig,
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
    const suffix = labels.length ? `{${labels.map(([name, value]) => `${name}="${escapePrometheusLabelValue(value)}"`).join(',')}}` : '';
    lines.push(`${item.name}${suffix} ${item.value}`);
  }
  return `${lines.join('\n')}\n`;
}

function escapePrometheusLabelValue(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
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

function isSafeRelativeRequestTarget(requestTarget) {
  const text = String(requestTarget || '/');
  if (text.startsWith('//')) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(text);
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
  const requestFn = context && context.cmdbuildRequest ? context.cmdbuildRequest : cmdbuildRequest;
  const response = await requestFn(pathname, authToken, options);
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
  const runtimeValidation = validateRuntimeConfig();
  if (!runtimeValidation.ok) {
    return {
      ...payload,
      ready: false,
      status: 'not_ready'
    };
  }
  try {
    const response = await cmdbuildRequest('/cmdbuild/services/rest/v3/sessions/current', '', { timeoutMs: HEALTH_TIMEOUT_MS });
    const upstreamReachable = response.statusCode > 0 && response.statusCode < 500;
    return {
      ...payload,
      ready: upstreamReachable,
      status: upstreamReachable ? 'ready' : 'not_ready'
    };
  } catch (error) {
    return {
      ...payload,
      ready: false,
      status: 'not_ready'
    };
  }
}

function baseHealthPayload() {
  return {
    service: SERVICE,
    live: true,
    identity: buildIdentityPayload(),
    startedAt: STARTED_AT.toISOString(),
    uptimeSec: Math.round(process.uptime())
  };
}

function readBuildRevision(env = process.env) {
  const revision = cleanValue(env.CMDB_LABELS_BUILD_REVISION || 'unknown').toLowerCase();
  return BUILD_REVISION_PATTERN.test(revision) ? revision : 'unknown';
}

function normalizeBuildSourceState(state) {
  state = cleanValue(state || 'unverified-local');
  return state === 'verified' || state === 'clean' ? 'verified' : 'unverified-local';
}

function readBuildSourceState(env = process.env) {
  return normalizeBuildSourceState(env.CMDB_LABELS_BUILD_SOURCE_STATE);
}

function normalizeBuildMode(mode) {
  return cleanValue(mode) === 'canonical' ? 'canonical' : 'manual';
}

function readRuntimeArtifactSha256(env = process.env) {
  const hash = cleanValue(env.CMDB_LABELS_RUNTIME_ARTIFACT_SHA256 || 'unknown').toLowerCase();
  return SHA256_PATTERN.test(hash) ? hash : 'unknown';
}

function readBuildIdentityFile(filePath = BUILD_IDENTITY_FILE_PATH) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data || typeof data !== 'object') return {};
    return data;
  } catch (error) {
    return {};
  }
}

function sha256File(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch (error) {
    return 'unknown';
  }
}

function buildIdentityPayload(env = process.env, options = {}) {
  const runtimeArtifactPath = options.runtimeArtifactPath || UI_HTML_PATH;
  const embedded = readBuildIdentityFile(options.buildIdentityFilePath || BUILD_IDENTITY_FILE_PATH);
  const runtimeArtifactSha256 = sha256File(runtimeArtifactPath);
  const embeddedArtifact = embedded && embedded.runtimeArtifact && typeof embedded.runtimeArtifact === 'object' ?
    embedded.runtimeArtifact :
    {};
  const embeddedExpectedSha256 = cleanValue(embeddedArtifact.expectedSha256 || embeddedArtifact.sha256 || 'unknown').toLowerCase();
  const envExpectedSha256 = readRuntimeArtifactSha256(env);
  const expectedRuntimeArtifactSha256 = SHA256_PATTERN.test(embeddedExpectedSha256) && embeddedExpectedSha256 !== 'unknown' ?
    embeddedExpectedSha256 :
    envExpectedSha256;
  const version = readAppVersion(options.versionFilePath || VERSION_FILE_PATH);
  const embeddedBuildVersion = APP_VERSION_PATTERN.test(cleanValue(embedded.buildVersion || '')) ? cleanValue(embedded.buildVersion) : '';
  const envBuildVersion = APP_VERSION_PATTERN.test(cleanValue(env.CMDB_LABELS_BUILD_VERSION || '')) ? cleanValue(env.CMDB_LABELS_BUILD_VERSION) : '';
  const buildVersion = embeddedBuildVersion || envBuildVersion || version;
  const embeddedRevision = BUILD_REVISION_PATTERN.test(cleanValue(embedded.revision || '').toLowerCase()) ?
    cleanValue(embedded.revision).toLowerCase() :
    'unknown';
  const envRevision = readBuildRevision(env);
  const revision = embeddedRevision !== 'unknown' ? embeddedRevision : envRevision;
  const buildMode = normalizeBuildMode(embedded.buildMode || env.CMDB_LABELS_BUILD_MODE);
  const artifactMatchesExpected = expectedRuntimeArtifactSha256 !== 'unknown' && runtimeArtifactSha256 === expectedRuntimeArtifactSha256;
  const embeddedVerified = normalizeBuildSourceState(embedded.sourceState) === 'verified' &&
    buildMode === 'canonical' &&
    buildVersion === version &&
    /^[0-9a-f]{40}$/.test(revision) &&
    artifactMatchesExpected;
  const sourceState = embeddedVerified ? 'verified' : 'unverified-local';

  return {
    version,
    buildVersion,
    revision,
    sourceState,
    buildMode,
    runtimeArtifact: {
      path: path.basename(runtimeArtifactPath),
      sha256: runtimeArtifactSha256,
      expectedSha256: expectedRuntimeArtifactSha256,
      matchesExpected: artifactMatchesExpected
    }
  };
}

function classIdentifierNames(item = {}) {
  return uniqueStrings([
    item.name,
    item.code,
    item.Code,
    item._name,
    item._code
  ].map(cleanValue));
}

function classReferenceNames(value) {
  if (!value) return [];
  if (Array.isArray(value)) return uniqueStrings(value.flatMap(classReferenceNames));
  if (typeof value === 'object') {
    return uniqueStrings([
      value.name,
      value.code,
      value.Code,
      value._name,
      value._code
    ].map(cleanValue));
  }
  return [cleanValue(value)].filter(Boolean);
}

function classParentNames(item = {}) {
  return uniqueStrings([
    item.parent,
    item._parent,
    item.parent_name,
    item.parentName,
    item.parentCode,
    item.superclass,
    item.superClass,
    item._superclass,
    item.ancestors,
    item._ancestors
  ].flatMap(classReferenceNames));
}

function filterClassesByRoot(classes = [], classRootPath = '') {
  const root = normalizeClassRootPath(classRootPath);
  if (!root.ok || !root.rootName) return classes;

  const normalizedRoot = cleanValue(root.rootName);
  const included = new Set();
  const result = [];

  for (const item of classes) {
    const names = classIdentifierNames(item);
    if (names.includes(normalizedRoot)) {
      for (const name of names) included.add(name);
      result.push(item);
    }
  }

  if (!result.length) return [];

  let changed = true;
  while (changed) {
    changed = false;
    for (const item of classes) {
      const names = classIdentifierNames(item);
      if (names.some((name) => included.has(name))) continue;
      if (!classParentNames(item).some((name) => included.has(name))) continue;
      for (const name of names) included.add(name);
      result.push(item);
      changed = true;
    }
  }

  return result;
}

function mergeClassLists(...lists) {
  const result = [];
  const seen = new Set();
  for (const item of lists.flat()) {
    if (!item || typeof item !== 'object') continue;
    const names = classIdentifierNames(item);
    const key = names[0] || JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

async function loadRootClass(authToken, rootName, context) {
  const name = cleanValue(rootName);
  if (!name) return null;
  const response = await countedCmdbuildRequest(`/cmdbuild/services/rest/v3/classes/${encodeURIComponent(name)}`, authToken, context);
  if (!response.ok) {
    if ([401, 403, 404].includes(response.statusCode)) return null;
    throw new Error(`CMDBuild root class request failed with HTTP ${response.statusCode}`);
  }
  const data = response.json && response.json.data ? response.json.data : response.json;
  return data && typeof data === 'object' ? data : null;
}

function readAliasConfigFromEnv(env = process.env) {
  const inline = String(env.CMDB_LABELS_ALIAS_CONFIG || '');
  const filePath = String(env.CMDB_LABELS_ALIAS_CONFIG_FILE || '').trim();
  const source = inline.trim() ? 'CMDB_LABELS_ALIAS_CONFIG' : filePath ? 'CMDB_LABELS_ALIAS_CONFIG_FILE' : 'default';
  const configured = source !== 'default';
  let text = inline;

  if (!text.trim() && filePath) {
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      return {
        ok: false,
        source,
        configured,
        config: {},
        errors: [{
          code: 'alias_config_file_unreadable',
          env: 'CMDB_LABELS_ALIAS_CONFIG_FILE',
          path: filePath,
          message: `Cannot read CMDB labels alias config file: ${error.message}`
        }],
        warnings: []
      };
    }
  }

  if (!text.trim()) {
    return { ok: true, source, configured, config: {}, errors: [], warnings: [] };
  }
  let config;
  try {
    config = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      source,
      configured,
      config: {},
      errors: [{
        code: 'alias_config_json_invalid',
        env: source,
        message: `Invalid CMDB labels alias config JSON: ${error.message}`
      }],
      warnings: []
    };
  }

  const validation = validateLabelConfig(config);
  return {
    ok: validation.ok,
    source,
    configured,
    config,
    errors: validation.errors.map((item) => ({ ...item, env: source })),
    warnings: validation.warnings.map((item) => ({ ...item, env: source }))
  };
}

function formatAliasConfigErrors(errors = []) {
  return errors.map((item) => `${item.path || item.env || item.code}: ${item.message}`).join('; ');
}

function loadAliasConfig() {
  const validation = readAliasConfigFromEnv();
  if (!validation.ok) {
    const error = new Error(formatAliasConfigErrors(validation.errors) || 'Invalid CMDB labels alias config.');
    error.statusCode = 500;
    throw error;
  }
  return validation.config;
}

function authCacheKey(authToken, labelConfig = {}, classRootPath = '') {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      authToken: String(authToken || ''),
      aliases: labelConfig.aliases || {},
      derivedFields: labelConfig.derivedFields || {},
      classRootPath: normalizeClassRootPath(classRootPath).path
    }))
    .digest('hex')
    .slice(0, 16);
}

async function getClassCatalog(authToken, labelConfig, context) {
  const classRootPath = context.classRootPath === undefined ? CLASS_ROOT_PATH : context.classRootPath;
  const key = authCacheKey(authToken, labelConfig, classRootPath);
  const cached = catalogCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached && cached.promise) return cached.promise;

  const promise = loadClassCatalog(authToken, labelConfig, context, classRootPath)
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

async function loadClassCatalog(authToken, labelConfig, context, classRootPath = '') {
  const aliases = labelConfig.aliases || {};
  const response = await countedCmdbuildRequest(`/cmdbuild/services/rest/v3/classes?limit=${MAX_CLASSES}`, authToken, context);
  if (!response.ok) {
    const error = new Error(`CMDBuild classes request failed with HTTP ${response.statusCode}`);
    error.statusCode = response.statusCode;
    throw error;
  }

  const root = normalizeClassRootPath(classRootPath);
  const listedClasses = extractCmdbData(response.json)
    .filter((item) => item && item.active !== false && (!item.permissions || item.permissions._can_read !== false))
    .slice(0, MAX_CLASSES);
  const rootClass = root.rootName ? await loadRootClass(authToken, root.rootName, context) : null;
  const rawClasses = filterClassesByRoot(mergeClassLists(listedClasses, rootClass ? [rootClass] : []), classRootPath);
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
    logDiagnostic('Basic', 'catalog.class_mapped', {
      className,
      invAttribute: fieldMapAttributeName(fieldMap, 'inv'),
      modelAttribute: fieldMapAttributeName(fieldMap, 'model'),
      typeAttribute: fieldMapAttributeName(fieldMap, 'type'),
      snAttribute: fieldMapAttributeName(fieldMap, 'sn'),
      modelLookupType: cleanValue(fieldMeta.model && fieldMeta.model.lookupType),
      hasModelLookupType: Boolean(cleanValue(fieldMeta.model && fieldMeta.model.lookupType))
    });
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
    classRootPath: normalizeClassRootPath(classRootPath).path,
    searchableClasses: catalog.length
  });
  return catalog;
}

async function resolveDrafts(drafts, authToken, labelConfig, options = {}) {
  const aliases = labelConfig.aliases || {};
  const context = {
    restCalls: 0,
    lookupTypeCache: new Map(),
    cmdbuildRequest: options.cmdbuildRequest,
    classRootPath: options.classRootPath === undefined ? CLASS_ROOT_PATH : options.classRootPath
  };
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
  if (draft.lookupKey) {
    fields.push({ field: 'sn', value: draft.lookupKey, source: 'lookupKey' });
    fields.push({ field: 'inv', value: draft.lookupKey, source: 'lookupKey' });
  }

  const matches = [];
  const seen = new Set();

  for (const key of fields) {
    for (const classInfo of searchable) {
      if (matches.length >= MAX_MATCHES) return matches;
      const attribute = fieldMapAttributeName(classInfo.fieldMap, key.field);
      if (!attribute) continue;
      logDiagnostic('Basic', 'labels.search_key', {
        source: key.source || key.field,
        field: key.field,
        className: classInfo.name
      });
      const cards = await searchClassCards(classInfo, attribute, key.value, authToken, context);
      for (const card of cards) {
        const device = cmdbCardToDevice(card, classInfo, classInfo.fieldMap, {
          classFallbackForType: !isTypeLookupParentDerivationEnabled(labelConfig)
        });
        await applyDerivedFields(device, card, classInfo, labelConfig, authToken, context);
        const merged = mergeResolvedDevice(draft, device);
        const cardId = cleanValue(card._id || card.Id || card.id);
        const uniqueKey = cardId || `${merged.inv}|${merged.sn}|${merged.model}|${merged.type}`;
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
  const rule = labelConfig.derivedFields && labelConfig.derivedFields.typeFromModelLookupParent;
  if (!rule || !rule.enabled) return device;

  const modelField = cleanValue(rule.modelField || 'model');
  const typeField = cleanValue(rule.typeField || 'type');
  if (!modelField || !typeField || cleanValue(device && device[typeField])) return device;

  const modelAttr = fieldMapAttributeName(classInfo.fieldMap, modelField);
  const modelMeta = classInfo.fieldMeta && classInfo.fieldMeta[modelField];
  const sourceLookupType = cleanValue(rule.sourceLookupType || (modelMeta && modelMeta.lookupType));
  if (!modelAttr || !sourceLookupType) return device;

  const values = await lookupValuesFromCardField(authToken, sourceLookupType, card, modelAttr, context);
  for (const value of values) {
    const parent = await getLookupParentValue(authToken, value, rule, context);
    const text = displayCmdbValue(parent);
    if (text) {
      device[typeField] = text;
      return device;
    }
  }

  return device;
}

function isTypeLookupParentDerivationEnabled(labelConfig) {
  const rule = labelConfig.derivedFields && labelConfig.derivedFields.typeFromModelLookupParent;
  return Boolean(rule && rule.enabled && cleanValue(rule.typeField || 'type') === 'type');
}

async function lookupValuesFromCardField(authToken, lookupType, card, attrName, context) {
  const values = [];
  const seen = new Set();

  for (const id of lookupIdsFromCard(card, attrName)) {
    const value = await getLookupValueById(authToken, lookupType, id, context);
    const key = lookupValueKey(value);
    if (value && !seen.has(key)) {
      values.push(value);
      seen.add(key);
    }
  }

  for (const text of lookupTextsFromCard(card, attrName)) {
    const value = await getLookupValueByText(authToken, lookupType, text, context);
    const key = lookupValueKey(value);
    if (value && !seen.has(key)) {
      values.push(value);
      seen.add(key);
    }
  }

  return values;
}

function lookupIdsFromCard(card = {}, attrName) {
  const names = uniqueStrings([
    attrName,
    `_${attrName}_id`,
    `${attrName}_id`,
    `${attrName}Id`,
    `${attrName}_Id`
  ]);
  const values = [];
  for (const name of names) values.push(card[name]);
  return lookupIdsFromValues(values);
}

function lookupIdsFromValues(values) {
  const rawValues = Array.isArray(values) ? values : [values];
  const flattened = [];
  for (const value of rawValues) {
    if (Array.isArray(value)) flattened.push(...value);
    else flattened.push(value);
  }
  const ids = [];
  for (const item of flattened) {
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

function lookupTextsFromCard(card = {}, attrName) {
  return uniqueStrings([
    card[`_${attrName}_description`],
    card[`_${attrName}_description_translation`],
    card[`_${attrName}_code`],
    card[attrName]
  ].map(displayCmdbValue));
}

function lookupValueKey(value) {
  return cleanValue(value && (value._id || value.id || value.Id)) || displayCmdbValue(value);
}

async function getLookupValueById(authToken, lookupType, id, context) {
  const type = cleanValue(lookupType);
  const lookupId = cleanValue(id);
  if (!type || !lookupId) return null;

  const values = await getLookupValuesByType(authToken, type, context);
  return values.find((item) => cleanValue(item && (item._id || item.id || item.Id)) === lookupId) || null;
}

async function getLookupValueByText(authToken, lookupType, text, context) {
  const type = cleanValue(lookupType);
  const lookupText = cleanValue(text);
  if (!type || !lookupText) return null;

  const values = await getLookupValuesByType(authToken, type, context);
  return values.find((item) => {
    const candidates = [
      displayCmdbValue(item),
      item && item.description,
      item && item._description,
      item && item.Description,
      item && item.code,
      item && item.Code,
      item && item.name
    ].map(displayCmdbValue);
    return candidates.some((candidate) => candidate === lookupText);
  }) || null;
}

async function getLookupParentValue(authToken, value, rule, context) {
  const directParentText = displayLookupParentInline(value);
  if (directParentText) return { description: directParentText };

  const parent = value && (value.parent || value._parent);
  const parentType = cleanValue(value && (
    value.parent_type ||
    value.parentType ||
    value._parent_type ||
    value._parentType ||
    rule.parentLookupType
  ));
  const parentId = cleanValue(value && (
    value.parent_id ||
    value.parentId ||
    value._parent_id ||
    value._parentId ||
    (parent && typeof parent !== 'object' ? parent : '')
  ));
  if (!parentType || !parentId) return null;
  return getLookupValueById(authToken, parentType, parentId, context);
}

function displayLookupParentInline(value) {
  if (!value || typeof value !== 'object') return '';
  const parent = value.parent || value._parent;
  if (parent && typeof parent === 'object') {
    return cleanValue(parent.description || parent._description || parent.Description || parent.code || parent.Code || parent.name);
  }
  return cleanValue(value.parent_description || value._parent_description || value.parentDescription);
}

async function getLookupValuesByType(authToken, lookupType, context) {
  const type = cleanValue(lookupType);
  if (!type) return [];
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
  return values;
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
  if (requestUrl.pathname === `${API_PREFIX}/about` && req.method === 'GET') {
    sendJson(res, 200, { service: SERVICE, identity: buildIdentityPayload() });
    return;
  }
  sendJson(res, 404, { ok: false, message: 'Labels API route not found.' });
}

function readAppVersion(filePath = VERSION_FILE_PATH) {
  try {
    const version = fs.readFileSync(filePath, 'utf8').trim();
    return APP_VERSION_PATTERN.test(version) ? version : APP_VERSION_FALLBACK;
  } catch (error) {
    return APP_VERSION_FALLBACK;
  }
}

function injectAppVersion(html, version = readAppVersion()) {
  return String(html).replace(/(<span\s+data-app-version>)[^<]*(<\/span>)/, `$1${version}$2`);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeEmail(value) {
  return cleanValue(value).replace(/[\r\n<>"']/g, '');
}

function injectFooterConfig(html, config = {}) {
  const enabled = config.enabled !== false;
  const title = escapeHtml(config.title || FOOTER_TITLE);
  const text = escapeHtml(config.text || FOOTER_TEXT);
  const email = sanitizeEmail(config.email || FOOTER_EMAIL);
  const subject = cleanValue(config.subject || FOOTER_SUBJECT);
  const hidden = enabled ? '' : ' hidden';
  const href = email ? `mailto:${email}?subject=${encodeURIComponent(subject)}` : '';
  const emailHtml = email && href ? `<a data-footer-email href="${href}">${escapeHtml(email)}</a>` : '';

  return String(html).replace(
    /<div id="pageFooter" class="page-footer"[\s\S]*?<\/div>\s*<\/div>/,
    `<div id="pageFooter" class="page-footer"${hidden}>\n    <div class="footer-title" data-footer-title>${title}</div>\n    <div><span data-footer-text>${text}</span>${emailHtml ? ` ${emailHtml}` : ''}</div>\n</div>`
  );
}

function serveUi(res) {
  const html = injectFooterConfig(injectAppVersion(fs.readFileSync(UI_HTML_PATH, 'utf8')), {
    enabled: FOOTER_ENABLED,
    title: FOOTER_TITLE,
    text: FOOTER_TEXT,
    email: FOOTER_EMAIL,
    subject: FOOTER_SUBJECT
  });
  sendHtml(res, 200, html);
}

function proxyToCmdbuild(req, res, requestUrl) {
  if (!isSafeRelativeRequestTarget(req.url || '/')) {
    writeLog('warn', 'cmdbuild.proxy_target_rejected', {
      method: req.method,
      path: requestUrl.pathname
    });
    sendJson(res, 400, { ok: false, message: 'CMDBuild proxy request target is not allowed.' });
    return;
  }

  if (!isCmdbuildProxyPathAllowed(requestUrl.pathname, CMDBUILD_PROXY_ALLOWLIST_STRICT, req.method)) {
    writeLog('warn', 'cmdbuild.proxy_path_rejected', {
      method: req.method,
      path: requestUrl.pathname
    });
    sendJson(res, 403, { ok: false, message: 'CMDBuild proxy path is not allowed.' });
    return;
  }

  const target = new URL(`${requestUrl.pathname}${requestUrl.search}`, CMDBUILD_ORIGIN);
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
    if (requestUrl.pathname === '/about') {
      sendJson(res, 200, { service: SERVICE, identity: buildIdentityPayload() });
      return;
    }
    if (requestUrl.pathname === '/health/live' || requestUrl.pathname === '/health/ready') {
      handleHealth(req, res, requestUrl).catch((error) => {
        writeLog('error', 'health.check_failed', {
          path: requestUrl.pathname,
          message: error.message || String(error)
        });
        sendJson(res, 503, { ...baseHealthPayload(), ready: false, status: 'not_ready' });
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
  for (const warning of validation.warnings) {
    writeLog('warn', 'app.config_warning', {
      code: warning.code,
      env: warning.env,
      path: warning.path
    }, { force: true });
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
  buildIdentityPayload,
  createServer,
  filterClassesByRoot,
  injectAppVersion,
  injectFooterConfig,
  isCmdbuildProxyPathAllowed,
  isCmdbuildUiCacheSensitive,
  isJsonContentType,
  isSafeRelativeRequestTarget,
  isSameOriginRequest,
  loggingStatus,
  normalizeClassRootPath,
  normalizeDiagnosticMode,
  normalizeLogTargets,
  readinessPayload,
  readAppVersion,
  readAliasConfigFromEnv,
  renderMetrics,
  resolveDrafts,
  rewriteCmdbuildManifest,
  rewriteCmdbuildUiHtml,
  securityHeaders,
  escapePrometheusLabelValue,
  validateRuntimeConfig
};
