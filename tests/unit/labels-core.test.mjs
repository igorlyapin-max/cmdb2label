import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCmdbEqualFilter,
  buildFieldMap,
  buildFieldMetadataMap,
  cleanValue,
  cmdbCardToDevice,
  deviceRequiredErrors,
  mergeAliasConfig,
  mergeDerivedFieldConfig,
  mergeResolvedDevice,
  normalizeDraftDevice,
  parseManualAttributes,
  validateLabelConfig
} from '../../src/labels-core.mjs';

test('parseManualAttributes reads two-line attribute pairs', () => {
  assert.deepEqual(parseManualAttributes('SN\nC2M-CITY-20260523-SN-300'), [
    { name: 'SN', value: 'C2M-CITY-20260523-SN-300' }
  ]);
});

test('parseManualAttributes reads colon pairs', () => {
  assert.deepEqual(parseManualAttributes('Инв. номер: Принтер-001\nSN: SN123'), [
    { name: 'Инв. номер', value: 'Принтер-001' },
    { name: 'SN', value: 'SN123' }
  ]);
});

test('normalizeDraftDevice maps Russian and English aliases', () => {
  const device = normalizeDraftDevice({
    rawFields: [
      { name: 'Инв. номер', value: ' INV-1 ' },
      { name: 'Тип/Модель', value: ' HP LaserJet ' },
      { name: 'Тип', value: ' HP ' },
      { name: 'serialNumber', value: ' SN123 ' }
    ]
  });

  assert.equal(device.inv, 'INV-1');
  assert.equal(device.model, 'HP LaserJet');
  assert.equal(device.type, 'HP');
  assert.equal(device.sn, 'SN123');
});

test('normalizeDraftDevice keeps legacy group alias as type input', () => {
  const device = normalizeDraftDevice({
    rawFields: [
      { name: 'Группа модели', value: ' HP ' }
    ]
  });

  assert.equal(device.type, 'HP');
});

test('normalizeDraftDevice maps direct legacy cls draft field to type', () => {
  const device = normalizeDraftDevice({
    inv: 'INV-1',
    model: 'HP 1111',
    cls: 'Printer',
    sn: 'SN123'
  });

  assert.equal(device.type, 'Printer');
});

test('normalizeDraftDevice maps CMDB CSV headers and does not treat Description as model', () => {
  const device = normalizeDraftDevice({
    rawFields: [
      { name: 'Code', value: ' C2M-CITY-20260523-ARM-001-01 ' },
      { name: 'Description', value: 'АРМ 01 для Test City 001' },
      { name: 'serialnum', value: ' C2M-CITY-20260523-ARM-SN-001-01 ' },
      { name: 'Модель', value: ' HP 1111 ' }
    ]
  });

  assert.equal(device.inv, 'C2M-CITY-20260523-ARM-001-01');
  assert.equal(device.model, 'HP 1111');
  assert.equal(device.type, '');
  assert.equal(device.sn, 'C2M-CITY-20260523-ARM-SN-001-01');
});

test('Description alone is not a model alias for draft input', () => {
  const device = normalizeDraftDevice({
    rawFields: [
      { name: 'Code', value: 'INV-1' },
      { name: 'Description', value: 'Workstation description' },
      { name: 'serialnum', value: 'SN123' }
    ]
  });

  assert.equal(device.model, '');
});

test('mergeAliasConfig keeps defaults and adds configured aliases', () => {
  const aliases = mergeAliasConfig({ aliases: { sn: ['FactorySN'] } });
  assert.ok(aliases.sn.includes('SN'));
  assert.ok(aliases.sn.includes('FactorySN'));
});

test('mergeAliasConfig maps legacy cls aliases into type', () => {
  const aliases = mergeAliasConfig({ aliases: { cls: ['LegacyType'] } });

  assert.ok(aliases.type.includes('LegacyType'));
});

test('mergeDerivedFieldConfig maps legacy groupFromLookupParent rule to type rule', () => {
  const derived = mergeDerivedFieldConfig({
    derivedFields: {
      groupFromLookupParent: {
        sourceField: 'model',
        targetField: 'cls',
        sourceLookupType: 'Model',
        parentLookupType: 'ModelGroup'
      }
    }
  });

  assert.deepEqual(derived.typeFromModelLookupParent, {
    enabled: true,
    modelField: 'model',
    typeField: 'type',
    sourceLookupType: 'Model',
    parentLookupType: 'ModelGroup'
  });
});

test('validateLabelConfig rejects unsupported derived output field and warns on legacy keys', () => {
  const invalid = validateLabelConfig({
    aliases: { cls: ['LegacyType'] },
    derivedFields: {
      groupFromLookupParent: {
        sourceField: 'model',
        targetField: 'customType'
      }
    }
  });

  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors.some((error) => error.code === 'derived_type_field_fixed'), true);
  assert.equal(invalid.warnings.some((warning) => warning.code === 'legacy_aliases_cls'), true);
  assert.equal(invalid.warnings.some((warning) => warning.code === 'legacy_group_from_lookup_parent'), true);
});

test('buildFieldMap matches attribute names and descriptions', () => {
  const aliases = mergeAliasConfig({ aliases: { inv: ['InventoryId'] } });
  const map = buildFieldMap([
    { name: 'InventoryId', description: 'Inventory' },
    { name: 'SerialNumber', description: 'SN' },
    { name: 'ModelName', description: 'Тип/Модель' }
  ], aliases);

  assert.equal(map.inv, 'InventoryId');
  assert.equal(map.sn, 'SerialNumber');
  assert.equal(map.model, 'ModelName');
});

test('buildFieldMetadataMap keeps lookup metadata for model attributes', () => {
  const aliases = mergeAliasConfig();
  const map = buildFieldMetadataMap([
    { name: 'model', description: 'Модель', type: 'lookup', lookupType: 'Model' },
    { name: 'serialnum', description: 'Серийный номер', type: 'string' }
  ], aliases);

  assert.equal(map.model.name, 'model');
  assert.equal(map.model.type, 'lookup');
  assert.equal(map.model.lookupType, 'Model');
  assert.equal(map.sn.name, 'serialnum');
});

test('cmdbCardToDevice uses class description as class fallback', () => {
  const device = cmdbCardToDevice({
    InventoryId: 'INV-1',
    SerialNumber: 'SN123',
    Description: 'HP LaserJet'
  }, {
    name: 'Printer',
    description: 'Принтер'
  }, {
    inv: 'InventoryId',
    sn: 'SerialNumber'
  });

  assert.deepEqual(device, {
    inv: 'INV-1',
    model: 'HP LaserJet',
    type: 'Принтер',
    sn: 'SN123'
  });
});

test('cmdbCardToDevice uses lookup display values and can leave type empty for derivation', () => {
  const device = cmdbCardToDevice({
    Code: 'INV-1',
    serialnum: 'SN123',
    model: 12347947,
    _model_description: 'HP 1111'
  }, {
    name: 'ARM',
    description: 'АРМ'
  }, {
    inv: 'Code',
    sn: 'serialnum',
    model: 'model'
  }, {
    classFallbackForType: false
  });

  assert.deepEqual(device, {
    inv: 'INV-1',
    model: 'HP 1111',
    type: '',
    sn: 'SN123'
  });
});

test('mergeResolvedDevice preserves user-entered values over CMDB values', () => {
  assert.deepEqual(mergeResolvedDevice({
    sn: 'SN123',
    model: 'Manual Model'
  }, {
    inv: 'INV-1',
    model: 'CMDB Model',
    type: 'Printer',
    sn: 'SN123'
  }), {
    inv: 'INV-1',
    model: 'Manual Model',
    type: 'Printer',
    sn: 'SN123'
  });
});

test('deviceRequiredErrors reports missing label fields', () => {
  const errors = deviceRequiredErrors({ inv: 'INV-1', sn: 'SN123' }, 3);
  assert.deepEqual(errors.map((error) => [error.row, error.field]), [
    [3, 'Тип/Модель'],
    [3, 'Тип']
  ]);
});

test('buildCmdbEqualFilter builds CMDBuild simple equal filter', () => {
  assert.deepEqual(buildCmdbEqualFilter('SerialNumber', 'SN123'), {
    attribute: {
      simple: {
        attribute: 'SerialNumber',
        operator: 'equal',
        value: ['SN123']
      }
    }
  });
});

test('cleanValue trims null-safe values', () => {
  assert.equal(cleanValue(null), '');
  assert.equal(cleanValue(' x '), 'x');
});
