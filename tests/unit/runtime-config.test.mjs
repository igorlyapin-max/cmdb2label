import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildIdentityPayload,
  injectAppVersion,
  injectFooterConfig,
  normalizeClassRootPath,
  normalizeLogTargets,
  readinessPayload,
  readAliasConfigFromEnv,
  readAppVersion,
  runtimeConfigSummary,
  validateRuntimeConfig
} from '../../src/server.mjs';

test('production runtime requires stable CSRF secret', () => {
  const result = validateRuntimeConfig({
    nodeEnv: 'production',
    csrfSecret: '',
    logTargets: ['stdout']
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === 'csrf_secret_required'), true);
});

test('production runtime rejects example CSRF placeholder', () => {
  const placeholder = ['change', 'me', 'to', 'a', 'stable', 'secret', 'from', 'secret', 'store'].join('-');
  const result = validateRuntimeConfig({
    nodeEnv: 'production',
    csrfSecret: placeholder,
    logTargets: ['stdout', 'syslog'],
    aliasConfigValidation: { ok: true, source: 'default', configured: false, errors: [], warnings: [] }
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === 'csrf_secret_placeholder'), true);
});

test('runtime config rejects production stdout-only logging without external sink', () => {
  const result = validateRuntimeConfig({
    nodeEnv: 'production',
    csrfSecret: 'stable-test-value',
    logTargets: ['stdout']
  });

  assert.equal(result.ok, false);
  const error = result.errors.find((item) => item.code === 'external_log_sink_required');
  assert.ok(error);
  assert.match(error.message, /CMDB_LABELS_LOG_EXTERNAL_SINK to be one of: platform, collector, sidecar, docker-driver/);
  assert.match(error.message, /CMDB_LABELS_LOG_TARGET=stdout,syslog/);
});

test('runtime config summary includes safe error details for startup logs', () => {
  const result = validateRuntimeConfig({
    nodeEnv: 'production',
    csrfSecret: 'stable-test-value',
    logTargets: ['stdout']
  });
  const summary = runtimeConfigSummary(result);

  assert.deepEqual(summary.errors, ['external_log_sink_required']);
  assert.equal(summary.errorDetails[0].env, 'CMDB_LABELS_LOG_EXTERNAL_SINK');
  assert.match(summary.errorDetails[0].message, /CMDB_LABELS_LOG_EXTERNAL_SINK to be one of/);
});

test('runtime config summary does not expose alias config file paths', () => {
  const filePath = path.join(os.tmpdir(), 'cmdb2label-internal-secret-path', 'aliases.json');
  const result = validateRuntimeConfig({
    nodeEnv: 'production',
    csrfSecret: 'stable-test-value',
    logTargets: ['stdout'],
    externalLogSink: 'platform',
    env: {
      NODE_ENV: 'production',
      CMDB_LABELS_CSRF_SECRET: 'stable-test-value',
      CMDB_LABELS_ALIAS_CONFIG_FILE: filePath
    }
  });
  const summary = runtimeConfigSummary(result);

  assert.deepEqual(summary.errors, ['alias_config_file_unreadable']);
  assert.equal(summary.errorDetails[0].message, 'Cannot read CMDB labels alias config file.');
  assert.equal(JSON.stringify(summary.errorDetails).includes(filePath), false);
});

test('runtime config accepts production stdout logging with platform sink', () => {
  const result = validateRuntimeConfig({
    nodeEnv: 'production',
    csrfSecret: 'stable-test-value',
    logTargets: ['stdout'],
    externalLogSink: 'platform'
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('runtime config accepts production stdout logging with docker driver sink', () => {
  const result = validateRuntimeConfig({
    nodeEnv: 'production',
    csrfSecret: 'stable-test-value',
    logTargets: ['stdout'],
    externalLogSink: 'docker-driver'
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('runtime config accepts production stdout and syslog without external sink', () => {
  const result = validateRuntimeConfig({
    nodeEnv: 'production',
    csrfSecret: 'stable-test-value',
    logTargets: ['stdout', 'syslog'],
    env: {
      NODE_ENV: 'production',
      CMDB_LABELS_CSRF_SECRET: 'stable-test-value',
      CMDB_LABELS_SYSLOG_HOST: '127.0.0.1',
      CMDB_LABELS_SYSLOG_PORT: '514',
      CMDB_LABELS_SYSLOG_PROTOCOL: 'udp',
      CMDB_LABELS_SYSLOG_FACILITY: 'local0'
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('invalid production startup writes config error details and exits', (t) => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const result = spawnSync(process.execPath, ['src/server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      CMDB_LABELS_CSRF_SECRET: 'stable-test-value',
      CMDB_LABELS_LOG_TARGET: 'stdout',
      CMDB_LABELS_LOG_EXTERNAL_SINK: '',
      CMDB_LABELS_PORT: '18199'
    },
    encoding: 'utf8'
  });
  if (result.error && result.error.code === 'EPERM') {
    t.skip('sandbox blocks child-process startup smoke');
    return;
  }
  const lines = `${result.stdout}\n${result.stderr}`.trim().split('\n').filter(Boolean);
  const log = JSON.parse(lines.find((line) => line.includes('"event":"app.config_invalid"')));

  assert.equal(result.status, 1);
  assert.equal(log.event, 'app.config_invalid');
  assert.deepEqual(log.errors, ['external_log_sink_required']);
  assert.equal(log.errorDetails[0].env, 'CMDB_LABELS_LOG_EXTERNAL_SINK');
});

test('runtime config validates syslog config only when syslog target is enabled', () => {
  const result = validateRuntimeConfig({
    nodeEnv: 'production',
    csrfSecret: 'stable-test-value',
    logTargets: ['stdout', 'syslog'],
    env: {
      NODE_ENV: 'production',
      CMDB_LABELS_CSRF_SECRET: 'stable-test-value',
      CMDB_LABELS_SYSLOG_HOST: '127.0.0.1',
      CMDB_LABELS_SYSLOG_PORT: '99999',
      CMDB_LABELS_SYSLOG_PROTOCOL: 'bad',
      CMDB_LABELS_SYSLOG_FACILITY: 'bad'
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === 'syslog_port_invalid'), true);
  assert.equal(result.errors.some((error) => error.code === 'syslog_protocol_invalid'), true);
  assert.equal(result.errors.some((error) => error.code === 'syslog_facility_invalid'), true);
});

test('log target normalization always includes stdout', () => {
  assert.deepEqual(normalizeLogTargets('syslog'), ['stdout', 'syslog']);
  assert.deepEqual(normalizeLogTargets(''), ['stdout']);
});

test('class root path normalization accepts classes path variants', () => {
  assert.deepEqual(normalizeClassRootPath('/classes/ZabbixMonitoring'), {
    ok: true,
    path: '/classes/ZabbixMonitoring',
    rootName: 'ZabbixMonitoring',
    segments: ['classes', 'ZabbixMonitoring']
  });
  assert.equal(normalizeClassRootPath('classes/ZabbixMonitoring/').path, '/classes/ZabbixMonitoring');
});

test('runtime config rejects class root outside classes namespace', () => {
  const result = validateRuntimeConfig({
    nodeEnv: 'development',
    csrfSecret: 'dev-value',
    logTargets: ['stdout'],
    env: {
      NODE_ENV: 'development',
      CMDB_LABELS_CLASS_ROOT_PATH: '/domains/ZabbixMonitoring'
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === 'class_root_path_invalid'), true);
});

test('runtime config rejects invalid bounded integer values', () => {
  const result = validateRuntimeConfig({
    nodeEnv: 'development',
    csrfSecret: 'dev-value',
    logTargets: ['stdout'],
    env: {
      NODE_ENV: 'development',
      CMDB_LABELS_MAX_REST_CALLS: 'Infinity',
      CMDB_LABELS_MAX_CLASSES: '0',
      CMDB_LABELS_REQUEST_TIMEOUT_MS: '999999999'
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors.filter((error) => error.code === 'runtime_integer_invalid').length, 3);
});

test('runtime config validates custom CA mount mode', () => {
  const missing = validateRuntimeConfig({
    nodeEnv: 'development',
    csrfSecret: 'dev-value',
    logTargets: ['stdout'],
    env: {
      NODE_ENV: 'development',
      CMDB_LABELS_CUSTOM_CA_MODE: 'mount',
      CMDB_LABELS_CUSTOM_CA_FILE: path.join(os.tmpdir(), 'cmdb2label-missing-ca.crt')
    }
  });

  assert.equal(missing.ok, false);
  assert.equal(missing.errors.some((error) => error.code === 'custom_ca_file_unreadable'), true);

  const filePath = path.join(os.tmpdir(), `cmdb2label-ca-${process.pid}.crt`);
  fs.writeFileSync(filePath, '-----BEGIN CERTIFICATE-----\nplaceholder\n-----END CERTIFICATE-----\n');
  try {
    const valid = validateRuntimeConfig({
      nodeEnv: 'development',
      csrfSecret: 'dev-value',
      logTargets: ['stdout'],
      env: {
        NODE_ENV: 'development',
        CMDB_LABELS_CUSTOM_CA_MODE: 'mount',
        CMDB_LABELS_CUSTOM_CA_FILE: filePath
      }
    });

    assert.equal(valid.ok, true);
    assert.equal(valid.customCa.mode, 'mount');
    assert.equal(valid.customCa.file, filePath);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

test('readiness reports not ready when runtime config is invalid', async () => {
  const previous = process.env.CMDB_LABELS_CLASS_ROOT_PATH;
  process.env.CMDB_LABELS_CLASS_ROOT_PATH = '/domains/ZabbixMonitoring';
  try {
    const result = await readinessPayload();

    assert.equal(result.ready, false);
    assert.equal(result.status, 'not_ready');
  } finally {
    if (previous === undefined) delete process.env.CMDB_LABELS_CLASS_ROOT_PATH;
    else process.env.CMDB_LABELS_CLASS_ROOT_PATH = previous;
  }
});

test('runtime config fails when alias config file is unreadable', () => {
  const result = validateRuntimeConfig({
    nodeEnv: 'development',
    csrfSecret: 'dev-value',
    logTargets: ['stdout'],
    env: {
      NODE_ENV: 'development',
      CMDB_LABELS_ALIAS_CONFIG_FILE: path.join(os.tmpdir(), 'cmdb2label-missing-aliases.json')
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === 'alias_config_file_unreadable'), true);
});

test('readAliasConfigFromEnv rejects malformed inline JSON', () => {
  const result = readAliasConfigFromEnv({
    CMDB_LABELS_ALIAS_CONFIG: '{"aliases":'
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === 'alias_config_json_invalid'), true);
});

test('readAliasConfigFromEnv rejects invalid alias schema', () => {
  const result = readAliasConfigFromEnv({
    CMDB_LABELS_ALIAS_CONFIG: JSON.stringify({ aliases: { type: 'Тип' } })
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === 'alias_array_required'), true);
});

test('readAliasConfigFromEnv loads valid file config and surfaces legacy warnings', () => {
  const filePath = path.join(os.tmpdir(), `cmdb2label-aliases-${process.pid}.json`);
  fs.writeFileSync(filePath, JSON.stringify({
    aliases: { cls: ['LegacyType'] },
    derivedFields: {
      groupFromLookupParent: {
        sourceField: 'model',
        targetField: 'cls',
        sourceLookupType: 'Model',
        parentLookupType: 'ModelGroup'
      }
    }
  }));

  try {
    const result = readAliasConfigFromEnv({ CMDB_LABELS_ALIAS_CONFIG_FILE: filePath });

    assert.equal(result.ok, true);
    assert.equal(result.configured, true);
    assert.equal(result.source, 'CMDB_LABELS_ALIAS_CONFIG_FILE');
    assert.equal(result.warnings.some((warning) => warning.code === 'legacy_aliases_cls'), true);
    assert.equal(result.warnings.some((warning) => warning.code === 'legacy_group_from_lookup_parent'), true);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

test('app version falls back when VERSION is absent or invalid', () => {
  const missingPath = path.join(os.tmpdir(), `cmdb2label-missing-version-${process.pid}`);
  const invalidPath = path.join(os.tmpdir(), `cmdb2label-invalid-version-${process.pid}`);
  fs.writeFileSync(invalidPath, '1.2.3\n');

  try {
    assert.equal(readAppVersion(missingPath), '0.0.0.0');
    assert.equal(readAppVersion(invalidPath), '0.0.0.0');
  } finally {
    fs.rmSync(invalidPath, { force: true });
  }
});

test('app version reads handoff VERSION format and injects it into UI html', () => {
  const versionPath = path.join(os.tmpdir(), `cmdb2label-version-${process.pid}`);
  fs.writeFileSync(versionPath, '00.00.00.01\n');

  try {
    assert.equal(readAppVersion(versionPath), '00.00.00.01');
    assert.equal(
      injectAppVersion('<div>v<span data-app-version>0.0.0.0</span></div>', readAppVersion(versionPath)),
      '<div>v<span data-app-version>00.00.00.01</span></div>'
    );
  } finally {
    fs.rmSync(versionPath, { force: true });
  }
});

test('footer config injection escapes text and encodes mailto subject', () => {
  const html = `<div id="pageFooter" class="page-footer">
    <div class="footer-title" data-footer-title>Old</div>
    <div><span data-footer-text>Old:</span> <a data-footer-email href="mailto:old@example.test">old@example.test</a></div>
</div>`;
  const result = injectFooterConfig(html, {
    enabled: true,
    title: '<DIT>',
    text: 'Пишите сюда:',
    email: 'ritm.all@gkm.ru',
    subject: 'Предложения по CMDBuild Label'
  });

  assert.match(result, /&lt;DIT&gt;/);
  assert.match(result, /Пишите сюда:/);
  assert.match(result, /mailto:ritm\.all@gkm\.ru\?subject=%D0%9F%D1%80/);
  assert.doesNotMatch(result, /<DIT>/);
});

test('build identity does not promote runtime env provenance to verified', () => {
  const versionPath = path.join(os.tmpdir(), `cmdb2label-identity-version-${process.pid}`);
  const artifactPath = path.join(os.tmpdir(), `cmdb2label-identity-ui-${process.pid}.html`);
  fs.writeFileSync(versionPath, '00.00.00.09\n');
  fs.writeFileSync(artifactPath, '<html>label ui</html>');
  const hash = cryptoHashFile(artifactPath);

  try {
    const identity = buildIdentityPayload({
      CMDB_LABELS_BUILD_VERSION: '00.00.00.09',
      CMDB_LABELS_BUILD_REVISION: '1234567890abcdef1234567890abcdef12345678',
      CMDB_LABELS_BUILD_SOURCE_STATE: 'verified',
      CMDB_LABELS_RUNTIME_ARTIFACT_SHA256: hash
    }, {
      versionFilePath: versionPath,
      runtimeArtifactPath: artifactPath
    });

    assert.equal(identity.version, '00.00.00.09');
    assert.equal(identity.buildVersion, '00.00.00.09');
    assert.equal(identity.revision, '1234567890abcdef1234567890abcdef12345678');
    assert.equal(identity.sourceState, 'unverified-local');
    assert.equal(identity.buildMode, 'manual');
    assert.equal(identity.runtimeArtifact.sha256, hash);
    assert.equal(identity.runtimeArtifact.matchesExpected, true);
  } finally {
    fs.rmSync(versionPath, { force: true });
    fs.rmSync(artifactPath, { force: true });
  }
});

test('build identity exposes verified only from matching embedded canonical provenance', () => {
  const versionPath = path.join(os.tmpdir(), `cmdb2label-verified-version-${process.pid}`);
  const artifactPath = path.join(os.tmpdir(), `cmdb2label-verified-ui-${process.pid}.html`);
  const identityPath = path.join(os.tmpdir(), `cmdb2label-verified-identity-${process.pid}.json`);
  fs.writeFileSync(versionPath, '00.00.00.11\n');
  fs.writeFileSync(artifactPath, '<html>verified image</html>');
  const hash = cryptoHashFile(artifactPath);
  fs.writeFileSync(identityPath, JSON.stringify({
    version: '00.00.00.11',
    buildVersion: '00.00.00.11',
    revision: '1234567890abcdef1234567890abcdef12345678',
    sourceState: 'verified',
    buildMode: 'canonical',
    runtimeArtifact: {
      path: 'cmdb2label.html',
      sha256: hash,
      expectedSha256: hash,
      matchesExpected: true
    }
  }));

  try {
    const identity = buildIdentityPayload({
      CMDB_LABELS_BUILD_SOURCE_STATE: 'unverified-local',
      CMDB_LABELS_BUILD_MODE: 'manual'
    }, {
      versionFilePath: versionPath,
      runtimeArtifactPath: artifactPath,
      buildIdentityFilePath: identityPath
    });

    assert.equal(identity.sourceState, 'verified');
    assert.equal(identity.buildMode, 'canonical');
    assert.equal(identity.runtimeArtifact.matchesExpected, true);
  } finally {
    fs.rmSync(versionPath, { force: true });
    fs.rmSync(artifactPath, { force: true });
    fs.rmSync(identityPath, { force: true });
  }
});

test('build identity treats missing or invalid provenance as unverified local', () => {
  const identity = buildIdentityPayload({
    CMDB_LABELS_BUILD_VERSION: 'bad',
    CMDB_LABELS_BUILD_REVISION: 'dirty',
    CMDB_LABELS_BUILD_SOURCE_STATE: 'dirty',
    CMDB_LABELS_RUNTIME_ARTIFACT_SHA256: 'bad'
  });

  assert.equal(identity.revision, 'unknown');
  assert.equal(identity.sourceState, 'unverified-local');
  assert.equal(identity.buildMode, 'manual');
  assert.equal(identity.runtimeArtifact.expectedSha256, 'unknown');
  assert.equal(identity.runtimeArtifact.matchesExpected, false);
});

test('build identity reads embedded image provenance when env is not supplied', () => {
  const versionPath = path.join(os.tmpdir(), `cmdb2label-embedded-version-${process.pid}`);
  const artifactPath = path.join(os.tmpdir(), `cmdb2label-embedded-ui-${process.pid}.html`);
  const identityPath = path.join(os.tmpdir(), `cmdb2label-embedded-identity-${process.pid}.json`);
  fs.writeFileSync(versionPath, '00.00.00.10\n');
  fs.writeFileSync(artifactPath, '<html>manual image</html>');
  const hash = cryptoHashFile(artifactPath);
  fs.writeFileSync(identityPath, JSON.stringify({
    version: '00.00.00.10',
    buildVersion: '00.00.00.10',
    revision: 'unknown',
    sourceState: 'unverified-local',
    buildMode: 'manual',
    runtimeArtifact: {
      path: 'cmdb2label.html',
      sha256: hash,
      expectedSha256: hash,
      matchesExpected: true
    }
  }));

  try {
    const identity = buildIdentityPayload({}, {
      versionFilePath: versionPath,
      runtimeArtifactPath: artifactPath,
      buildIdentityFilePath: identityPath
    });

    assert.equal(identity.version, '00.00.00.10');
    assert.equal(identity.buildVersion, '00.00.00.10');
    assert.equal(identity.revision, 'unknown');
    assert.equal(identity.sourceState, 'unverified-local');
    assert.equal(identity.buildMode, 'manual');
    assert.equal(identity.runtimeArtifact.expectedSha256, hash);
    assert.equal(identity.runtimeArtifact.matchesExpected, true);
  } finally {
    fs.rmSync(versionPath, { force: true });
    fs.rmSync(artifactPath, { force: true });
    fs.rmSync(identityPath, { force: true });
  }
});

function cryptoHashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
