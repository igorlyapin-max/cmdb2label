import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeLogTargets, readAliasConfigFromEnv, validateRuntimeConfig } from '../../src/server.mjs';

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
  const result = validateRuntimeConfig({
    nodeEnv: 'production',
    csrfSecret: 'change-me-to-a-stable-secret-from-secret-store',
    logTargets: ['stdout', 'syslog'],
    aliasConfigValidation: { ok: true, source: 'default', configured: false, errors: [], warnings: [] }
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === 'csrf_secret_placeholder'), true);
});

test('runtime config accepts production with CSRF secret and stdout logging', () => {
  const result = validateRuntimeConfig({
    nodeEnv: 'production',
    csrfSecret: 'stable-test-secret',
    logTargets: ['stdout', 'syslog']
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('production runtime requires an operational log sink beyond stdout', () => {
  const result = validateRuntimeConfig({
    nodeEnv: 'production',
    csrfSecret: 'stable-test-secret',
    logTargets: ['stdout']
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === 'operational_log_sink_required'), true);
});

test('log target normalization always includes stdout', () => {
  assert.deepEqual(normalizeLogTargets('syslog'), ['stdout', 'syslog']);
  assert.deepEqual(normalizeLogTargets(''), ['stdout']);
});

test('runtime config fails when alias config file is unreadable', () => {
  const result = validateRuntimeConfig({
    nodeEnv: 'development',
    csrfSecret: 'dev-secret',
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
