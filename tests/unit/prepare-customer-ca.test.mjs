import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('prepare-customer-ca copies PEM certificate and rejects private keys', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdb2label-ca-helper-'));
  const cwd = process.cwd();
  const certSource = path.join(tempDir, 'input.crt');
  const keySource = path.join(tempDir, 'input.key');
  fs.mkdirSync(path.join(tempDir, 'certs/customer-ca'), { recursive: true });
  fs.writeFileSync(certSource, [
    '-----BEGIN CERTIFICATE-----',
    'MIIBplaceholder',
    '-----END CERTIFICATE-----',
    ''
  ].join('\n'));
  fs.writeFileSync(keySource, [
    '-----BEGIN PRIVATE KEY-----',
    'MIIBplaceholder',
    '-----END PRIVATE KEY-----',
    ''
  ].join('\n'));

  try {
    const ok = spawnSync(process.execPath, [path.join(cwd, 'scripts/prepare-customer-ca.mjs'), '--source', certSource], {
      cwd: tempDir,
      encoding: 'utf8'
    });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(fs.existsSync(path.join(tempDir, 'certs/customer-ca/customer-ca.crt')), true);
    assert.match(ok.stdout, /"sha256":/);

    const rejected = spawnSync(process.execPath, [path.join(cwd, 'scripts/prepare-customer-ca.mjs'), '--source', keySource], {
      cwd: tempDir,
      encoding: 'utf8'
    });
    assert.equal(rejected.status, 2);
    assert.match(rejected.stderr, /must be a \.crt or \.pem file/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
