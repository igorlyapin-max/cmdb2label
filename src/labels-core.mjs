export const REQUIRED_FIELDS = ['inv', 'model', 'cls', 'sn'];

export const FIELD_LABELS = {
  inv: 'Инв. номер',
  model: 'Тип/Модель',
  cls: 'Группа модели',
  sn: 'Серийный номер'
};

export const DEFAULT_FIELD_ALIASES = {
  inv: [
    'Инв. номер',
    'Инвентарный номер',
    'Инв номер',
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
    'Model',
    'model',
    'typeModel',
    'deviceModel'
  ],
  cls: [
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
    'серийный'
  ]
};

export const DEFAULT_DERIVED_FIELDS = {
  groupFromLookupParent: {
    enabled: true,
    sourceField: 'model',
    targetField: 'cls'
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

export function mergeAliasConfig(config = {}) {
  const result = {};
  for (const field of REQUIRED_FIELDS) {
    const configured = config.aliases && Array.isArray(config.aliases[field]) ? config.aliases[field] : [];
    result[field] = uniqueStrings([...DEFAULT_FIELD_ALIASES[field], ...configured]);
  }
  return result;
}

export function mergeDerivedFieldConfig(config = {}) {
  const configured = config.derivedFields || {};
  const configuredRule = configured.groupFromLookupParent || {};
  return {
    groupFromLookupParent: {
      ...DEFAULT_DERIVED_FIELDS.groupFromLookupParent,
      ...configuredRule,
      enabled: configuredRule.enabled === undefined ? DEFAULT_DERIVED_FIELDS.groupFromLookupParent.enabled : Boolean(configuredRule.enabled)
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

  const rawFields = Array.isArray(input.rawFields) ? input.rawFields : [];
  for (const item of rawFields) {
    const field = aliasLookup[normalizeAlias(item && item.name)];
    if (field && !device[field]) device[field] = cleanValue(item && item.value);
  }

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
  const aliasLookup = buildAliasLookup(aliases);
  const result = {};

  for (const attribute of attributes) {
    const attrName = attribute && (attribute.name || attribute.code);
    const names = [
      attrName,
      attribute && attribute.code,
      attribute && attribute.description,
      attribute && attribute._description
    ];

    for (const name of names) {
      const field = aliasLookup[normalizeAlias(name)];
      if (field && !result[field]) {
        result[field] = {
          name: attrName || name,
          code: attribute && attribute.code,
          description: attribute && (attribute.description || attribute._description || ''),
          type: attribute && attribute.type,
          lookupType: attribute && (attribute.lookupType || attribute.lookup_type || attribute._lookupType),
          raw: attribute
        };
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
    classFallbackForCls: true,
    ...options
  };
  const device = {};
  for (const field of REQUIRED_FIELDS) {
    const attrName = fieldMapAttributeName(fieldMap, field);
    device[field] = attrName ? displayCmdbFieldValue(card, attrName) : '';
  }

  if (!device.model) device.model = displayCmdbValue(card.Description || card._description);
  if (!device.cls && settings.classFallbackForCls) {
    device.cls = displayCmdbValue(card._type || classInfo.description || classInfo.name);
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
