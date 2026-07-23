import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLabelConfig } from '../../src/labels-core.mjs';
import { resolveDrafts } from '../../src/server.mjs';

const fixtures = {
  MetadataAsset: {
    serial: 'SN-META',
    card: {
      _id: 1,
      Code: 'INV-META',
      serialnum: 'SN-META',
      model: 101,
      _model_description: 'HP 1111'
    },
    attributes: [
      { name: 'Code', description: 'Инв. номер', type: 'string' },
      { name: 'serialnum', description: 'Серийный номер', type: 'string' },
      { name: 'model', description: 'Модель', type: 'lookup', lookupType: 'ModelMeta' }
    ]
  },
  OverrideAsset: {
    serial: 'SN-OVERRIDE',
    card: {
      _id: 2,
      Code: 'INV-OVERRIDE',
      serialnum: 'SN-OVERRIDE',
      model: 'Dell 2222',
      _model_id: 102,
      _model_description: 'Dell 2222'
    },
    attributes: [
      { name: 'Code', description: 'Инв. номер', type: 'string' },
      { name: 'serialnum', description: 'Серийный номер', type: 'string' },
      { name: 'model', description: 'Модель', type: 'lookup', lookupType: 'WrongModel' }
    ]
  },
  TextAsset: {
    serial: 'SN-TEXT',
    card: {
      _id: 3,
      Code: 'INV-TEXT',
      serialnum: 'SN-TEXT',
      _model_description: 'Lenovo 3333'
    },
    attributes: [
      { name: 'Code', description: 'Инв. номер', type: 'string' },
      { name: 'serialnum', description: 'Серийный номер', type: 'string' },
      { name: 'model', description: 'Модель', type: 'lookup' }
    ]
  },
  MissingParentAsset: {
    serial: 'SN-NO-PARENT',
    card: {
      _id: 4,
      Code: 'INV-NO-PARENT',
      serialnum: 'SN-NO-PARENT',
      model: 104,
      _model_description: 'NoParent 4444'
    },
    attributes: [
      { name: 'Code', description: 'Инв. номер', type: 'string' },
      { name: 'serialnum', description: 'Серийный номер', type: 'string' },
      { name: 'model', description: 'Модель', type: 'lookup', lookupType: 'ModelMissingParent' }
    ]
  },
  ScalarParentAsset: {
    serial: 'SN-SCALAR',
    card: {
      _id: 5,
      Code: 'INV-SCALAR',
      serialnum: 'SN-SCALAR',
      model: 105,
      _model_description: 'Scalar 5555'
    },
    attributes: [
      { name: 'Code', description: 'Инв. номер', type: 'string' },
      { name: 'serialnum', description: 'Серийный номер', type: 'string' },
      { name: 'model', description: 'Модель', type: 'lookup', lookupType: 'ModelScalarParent' }
    ]
  }
};

const lookupValues = {
  ModelMeta: [
    { _id: 101, description: 'HP 1111', parent_type: 'ModelGroup', parent_id: 201 }
  ],
  WrongModel: [
    { _id: 102, description: 'Dell 2222', parent_id: 999 }
  ],
  ModelOverride: [
    { _id: 102, description: 'Dell 2222', parent_id: 202 }
  ],
  ModelText: [
    { _id: 103, description: 'Lenovo 3333', parent_id: 203 }
  ],
  ModelMissingParent: [
    { _id: 104, description: 'NoParent 4444' }
  ],
  ModelScalarParent: [
    { _id: 105, description: 'Scalar 5555', parent: 205 }
  ],
  ModelGroup: [
    { _id: 201, description: 'Printer' },
    { _id: 202, description: 'Server' },
    { _id: 203, description: 'Notebook' },
    { _id: 205, description: 'Workstation' },
    { _id: 999, description: 'Wrong' }
  ]
};

test('resolveDrafts derives type from CMDBuild lookup metadata parent', async () => {
  const result = await resolveDrafts([{ sn: 'SN-META' }], 'auth-meta', mergeLabelConfig(), {
    cmdbuildRequest: fakeCmdbuildRequest
  });

  assert.equal(result.ok, true);
  assert.equal(result.devices[0].model, 'HP 1111');
  assert.equal(result.devices[0].type, 'Printer');
  assert.equal(Object.prototype.hasOwnProperty.call(result.devices[0], 'cls'), false);
});

test('resolveDrafts derives type with explicit lookup type overrides', async () => {
  const result = await resolveDrafts([{ sn: 'SN-OVERRIDE' }], 'auth-override', mergeLabelConfig({
    derivedFields: {
      typeFromModelLookupParent: {
        sourceLookupType: 'ModelOverride',
        parentLookupType: 'ModelGroup'
      }
    }
  }), {
    cmdbuildRequest: fakeCmdbuildRequest
  });

  assert.equal(result.ok, true);
  assert.equal(result.devices[0].model, 'Dell 2222');
  assert.equal(result.devices[0].type, 'Server');
});

test('resolveDrafts preserves explicit type supplied by user input', async () => {
  const result = await resolveDrafts([{ sn: 'SN-META', type: 'Manual' }], 'auth-manual', mergeLabelConfig(), {
    cmdbuildRequest: fakeCmdbuildRequest
  });

  assert.equal(result.ok, true);
  assert.equal(result.devices[0].type, 'Manual');
  assert.equal(result.errors.some((error) => error.field === 'Тип'), false);
});

test('resolveDrafts derives type by lookup display text when card has no lookup id', async () => {
  const result = await resolveDrafts([{ sn: 'SN-TEXT' }], 'auth-text', mergeLabelConfig({
    derivedFields: {
      typeFromModelLookupParent: {
        sourceLookupType: 'ModelText',
        parentLookupType: 'ModelGroup'
      }
    }
  }), {
    cmdbuildRequest: fakeCmdbuildRequest
  });

  assert.equal(result.ok, true);
  assert.equal(result.devices[0].model, 'Lenovo 3333');
  assert.equal(result.devices[0].type, 'Notebook');
});

test('resolveDrafts reports missing type when lookup value has no parent', async () => {
  const result = await resolveDrafts([{ sn: 'SN-NO-PARENT' }], 'auth-no-parent', mergeLabelConfig(), {
    cmdbuildRequest: fakeCmdbuildRequest
  });

  assert.equal(result.ok, false);
  assert.equal(result.devices[0].model, 'NoParent 4444');
  assert.equal(result.devices[0].type, '');
  assert.equal(result.errors.some((error) => error.field === 'Тип'), true);
});

test('resolveDrafts resolves scalar lookup parent id through configured parent type', async () => {
  const result = await resolveDrafts([{ sn: 'SN-SCALAR' }], 'auth-scalar', mergeLabelConfig({
    derivedFields: {
      typeFromModelLookupParent: {
        parentLookupType: 'ModelGroup'
      }
    }
  }), {
    cmdbuildRequest: fakeCmdbuildRequest
  });

  assert.equal(result.ok, true);
  assert.equal(result.devices[0].model, 'Scalar 5555');
  assert.equal(result.devices[0].type, 'Workstation');
});

async function fakeCmdbuildRequest(pathname) {
  const requestUrl = new URL(pathname, 'http://cmdbuild.local');
  const decodedPath = decodeURIComponent(requestUrl.pathname);

  if (decodedPath === '/cmdbuild/services/rest/v3/classes') {
    return ok({
      data: Object.keys(fixtures).map((name) => ({ name, description: name, active: true }))
    });
  }

  const attributesMatch = decodedPath.match(/^\/cmdbuild\/services\/rest\/v3\/classes\/([^/]+)\/attributes$/);
  if (attributesMatch) {
    const fixture = fixtures[attributesMatch[1]];
    return fixture ? ok({ data: fixture.attributes }) : notFound();
  }

  const cardsMatch = decodedPath.match(/^\/cmdbuild\/services\/rest\/v3\/classes\/([^/]+)\/cards$/);
  if (cardsMatch) {
    const fixture = fixtures[cardsMatch[1]];
    const filter = requestUrl.searchParams.get('filter') || '';
    const matchesSerial = fixture && filter.includes(fixture.serial);
    return ok({ data: matchesSerial ? [fixture.card] : [] });
  }

  const lookupMatch = decodedPath.match(/^\/cmdbuild\/services\/rest\/v3\/lookup_types\/([^/]+)\/values$/);
  if (lookupMatch) {
    return ok({ data: lookupValues[lookupMatch[1]] || [] });
  }

  return notFound();
}

function ok(json) {
  return { ok: true, statusCode: 200, headers: {}, body: JSON.stringify(json), json };
}

function notFound() {
  const json = { data: [] };
  return { ok: false, statusCode: 404, headers: {}, body: JSON.stringify(json), json };
}
