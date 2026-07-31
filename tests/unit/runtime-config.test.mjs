import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  injectAppVersion,
  normalizeClassRootPath,
  normalizeLogTargets,
  readinessPayload,
  readAliasConfigFromEnv,
  readAppVersion,
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

test('runtime config accepts production with CSRF secret and stdout logging', () => {
  const result = validateRuntimeConfig({
    nodeEnv: 'production',
    csrfSecret: 'stable-test-value',
    logTargets: ['stdout']
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
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
