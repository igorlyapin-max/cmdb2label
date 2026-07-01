import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_CMDBUILD_ORIGIN = 'http://127.0.0.1:8090';
const DEFAULT_ZIP_PATH = 'dist/cmdblabels-custompage.zip';
const CUSTOMPAGES_PATH = '/services/rest/v3/custompages';
const SESSIONS_PATH = '/services/rest/v3/sessions/?ext=true';
const REQUEST_TIMEOUT_MS = 15000;

const DEFAULT_CUSTOMPAGE_METADATA = Object.freeze({
  name: 'CmdbLabels',
  description: 'CMDB Labels',
  alias: 'widget.cmdb-labels',
  componentId: 'view.custompages.CmdbLabels.CmdbLabels',
  active: true
});

class RegisterError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'RegisterError';
    this.details = details;
  }
}

function normalizeCmdbuildBaseUrl(input = DEFAULT_CMDBUILD_ORIGIN) {
  const url = new URL(String(input || DEFAULT_CMDBUILD_ORIGIN));
  let pathname = url.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/') pathname = '/cmdbuild';
  if (pathname.endsWith('/services/rest/v3')) {
    pathname = pathname.slice(0, -'/services/rest/v3'.length) || '/cmdbuild';
  }
  url.pathname = pathname;
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function restUrl(baseUrl, restPath) {
  return `${baseUrl}${restPath}`;
}

function parseArgs(argv = []) {
  const result = {
    dryRun: false,
    updateExisting: true,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--no-update') {
      result.updateExisting = false;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--origin' || arg === '--cmdbuild-origin') {
      result.origin = requireValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--origin=')) {
      result.origin = arg.slice('--origin='.length);
    } else if (arg.startsWith('--cmdbuild-origin=')) {
      result.origin = arg.slice('--cmdbuild-origin='.length);
    } else if (arg === '--zip') {
      result.zipPath = requireValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--zip=')) {
      result.zipPath = arg.slice('--zip='.length);
    } else {
      throw new RegisterError(`Unknown argument: ${arg}`);
    }
  }

  return result;
}

function requireValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new RegisterError(`Argument ${arg} requires a value.`);
  }
  return value;
}

function loadConfig(env = process.env, argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cmdbuildOrigin = args.origin || env.CMDBUILD_ORIGIN || DEFAULT_CMDBUILD_ORIGIN;
  const zipPath = path.resolve(args.zipPath || env.CMDB_LABELS_CUSTOMPAGE_ZIP || DEFAULT_ZIP_PATH);
  const cookieHeader = env.CMDBUILD_COOKIE_HEADER || readCookieJar(env.CMDBUILD_COOKIE_JAR || '');
  const password = env.CMDBUILD_PASSWORD || readSecretFile(env.CMDBUILD_PASSWORD_FILE || '');

  return {
    help: args.help,
    dryRun: args.dryRun || isTruthy(env.CMDB_LABELS_REGISTER_DRY_RUN),
    updateExisting: args.updateExisting,
    cmdbuildBaseUrl: normalizeCmdbuildBaseUrl(cmdbuildOrigin),
    zipPath,
    metadata: { ...DEFAULT_CUSTOMPAGE_METADATA },
    auth: {
      authorization: cleanHeaderValue(env.CMDBUILD_AUTHORIZATION),
      cookieHeader,
      username: env.CMDBUILD_USERNAME || '',
      password,
      role: env.CMDBUILD_ROLE || '',
      scope: env.CMDBUILD_SCOPE || 'ui'
    },
    requestTimeoutMs: Number(env.CMDB_LABELS_REGISTER_TIMEOUT_MS || REQUEST_TIMEOUT_MS) || REQUEST_TIMEOUT_MS
  };
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function cleanHeaderValue(value) {
  const text = String(value || '').trim();
  return text.replace(/^CMDBuild-Authorization=/i, '');
}

function readSecretFile(filePath) {
  if (!filePath) return '';
  return fs.readFileSync(filePath, 'utf8').trim();
}

function readCookieJar(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  const cookies = [];
  for (let line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('#HttpOnly_')) {
      line = line.slice('#HttpOnly_'.length);
    } else if (line.startsWith('#')) {
      continue;
    }
    const parts = line.split(/\t/);
    if (parts.length >= 7) cookies.push(`${parts[5]}=${parts.slice(6).join('\t')}`);
  }
  return cookies.join('; ');
}

function redactedConfigSummary(config) {
  return {
    cmdbuildBaseUrl: config.cmdbuildBaseUrl,
    zipPath: path.relative(process.cwd(), config.zipPath) || config.zipPath,
    dryRun: config.dryRun,
    updateExisting: config.updateExisting,
    metadata: config.metadata,
    authMode: authMode(config.auth),
    endpoints: {
      list: restUrl(config.cmdbuildBaseUrl, CUSTOMPAGES_PATH),
      create: restUrl(config.cmdbuildBaseUrl, CUSTOMPAGES_PATH)
    }
  };
}

function authMode(auth = {}) {
  if (auth.authorization) return 'CMDBUILD_AUTHORIZATION';
  if (auth.cookieHeader) return 'CMDBUILD_COOKIE_HEADER';
  if (auth.username && auth.password) return 'CMDBUILD_USERNAME_PASSWORD';
  return 'missing';
}

function validateConfig(config) {
  const errors = [];
  if (!config.help && !config.dryRun && authMode(config.auth) === 'missing') {
    errors.push('Set CMDBUILD_AUTHORIZATION, CMDBUILD_COOKIE_HEADER/CMDBUILD_COOKIE_JAR, or CMDBUILD_USERNAME + CMDBUILD_PASSWORD.');
  }
  if (!config.dryRun && !fs.existsSync(config.zipPath)) {
    errors.push(`ZIP artifact is missing: ${path.relative(process.cwd(), config.zipPath)}. Run npm run build:zip first.`);
  }
  if (!config.dryRun && fs.existsSync(config.zipPath) && !fs.statSync(config.zipPath).isFile()) {
    errors.push(`ZIP artifact path is not a file: ${config.zipPath}`);
  }
  if (errors.length) throw new RegisterError(errors.join('\n'));
}

async function resolveAuthHeaders(config) {
  if (config.auth.authorization) {
    return { mode: 'CMDBUILD_AUTHORIZATION', headers: { 'CMDBuild-Authorization': config.auth.authorization } };
  }
  if (config.auth.cookieHeader) {
    return { mode: 'CMDBUILD_COOKIE_HEADER', headers: { cookie: config.auth.cookieHeader } };
  }
  if (config.auth.username && config.auth.password) {
    const session = await login(config);
    return {
      mode: session.mode,
      headers: session.headers
    };
  }
  throw new RegisterError('CMDBuild authorization is missing.');
}

async function login(config) {
  const payload = {
    username: config.auth.username,
    password: config.auth.password,
    scope: config.auth.scope || 'ui'
  };
  if (config.auth.role) payload.role = config.auth.role;

  const response = await requestJson(restUrl(config.cmdbuildBaseUrl, SESSIONS_PATH), {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload),
    timeoutMs: config.requestTimeoutMs
  });

  const cookie = extractSessionCookie(response.headers);
  if (cookie) {
    return { mode: 'CMDBUILD_USERNAME_PASSWORD_COOKIE', headers: { cookie } };
  }

  const token = extractSessionToken(response);
  if (token) {
    return { mode: 'CMDBUILD_USERNAME_PASSWORD', headers: { 'CMDBuild-Authorization': token } };
  }

  throw new RegisterError('CMDBuild login succeeded but no session token was found in response.');
}

function extractSessionToken(response) {
  const headerToken = response.headers.get('cmdbuild-authorization') || response.headers.get('CMDBuild-Authorization');
  if (headerToken) return headerToken;
  const json = response.json || {};
  const data = json.data || {};
  return data._id || data.token || data.sessionId || json._id || json.token || json.sessionId || '';
}

function extractSessionCookie(headers) {
  const setCookie = headers.getSetCookie ? headers.getSetCookie() : [];
  const cookies = setCookie.length ? setCookie : [headers.get('set-cookie')].filter(Boolean);
  return cookies
    .map((cookie) => String(cookie).split(';')[0])
    .filter((cookie) => cookie.startsWith('CMDBuild-Authorization='))
    .join('; ');
}

async function registerCustomPage(config = loadConfig()) {
  validateConfig(config);

  if (config.help) {
    return { action: 'help', summary: usageText() };
  }

  if (config.dryRun) {
    return { action: 'dry-run', summary: redactedConfigSummary(config) };
  }

  const auth = await resolveAuthHeaders(config);
  const existing = config.updateExisting
    ? await findExistingCustomPage(config, auth.headers)
    : null;
  const uploadTarget = existing && customPageId(existing)
    ? `${CUSTOMPAGES_PATH}/${encodeURIComponent(String(customPageId(existing)))}`
    : CUSTOMPAGES_PATH;
  const method = existing ? 'PUT' : 'POST';
  const result = await uploadCustomPage(config, auth.headers, method, uploadTarget);

  return {
    action: existing ? 'updated' : 'created',
    authMode: auth.mode,
    id: existing ? customPageId(existing) : customPageId(result.json && result.json.data) || customPageId(result.json) || null,
    status: result.status,
    metadata: config.metadata
  };
}

async function findExistingCustomPage(config, authHeaders) {
  const response = await requestJson(restUrl(config.cmdbuildBaseUrl, `${CUSTOMPAGES_PATH}?limit=1000&detailed=true`), {
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...authHeaders
    },
    timeoutMs: config.requestTimeoutMs
  });
  const list = extractCustomPageList(response.json);
  return findMatchingCustomPage(list, config.metadata);
}

function extractCustomPageList(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json && json.data)) return json.data;
  if (Array.isArray(json && json.data && json.data.data)) return json.data.data;
  return [];
}

function findMatchingCustomPage(items, metadata = DEFAULT_CUSTOMPAGE_METADATA) {
  return (items || []).find((item) => {
    const fields = [
      item && item.name,
      item && item.code,
      item && item.Code,
      item && item._id,
      item && item.id
    ].map((value) => String(value || ''));
    return fields.includes(metadata.name) ||
      String(item && item.alias || '') === metadata.alias ||
      String(item && item.componentId || '') === metadata.componentId;
  }) || null;
}

function customPageId(item) {
  if (!item || typeof item !== 'object') return '';
  return item._id || item.id || item.Id || item.name || item.code || '';
}

async function uploadCustomPage(config, authHeaders, method, targetPath) {
  const zip = fs.readFileSync(config.zipPath);
  const { body, contentType } = buildMultipartPayload(config.metadata, zip, path.basename(config.zipPath));
  return requestJson(restUrl(config.cmdbuildBaseUrl, targetPath), {
    method,
    headers: {
      accept: 'application/json',
      'content-type': contentType,
      'content-length': String(body.length),
      ...authHeaders
    },
    body,
    timeoutMs: config.requestTimeoutMs
  });
}

function buildMultipartPayload(metadata, zipBuffer, filename = 'cmdblabels-custompage.zip') {
  const boundary = `----cmdb2label-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  const json = Buffer.from(JSON.stringify(metadata), 'utf8');
  const head = Buffer.from([
    `--${boundary}`,
    'Content-Disposition: form-data; name="data"',
    'Content-Type: application/json',
    '',
    ''
  ].join('\r\n'), 'utf8');
  const middle = Buffer.from([
    '',
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${escapeMultipartFilename(filename)}"`,
    'Content-Type: application/zip',
    '',
    ''
  ].join('\r\n'), 'utf8');
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    body: Buffer.concat([head, json, middle, zipBuffer, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

function escapeMultipartFilename(filename) {
  return String(filename || 'file.zip').replace(/["\r\n]/g, '_');
}

async function requestJson(url, options = {}) {
  const method = options.method || 'GET';
  const target = new URL(url);
  const transport = target.protocol === 'https:' ? https : http;
  const body = options.body || null;

  return new Promise((resolve, reject) => {
    const req = transport.request({
      method,
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      headers: options.headers || {},
      timeout: options.timeoutMs || REQUEST_TIMEOUT_MS
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const parsed = parseJsonSafe(text);
        const status = res.statusCode || 0;
        if (status < 200 || status >= 300) {
          reject(new RegisterError(`CMDBuild REST ${method} ${url} failed with HTTP ${status}.`, {
            status,
            body: safeErrorBody(parsed, text)
          }));
          return;
        }
        resolve({
          status,
          headers: wrapResponseHeaders(res.headers),
          json: parsed,
          text
        });
      });
    });
    req.on('timeout', () => req.destroy(new RegisterError(`CMDBuild REST ${method} ${url} timed out.`)));
    req.on('error', (error) => {
      if (error instanceof RegisterError) {
        reject(error);
        return;
      }
      reject(new RegisterError(`CMDBuild REST ${method} ${url} failed: ${error.message || String(error)}`));
    });
    if (body) req.write(body);
    req.end();
  });
}

function wrapResponseHeaders(headers = {}) {
  return {
    get(name) {
      const value = headers[String(name || '').toLowerCase()];
      if (Array.isArray(value)) return value.join(', ');
      return value || '';
    },
    getSetCookie() {
      const value = headers['set-cookie'];
      if (!value) return [];
      return Array.isArray(value) ? value : [value];
    }
  };
}

function parseJsonSafe(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function safeErrorBody(parsed, text) {
  const source = Object.keys(parsed || {}).length ? JSON.stringify(parsed) : String(text || '');
  return source
    .replace(/CMDBuild-Authorization=[^;"\s]+/g, 'CMDBuild-Authorization=<redacted>')
    .replace(/("password"\s*:\s*")[^"]+/gi, '$1<redacted>')
    .slice(0, 1000);
}

function usageText() {
  return [
    'Usage: node scripts/register-custompage.mjs [--dry-run] [--origin URL] [--zip PATH] [--no-update]',
    '',
    'Auth options:',
    '  CMDBUILD_AUTHORIZATION=<token>',
    '  CMDBUILD_COOKIE_HEADER="CMDBuild-Authorization=<token>; ..."',
    '  CMDBUILD_COOKIE_JAR=/tmp/cmdbuild-ui-cookie.txt',
    '  CMDBUILD_USERNAME=<user> CMDBUILD_PASSWORD=<password>',
    '  CMDBUILD_USERNAME=<user> CMDBUILD_PASSWORD_FILE=<path>',
    '  CMDBUILD_SCOPE=ui CMDBUILD_ROLE=<role>',
    '',
    'Defaults:',
    `  CMDBUILD_ORIGIN=${DEFAULT_CMDBUILD_ORIGIN}`,
    `  CMDB_LABELS_CUSTOMPAGE_ZIP=${DEFAULT_ZIP_PATH}`
  ].join('\n');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  registerCustomPage()
    .then((result) => {
      if (result.action === 'help') {
        console.log(result.summary);
      } else if (result.action === 'dry-run') {
        console.log(JSON.stringify(result.summary, null, 2));
      } else {
        console.log(JSON.stringify({
          ok: true,
          action: result.action,
          status: result.status,
          id: result.id,
          name: result.metadata.name,
          componentId: result.metadata.componentId,
          alias: result.metadata.alias,
          authMode: result.authMode
        }, null, 2));
      }
    })
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        message: error.message || String(error),
        details: error.details || {}
      }, null, 2));
      process.exitCode = 1;
    });
}

export {
  DEFAULT_CUSTOMPAGE_METADATA,
  RegisterError,
  buildMultipartPayload,
  cleanHeaderValue,
  extractCustomPageList,
  findMatchingCustomPage,
  loadConfig,
  normalizeCmdbuildBaseUrl,
  readCookieJar,
  redactedConfigSummary,
  registerCustomPage
};
