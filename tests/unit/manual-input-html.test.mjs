import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../../cmdb2label.html', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `Function ${name} must exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Function ${name} body is not closed`);
}

function createHtmlHelpers() {
  const constantsStart = html.indexOf('const REQUIRED_FIELDS');
  const constantsEnd = html.indexOf('const API_BASE', constantsStart);
  assert.ok(constantsStart >= 0 && constantsEnd > constantsStart, 'manual parser constants must exist');

  const script = [
    html.slice(constantsStart, constantsEnd),
    extractFunction(html, 'stripBom'),
    extractFunction(html, 'buildAliasLookup'),
    extractFunction(html, 'getAliasPriority'),
    extractFunction(html, 'getAliasMatch'),
    extractFunction(html, 'normalizeHeader'),
    'const ALIAS_LOOKUP = buildAliasLookup();',
    extractFunction(html, 'mapCsvHeaders'),
    extractFunction(html, 'validateCsvRow'),
    extractFunction(html, 'parseManualDevice'),
    extractFunction(html, 'encodeUtf8'),
    'globalThis.mapCsvHeaders = mapCsvHeaders;',
    'globalThis.validateCsvRow = validateCsvRow;',
    'globalThis.parseManualDevice = parseManualDevice;',
    'globalThis.encodeUtf8 = encodeUtf8;'
  ].join('\n');

  const sandbox = { TextEncoder };
  vm.runInNewContext(script, sandbox, { filename: 'cmdb2label-manual-parser.vm.js' });
  return sandbox;
}

const helpers = createHtmlHelpers();
const parseManualDevice = helpers.parseManualDevice;

test('manual input prefers explicit inventory number over Code in CMDBuild dumps', () => {
  const parsed = parseManualDevice(`Code
C2M-CITY-20260523-ARM-001-01
Description
АРМ 01 для Test City 001
Zabbix hostid cache field
Местоположение
Location room for Test City 001
isDisableMon
isMonitor
Критичность
Очень сильно да
Операционная система
zabbix_main_hostid
13734
Email провайдера
Инв. номер
ГКМ1231455
hostname
c2m-arm-city-001-01
ipaddress
192.168.202.35строки1
mgmt
serialnum
C2M-CITY-20260523-ARM-SN-001-01
Модель
HP / HP 1111
Модель2`);

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.device.inv, 'ГКМ1231455');
  assert.equal(parsed.device.sn, 'C2M-CITY-20260523-ARM-SN-001-01');
  assert.equal(parsed.device.model, 'HP / HP 1111');
});

test('manual input uses Code as inventory fallback when explicit inventory is absent', () => {
  const parsed = parseManualDevice(`Code
C2M-CITY-20260523-ARM-001-01
serialnum
SN-1
Модель
HP 1111`);

  assert.equal(parsed.device.inv, 'C2M-CITY-20260523-ARM-001-01');
  assert.equal(parsed.device.sn, 'SN-1');
  assert.equal(parsed.device.model, 'HP 1111');
});

test('manual input keeps colon syntax and alias priority', () => {
  const parsed = parseManualDevice(`Code: TECH-1
Инв. номер: INV-1
serialnum: SN-1
Модель: HP 1111`);

  assert.equal(parsed.device.inv, 'INV-1');
  assert.equal(parsed.device.sn, 'SN-1');
  assert.equal(parsed.device.model, 'HP 1111');
});

test('CSV headers prefer explicit inventory number over technical Code alias', () => {
  const headerResult = helpers.mapCsvHeaders(['Code', 'Инв. номер', 'serialnum', 'Модель', 'Тип']);
  assert.equal(headerResult.errors.length, 0);
  assert.equal(headerResult.mapping.inv, 1);

  const parsed = helpers.validateCsvRow([
    'C2M-CITY-20260523-ARM-001-01',
    'ГКМ1231455',
    'C2M-CITY-20260523-ARM-SN-001-01',
    'HP / HP 1111',
    'HP'
  ], headerResult.mapping, 2);

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.device.inv, 'ГКМ1231455');
  assert.equal(parsed.device.sn, 'C2M-CITY-20260523-ARM-SN-001-01');
  assert.equal(parsed.device.model, 'HP / HP 1111');
  assert.equal(parsed.device.type, 'HP');
});

test('CSV headers keep legacy group alias as type input', () => {
  const headerResult = helpers.mapCsvHeaders(['Группа модели']);
  const parsed = helpers.validateCsvRow(['HP'], headerResult.mapping, 2);

  assert.equal(headerResult.mapping.type, 0);
  assert.equal(parsed.device.type, 'HP');
});

test('CSV headers prefer explicit type over legacy group and technical type aliases', () => {
  const headerResult = helpers.mapCsvHeaders(['Группа модели', 'Тип', 'type']);
  const parsed = helpers.validateCsvRow(['Legacy', 'Primary', 'Technical'], headerResult.mapping, 2);

  assert.equal(headerResult.mapping.type, 1);
  assert.equal(parsed.device.type, 'Primary');
});

test('QR UTF-8 encoder matches TextEncoder for Russian and English text', () => {
  const text = 'ГКМ1231455 SN ABC';
  assert.deepEqual(Array.from(helpers.encodeUtf8(text)), Array.from(new TextEncoder().encode(text)));
});

test('UI invalidates stale resolve results when input state changes', () => {
  assert.match(html, /let deviceStateRevision = 0;/);
  assert.match(html, /function bumpDeviceStateRevision\(\)/);
  assert.match(html, /if \(!isCurrentDeviceStateRevision\(operationRevision\)\) return;/);
  assert.match(html, /function clearAll\(\)[\s\S]*bumpDeviceStateRevision\(\);/);
});
