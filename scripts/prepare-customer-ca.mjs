#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const source = readArg('--source') || args[0];
if (!source) usage('Missing --source <customer-ca.crt|customer-ca.pem>.');

const sourcePath = path.resolve(source);
const ext = path.extname(sourcePath).toLowerCase();
if (!['.crt', '.pem'].includes(ext)) {
  usage('Customer CA source must be a .crt or .pem file. Private keys and archives are not accepted by this helper.');
}
const stat = fs.statSync(sourcePath);
if (!stat.isFile()) usage('Customer CA source must be a file.');

const content = fs.readFileSync(sourcePath);
const text = content.toString('utf8');
if (!text.includes('-----BEGIN CERTIFICATE-----') || !text.includes('-----END CERTIFICATE-----')) {
  usage('Customer CA source does not look like a PEM certificate.');
}
if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(text)) {
  usage('Customer CA source must not contain a private key.');
}

const targetDir = path.resolve('certs/customer-ca');
const targetPath = path.join(targetDir, 'customer-ca.crt');
fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(sourcePath, targetPath);

const sha256 = crypto.createHash('sha256').update(content).digest('hex');
console.log(JSON.stringify({
  source: sourcePath,
  target: targetPath,
  sha256,
  nextBuildCommand: 'docker build --build-arg CMDB_LABELS_EMBED_CUSTOM_CA=required -t ghcr.io/igorlyapin-max/cmdb2label:<version>-customer-ca .'
}, null, 2));

function readArg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

function usage(message) {
  if (message) console.error(message);
  console.error('Usage: node scripts/prepare-customer-ca.mjs --source <customer-ca.crt|customer-ca.pem>');
  process.exit(2);
}
