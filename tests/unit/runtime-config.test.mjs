import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLogTargets, validateRuntimeConfig } from '../../src/server.mjs';

test('production runtime requires stable CSRF secret', () => {
  const result = validateRuntimeConfig({
    nodeEnv: 'production',
    csrfSecret: '',
    logTargets: ['stdout']
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === 'csrf_secret_required'), true);
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
