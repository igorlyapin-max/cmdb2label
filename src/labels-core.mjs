export const REQUIRED_FIELDS = ['inv', 'model', 'type', 'sn'];

export const FIELD_LABELS = {
  inv: 'Инв. номер',
  model: 'Тип/Модель',
  type: 'Тип',
  sn: 'Серийный номер'
};

export const DEFAULT_FIELD_ALIASES = {
  inv: [
    'Инв. номер',
    'Инвентарный номер',
    'Инв номер',
    'InventoryId',
    'AssetInventoryNumber',
    'AssetInventoryNo',
    'Code',
    'code',
    'invnet',
    'inventory',
    'inventoryNumber',
    'inventoryNo',
    'inv',
    'invNumber',
    'assetTag',
    'assetNumber'
  ],
  model: [
    'Тип/Модель',
    'Тип / Модель',
    'Тип модель',
    'Модель',
    'ModelName',
    'Model',
    'model',
    'typeModel',
    'deviceModel'
  ],
  type: [
    'Тип',
    'Группа модели',
    'Группа',
    'Производитель',
    'Класс',
    'class',
    'cls',
    'type',
    'category',
    '_type',
    'Class'
  ],
  sn: [
    'SN',
    'S/N',
    'Серийный номер',
    'serial',
    'serialnum',
    'SerialNum',
    'serialNumber',
    'serialNo',
    'serial_num',
    'FactorySN',
    'Заводской номер',
    'серийный'
  ]
};

export const DEFAULT_ALIAS_PRIORITIES = {
  inv: {
    'Инв. номер': 100,
    'Инвентарный номер': 100,
    'Инв номер': 95,
    InventoryId: 95,
    AssetInventoryNumber: 95,
    AssetInventoryNo: 95,
    invnet: 80,
    inventoryNumber: 80,
    inventoryNo: 80,
    invNumber: 80,
    assetTag: 80,
    assetNumber: 80,
    inventory: 70,
    inv: 60,
    Code: 10,
    code: 10
  },
  model: {
    'Модель': 100,
    ModelName: 95,
    'Тип/Модель': 90,
    'Тип / Модель': 90,
    'Тип модель': 90,
    model: 80,
    Model: 80,
    typeModel: 70,
    deviceModel: 70
  },
  type: {
    'Тип': 100,
    ModelGroup: 95,
    'Группа модели': 90,
    'Группа': 90,
    'Производитель': 80,
    Class: 30,
    'Класс': 20,
    class: 20,
    cls: 20,
    _type: 20,
    type: 20,
    category: 20
  },
  sn: {
    SN: 100,
    'S/N': 100,
    'Серийный номер': 100,
    SerialNumber: 95,
    serialNumber: 95,
    FactorySN: 95,
    'Заводской номер': 90,
    serialnum: 85,
    SerialNum: 85,
    serialNo: 85,
    serial_num: 85,
    serial: 80,
    'серийный': 80
  }
};

export const DEFAULT_DERIVED_FIELDS = {
  typeFromModelLookupParent: {
    enabled: true,
    modelField: 'model',
    typeField: 'type',
    sourceLookupType: '',
    parentLookupType: ''
  }
};

export function normalizeAlias(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[№#]/g, '')
    .replace(/[\s._\-\\/():;]+/g, '');
}

export function isHierarchicalModelDisplayName(name) {
  const normalized = normalizeAlias(name);
  return ['типмодель'].includes(normalized);
}

export function splitHierarchicalModelDisplay(value) {
  const parts = String(value || '')
    .split('/')
    .map((part) => cleanValue(part))
    .filter(Boolean);
  if (parts.length < 2) return null;
  return {
    type: parts[0],
    model: parts.slice(1).join(' / ')
  };
}

export function mergeAliasConfig(config = {}) {
  const result = {};
  const aliases = config.aliases && typeof config.aliases === 'object' && !Array.isArray(config.aliases)
    ? config.aliases
    : {};
  for (const field of REQUIRED_FIELDS) {
    const configured = aliases && Array.isArray(aliases[field]) ? aliases[field] : [];
    const legacyConfigured = field === 'type' && Array.isArray(aliases.cls) ? aliases.cls : [];
    result[field] = uniqueStrings([...DEFAULT_FIELD_ALIASES[field], ...legacyConfigured, ...configured]);
  }
  return result;
}

function normalizeDerivedRule(rule = {}) {
  const result = { ...rule };
  if (!result.modelField && result.sourceField) result.modelField = result.sourceField;
  if (!result.typeField && result.targetField) result.typeField = result.targetField;
  if (result.typeField === 'cls') result.typeField = 'type';
  delete result.sourceField;
  delete result.targetField;
  return result;
}

export function validateLabelConfig(config = {}) {
  const errors = [];
  const warnings = [];
  const addError = (code, path, message) => errors.push({ code, path, message });
  const addWarning = (code, path, message) => warnings.push({ code, path, message });

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    addError('alias_config_object_required', '', 'Alias config must be a JSON object.');
    return { ok: false, errors, warnings };
  }

  const aliases = config.aliases;
  if (aliases !== undefined) {
    if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) {
      addError('aliases_object_required', 'aliases', 'aliases must be an object.');
    } else {
      for (const [name, value] of Object.entries(aliases)) {
        if (!Array.isArray(value)) addError('alias_array_required', `aliases.${name}`, 'Alias config entries must be arrays.');
      }
      if (Array.isArray(aliases.cls)) {
        addWarning('legacy_aliases_cls', 'aliases.cls', 'aliases.cls is deprecated; use aliases.type.');
      }
    }
  }

  const derivedFields = config.derivedFields;
  if (derivedFields !== undefined) {
    if (!derivedFields || typeof derivedFields !== 'object' || Array.isArray(derivedFields)) {
      addError('derived_fields_object_required', 'derivedFields', 'derivedFields must be an object.');
    } else {
      if (derivedFields.groupFromLookupParent) {
        addWarning('legacy_group_from_lookup_parent', 'derivedFields.groupFromLookupParent', 'groupFromLookupParent is deprecated; use typeFromModelLookupParent.');
      }
      const rule = normalizeDerivedRule(derivedFields.typeFromModelLookupParent || derivedFields.groupFromLookupParent || {});
      if (rule && typeof rule === 'object' && !Array.isArray(rule)) {
        for (const name of ['modelField', 'typeField', 'sourceLookupType', 'parentLookupType']) {
          if (rule[name] !== undefined && typeof rule[name] !== 'string') {
            addError('derived_field_string_required', `derivedFields.typeFromModelLookupParent.${name}`, `${name} must be a string.`);
          }
        }
        const typeField = cleanValue(rule.typeField || DEFAULT_DERIVED_FIELDS.typeFromModelLookupParent.typeField);
        if (typeField && typeField !== 'type') {
          addError('derived_type_field_fixed', 'derivedFields.typeFromModelLookupParent.typeField', 'typeField must be "type".');
        }
      } else {
        addError('derived_rule_object_required', 'derivedFields.typeFromModelLookupParent', 'typeFromModelLookupParent must be an object.');
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function mergeDerivedFieldConfig(config = {}) {
  const configured = config.derivedFields && typeof config.derivedFields === 'object' && !Array.isArray(config.derivedFields)
    ? config.derivedFields
    : {};
  const legacyRule = normalizeDerivedRule(configured.groupFromLookupParent || {});
  const configuredRule = normalizeDerivedRule(configured.typeFromModelLookupParent || legacyRule);
  return {
    typeFromModelLookupParent: {
      ...DEFAULT_DERIVED_FIELDS.typeFromModelLookupParent,
      ...configuredRule,
      typeField: configuredRule.typeField ? configuredRule.typeField : DEFAULT_DERIVED_FIELDS.typeFromModelLookupParent.typeField,
      enabled: configuredRule.enabled === undefined ? DEFAULT_DERIVED_FIELDS.typeFromModelLookupParent.enabled : Boolean(configuredRule.enabled)
    }
  };
}

export function mergeLabelConfig(config = {}) {
  return {
    aliases: mergeAliasConfig(config),
    derivedFields: mergeDerivedFieldConfig(config)
  };
}

export function buildAliasLookup(aliases = DEFAULT_FIELD_ALIASES) {
  const lookup = {};
  for (const field of REQUIRED_FIELDS) {
    for (const alias of aliases[field] || []) {
      const normalized = normalizeAlias(alias);
      if (normalized && !lookup[normalized]) lookup[normalized] = field;
    }
  }
  return lookup;
}

export function buildAliasPriorityLookup(aliases = DEFAULT_FIELD_ALIASES) {
  const lookup = {};
  for (const field of REQUIRED_FIELDS) {
    const defaults = DEFAULT_FIELD_ALIASES[field] || [];
    const priorities = DEFAULT_ALIAS_PRIORITIES[field] || {};
    const aliasesForField = aliases[field] || [];
    aliasesForField.forEach((alias, index) => {
      const normalized = normalizeAlias(alias);
      if (!normalized) return;
      const isDefault = defaults.some((defaultAlias) => normalizeAlias(defaultAlias) === normalized);
      const priority = isDefault
        ? getDefaultAliasPriority(field, alias)
        : 200 + aliasesForField.length - index;
      if (!lookup[normalized] || priority > lookup[normalized].priority) {
        lookup[normalized] = { field, priority };
      }
    });
  }
  return lookup;
}

function getDefaultAliasPriority(field, alias) {
  const priorities = DEFAULT_ALIAS_PRIORITIES[field] || {};
  if (Object.prototype.hasOwnProperty.call(priorities, alias)) return priorities[alias];
  const normalized = normalizeAlias(alias);
  for (const [name, priority] of Object.entries(priorities)) {
    if (normalizeAlias(name) === normalized) return priority;
  }
  return 50;
}

export function parseManualAttributes(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const fields = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const separator = line.indexOf(':');
    if (separator > 0) {
      const name = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (name || value) fields.push({ name, value });
      continue;
    }

    const name = line;
    const value = lines[index + 1] || '';
    fields.push({ name, value });
    index += 1;
  }

  return fields;
}

export function normalizeDraftDevice(input = {}, aliases = DEFAULT_FIELD_ALIASES) {
  const aliasLookup = buildAliasLookup(aliases);
  const device = {};
  for (const field of REQUIRED_FIELDS) {
    device[field] = cleanValue(input[field]);
  }
  if (!device.type) device.type = cleanValue(input.cls);

  const rawFields = Array.isArray(input.rawFields) ? input.rawFields : [];
  let pendingHierarchicalType = '';
  for (const item of rawFields) {
    const field = aliasLookup[normalizeAlias(item && item.name)];
    const value = cleanValue(item && item.value);
    if (field === 'model' && value && isHierarchicalModelDisplayName(item && item.name)) {
      const split = splitHierarchicalModelDisplay(value);
      if (split) {
        if (!pendingHierarchicalType) pendingHierarchicalType = split.type;
        if (!device.model) device.model = split.model;
        continue;
      }
    }
    if (field && !device[field]) device[field] = value;
  }
  if (!device.type && pendingHierarchicalType) device.type = pendingHierarchicalType;

  return {
    ...device,
    source: cleanValue(input.source),
    row: input.row === undefined ? '' : input.row
  };
}

export function buildFieldMap(attributes = [], aliases = DEFAULT_FIELD_ALIASES) {
  const metadataMap = buildFieldMetadataMap(attributes, aliases);
  const result = {};
  for (const field of REQUIRED_FIELDS) {
    if (metadataMap[field] && metadataMap[field].name) result[field] = metadataMap[field].name;
  }
  return result;
}

export function buildFieldMetadataMap(attributes = [], aliases = DEFAULT_FIELD_ALIASES) {
  const aliasLookup = buildAliasPriorityLookup(aliases);
  const result = {};
  const scores = {};

  for (const attribute of attributes) {
    const attrName = attribute && (attribute.name || attribute.code);
    const candidates = [
      { name: attrName, weight: 100 },
      { name: attribute && attribute.code, weight: 100 },
      { name: attribute && attribute.description, weight: 0 },
      { name: attribute && attribute._description, weight: 0 }
    ];

    for (const candidate of candidates) {
      const match = aliasLookup[normalizeAlias(candidate.name)];
      if (match && (!result[match.field] || match.priority + candidate.weight > scores[match.field])) {
        const field = match.field;
        result[field] = {
          name: attrName || candidate.name,
          code: attribute && attribute.code,
          description: attribute && (attribute.description || attribute._description || ''),
          type: attribute && attribute.type,
          lookupType: attribute && (attribute.lookupType || attribute.lookup_type || attribute._lookupType),
          raw: attribute
        };
        scores[field] = match.priority + candidate.weight;
      }
    }
  }

  return result;
}

export function deviceRequiredErrors(device, rowLabel) {
  return REQUIRED_FIELDS
    .filter((field) => !cleanValue(device && device[field]))
    .map((field) => ({
      row: rowLabel,
      field: FIELD_LABELS[field],
      message: 'Поле не может быть пустым'
    }));
}

export function hasLookupKey(device) {
  return Boolean(cleanValue(device && device.inv) || cleanValue(device && device.sn));
}

export function isCompleteDevice(device) {
  return REQUIRED_FIELDS.every((field) => cleanValue(device && device[field]));
}

export function mergeResolvedDevice(inputDevice, resolvedDevice) {
  const result = {};
  for (const field of REQUIRED_FIELDS) {
    result[field] = cleanValue(inputDevice && inputDevice[field]) || cleanValue(resolvedDevice && resolvedDevice[field]);
  }
  return result;
}

export function cmdbCardToDevice(card = {}, classInfo = {}, fieldMap = {}, options = {}) {
  const settings = {
    classFallbackForType: true,
    ...options
  };
  const device = {};
  for (const field of REQUIRED_FIELDS) {
    const attrName = fieldMapAttributeName(fieldMap, field);
    device[field] = attrName ? displayCmdbFieldValue(card, attrName) : '';
  }

  if (!device.model) device.model = displayCmdbValue(card.Description || card._description);
  if (!device.type && settings.classFallbackForType) {
    device.type = displayCmdbValue(card._type || classInfo.description || classInfo.name);
  }

  return device;
}

export function fieldMapAttributeName(fieldMap = {}, field) {
  const entry = fieldMap && fieldMap[field];
  if (!entry) return '';
  if (typeof entry === 'object') return cleanValue(entry.name || entry.code);
  return cleanValue(entry);
}

export function displayCmdbFieldValue(card = {}, attrName) {
  const name = cleanValue(attrName);
  if (!name) return '';

  const candidates = [
    card[`_${name}_description`],
    card[`_${name}_description_translation`],
    card[`_${name}_code`],
    card[`_${name}_details`],
    card[name]
  ];

  for (const value of candidates) {
    const text = displayCmdbValue(value);
    if (text) return text;
  }

  return '';
}

export function buildCmdbEqualFilter(attribute, value) {
  return {
    attribute: {
      simple: {
        attribute,
        operator: 'equal',
        value: [String(value)]
      }
    }
  };
}

export function extractCmdbData(json) {
  if (json && Array.isArray(json.data)) return json.data;
  if (Array.isArray(json)) return json;
  return [];
}

export function cleanValue(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

export function displayCmdbValue(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) {
    return value.map(displayCmdbValue).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    return cleanValue(
      value.description ||
      value._description ||
      value.Description ||
      value.code ||
      value.Code ||
      value.name ||
      value._id
    );
  }
  return cleanValue(value);
}

export function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const text = cleanValue(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}
