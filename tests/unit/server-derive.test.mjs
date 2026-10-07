import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLabelConfig } from '../../src/labels-core.mjs';
import { filterClassesByRoot, resolveDrafts } from '../../src/server.mjs';

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
  },
  ExternalAsset: {
    serial: 'SN-EXTERNAL',
    card: {
      _id: 6,
      Code: 'INV-EXTERNAL',
      serialnum: 'SN-EXTERNAL',
      model: 101,
      _model_description: 'HP 1111'
    },
    attributes: [
      { name: 'Code', description: 'Инв. номер', type: 'string' },
      { name: 'serialnum', description: 'Серийный номер', type: 'string' },
      { name: 'model', description: 'Модель', type: 'lookup', lookupType: 'ModelMeta' }
    ]
  },
  CustomerInventoryAsset: {
    serial: 'CNDDJSTGFT',
    inventory: '7700010000160724',
    card: {
      _id: 7,
      Code: 'TECH-CODE-CUSTOMER-ASSET',
      InventoryId: '7700010000160724',
      SerialNumber: 'CNDDJSTGFT',
      ModelName: 101,
      _ModelName_description: 'HPE Aruba IAP-207'
    },
    attributes: [
      { name: 'Code', description: 'Code', type: 'string' },
      { name: 'InventoryId', description: 'Инвентарный номер', type: 'string' },
      { name: 'SerialNumber', description: 'Серийный номер', type: 'string' },
      { name: 'ModelName', description: 'Модель', type: 'lookup', lookupType: 'ModelMeta' }
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

test('resolveDrafts enriches CSV row with only customer inventory number', async () => {
  const result = await resolveDrafts([{ inv: '7700010000160724' }], 'auth-customer-inv', mergeLabelConfig(), {
    classRootPath: '',
    cmdbuildRequest: fakeCmdbuildRequest
  });

  assert.equal(result.ok, true);
  assert.equal(result.devices[0].inv, '7700010000160724');
  assert.equal(result.devices[0].sn, 'CNDDJSTGFT');
  assert.equal(result.devices[0].model, 'HPE Aruba IAP-207');
  assert.equal(result.devices[0].type, 'Printer');
});

test('resolveDrafts preserves entered inventory and serial while enriching model and type', async () => {
  const result = await resolveDrafts([{
    inv: '7700010000160724',
    sn: 'CNDDJSTGFT'
  }], 'auth-customer-inv-sn', mergeLabelConfig(), {
    classRootPath: '',
    cmdbuildRequest: fakeCmdbuildRequest
  });

  assert.equal(result.ok, true);
  assert.equal(result.devices[0].inv, '7700010000160724');
  assert.equal(result.devices[0].sn, 'CNDDJSTGFT');
  assert.equal(result.devices[0].model, 'HPE Aruba IAP-207');
  assert.equal(result.devices[0].type, 'Printer');
});

test('resolveDrafts enriches ambiguous single-column serial lookup key without using it as inventory', async () => {
  const result = await resolveDrafts([{ lookupKey: 'CNDDJSTGFT' }], 'auth-customer-lookup-sn', mergeLabelConfig(), {
    classRootPath: '',
    cmdbuildRequest: fakeCmdbuildRequest
  });

  assert.equal(result.ok, true);
  assert.equal(result.devices[0].inv, '7700010000160724');
  assert.equal(result.devices[0].sn, 'CNDDJSTGFT');
  assert.equal(result.devices[0].model, 'HPE Aruba IAP-207');
  assert.equal(result.devices[0].type, 'Printer');
  assert.notEqual(result.devices[0].inv, 'CNDDJSTGFT');
});

test('resolveDrafts enriches ambiguous single-column inventory lookup key', async () => {
  const result = await resolveDrafts([{ lookupKey: '7700010000160724' }], 'auth-customer-lookup-inv', mergeLabelConfig(), {
    classRootPath: '',
    cmdbuildRequest: fakeCmdbuildRequest
  });

  assert.equal(result.ok, true);
  assert.equal(result.devices[0].inv, '7700010000160724');
  assert.equal(result.devices[0].sn, 'CNDDJSTGFT');
  assert.equal(result.devices[0].model, 'HPE Aruba IAP-207');
  assert.equal(result.devices[0].type, 'Printer');
});

test('filterClassesByRoot keeps root and descendant classes only', () => {
  const classes = [
    { name: 'ZabbixMonitoring', description: 'Root' },
    { name: 'MetadataAsset', parent_name: 'ZabbixMonitoring' },
    { name: 'NestedAsset', parent: { name: 'MetadataAsset' } },
    { name: 'ExternalAsset' }
  ];

  assert.deepEqual(filterClassesByRoot(classes, '/classes/ZabbixMonitoring').map((item) => item.name), [
    'ZabbixMonitoring',
    'MetadataAsset',
    'NestedAsset'
  ]);
});

test('filterClassesByRoot supports documented CMDBuild parent metadata shapes', () => {
  const classes = [
    { name: 'ZabbixMonitoring' },
    { name: 'ParentScalar', parent: 'ZabbixMonitoring' },
    { name: 'ParentObject', parent: { name: 'ZabbixMonitoring' } },
    { name: 'PrivateParent', _parent: { code: 'ZabbixMonitoring' } },
    { name: 'ParentName', parentName: 'ZabbixMonitoring' },
    { name: 'Superclass', superclass: 'ZabbixMonitoring' },
    { name: 'SuperClass', superClass: { name: 'ZabbixMonitoring' } },
    { name: 'PrivateSuperclass', _superclass: 'ZabbixMonitoring' },
    { name: 'AncestorsArray', ancestors: [{ name: 'Root' }, { name: 'ZabbixMonitoring' }] },
    { name: 'ExternalAsset' }
  ];

  assert.deepEqual(filterClassesByRoot(classes, '/classes/ZabbixMonitoring').map((item) => item.name), [
    'ZabbixMonitoring',
    'ParentScalar',
    'ParentObject',
    'PrivateParent',
    'ParentName',
    'Superclass',
    'SuperClass',
    'PrivateSuperclass',
    'AncestorsArray'
  ]);
});

test('filterClassesByRoot does not treat parent description as class identifier', () => {
  const classes = [
    { name: 'ZabbixMonitoring', description: 'Zabbix Monitoring' },
    { name: 'DisplayOnlyParent', parent: { description: 'Zabbix Monitoring' } }
  ];

  assert.deepEqual(filterClassesByRoot(classes, '/classes/ZabbixMonitoring').map((item) => item.name), [
    'ZabbixMonitoring'
  ]);
});

test('resolveDrafts limits class discovery to configured root subtree', async () => {
  const calls = [];
  const result = await resolveDrafts([{ sn: 'SN-META' }], 'auth-root', mergeLabelConfig(), {
    classRootPath: '/classes/ZabbixMonitoring',
    cmdbuildRequest: recordingCmdbuildRequest(calls)
  });

  assert.equal(result.ok, true);
  assert.equal(result.devices[0].model, 'HP 1111');
  assert.equal(calls.some((pathname) => pathname.includes('/classes/MetadataAsset/attributes')), true);
  assert.equal(calls.some((pathname) => pathname.includes('/classes/ExternalAsset/attributes')), false);
});

test('resolveDrafts loads exact root class when it is absent from classes page', async () => {
  const calls = [];
  const result = await resolveDrafts([{ sn: 'SN-META' }], 'auth-root-endpoint', mergeLabelConfig(), {
    classRootPath: '/classes/ZabbixMonitoring',
    cmdbuildRequest: recordingCmdbuildRequest(calls, rootEndpointCmdbuildRequest)
  });

  assert.equal(result.ok, true);
  assert.equal(calls.some((pathname) => pathname.includes('/classes/ZabbixMonitoring')), true);
  assert.equal(calls.some((pathname) => pathname.includes('/classes/MetadataAsset/attributes')), true);
});

test('resolveDrafts does not scan attributes when configured root is unavailable', async () => {
  const calls = [];
  const result = await resolveDrafts([{ sn: 'SN-META' }], 'auth-missing-root', mergeLabelConfig(), {
    classRootPath: '/classes/MissingRoot',
    cmdbuildRequest: recordingCmdbuildRequest(calls)
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.field === 'CMDBuild'), true);
  assert.equal(calls.some((pathname) => pathname.includes('/attributes')), false);
});

test('resolveDrafts keeps separate catalog cache entries per class root', async () => {
  const calls = [];
  const request = recordingCmdbuildRequest(calls, splitRootCmdbuildRequest);

  const rootA = await resolveDrafts([{ sn: 'SN-A' }], 'auth-cache-root', mergeLabelConfig(), {
    classRootPath: '/classes/RootA',
    cmdbuildRequest: request
  });
  const rootB = await resolveDrafts([{ sn: 'SN-B' }], 'auth-cache-root', mergeLabelConfig(), {
    classRootPath: '/classes/RootB',
    cmdbuildRequest: request
  });

  assert.equal(rootA.ok, true);
  assert.equal(rootA.devices[0]._sourceClass, 'AssetA');
  assert.equal(rootB.ok, true);
  assert.equal(rootB.devices[0]._sourceClass, 'AssetB');
  assert.equal(calls.filter((pathname) => pathname.includes('/classes?')).length, 2);
});

test('resolveDrafts classRootPath empty override scans all classes from env-root module', async () => {
  const previous = process.env.CMDB_LABELS_CLASS_ROOT_PATH;
  process.env.CMDB_LABELS_CLASS_ROOT_PATH = '/classes/ZabbixMonitoring';
  try {
    const moduleUrl = new URL(`../../src/server.mjs?empty-root-${Date.now()}`, import.meta.url);
    const serverModule = await import(moduleUrl.href);
    const result = await serverModule.resolveDrafts([{ sn: 'SN-EXTERNAL' }], 'auth-empty-root', mergeLabelConfig(), {
      classRootPath: '',
      cmdbuildRequest: fakeCmdbuildRequest
    });

    assert.equal(result.ok, true);
    assert.equal(result.devices[0]._sourceClass, 'ExternalAsset');
  } finally {
    if (previous === undefined) delete process.env.CMDB_LABELS_CLASS_ROOT_PATH;
    else process.env.CMDB_LABELS_CLASS_ROOT_PATH = previous;
  }
});

test('resolveDrafts uses env class root by default and preserves inherited attributes', async () => {
  const previous = process.env.CMDB_LABELS_CLASS_ROOT_PATH;
  process.env.CMDB_LABELS_CLASS_ROOT_PATH = '/classes/ZabbixMonitoring';
  try {
    const moduleUrl = new URL(`../../src/server.mjs?env-root-default-${Date.now()}`, import.meta.url);
    const serverModule = await import(moduleUrl.href);
    const result = await serverModule.resolveDrafts([{ sn: 'SN-INHERITED' }], 'auth-env-root-default', mergeLabelConfig(), {
      cmdbuildRequest: inheritedAttributesCmdbuildRequest
    });

    assert.equal(result.ok, true);
    assert.equal(result.devices[0]._sourceClass, 'CustomerDevice');
    assert.equal(result.devices[0].sn, 'SN-INHERITED');
  } finally {
    if (previous === undefined) delete process.env.CMDB_LABELS_CLASS_ROOT_PATH;
    else process.env.CMDB_LABELS_CLASS_ROOT_PATH = previous;
  }
});

test('resolveDrafts searches child class by inherited superclass serial attribute', async () => {
  const calls = [];
  const result = await resolveDrafts([{ sn: 'SN-INHERITED' }], 'auth-inherited-sn', mergeLabelConfig(), {
    classRootPath: '/classes/ZabbixMonitoring',
    cmdbuildRequest: recordingCmdbuildRequest(calls, inheritedAttributesCmdbuildRequest)
  });

  assert.equal(result.ok, true);
  assert.equal(result.devices[0]._sourceClass, 'CustomerDevice');
  assert.equal(result.devices[0].sn, 'SN-INHERITED');
  assert.equal(result.devices[0].model, 'HP 1111');
  assert.equal(result.devices[0].type, 'Printer');
  assert.equal(calls.some((pathname) => {
    const requestUrl = new URL(pathname, 'http://cmdbuild.local');
    return decodeURIComponent(requestUrl.pathname).endsWith('/classes/CustomerDevice/cards') &&
      (requestUrl.searchParams.get('filter') || '').includes('"attribute":"sn"');
  }), true);
  assert.equal(calls.some((pathname) => {
    const requestUrl = new URL(pathname, 'http://cmdbuild.local');
    return decodeURIComponent(requestUrl.pathname).endsWith('/classes/CustomerDevice/cards') &&
      (requestUrl.searchParams.get('filter') || '').includes('brlSN');
  }), false);
});

test('resolveDrafts uses detailed class metadata when class list omits superclass', async () => {
  const calls = [];
  const result = await resolveDrafts([{ sn: 'SN-DETAIL' }], 'auth-detail-inherited-sn', mergeLabelConfig(), {
    classRootPath: '/classes/ZabbixMonitoring',
    cmdbuildRequest: recordingCmdbuildRequest(calls, inheritedAttributesCmdbuildRequest)
  });

  assert.equal(result.ok, true);
  assert.equal(result.devices[0]._sourceClass, 'DetailOnlyChildDevice');
  assert.equal(result.devices[0].sn, 'SN-DETAIL');
  assert.equal(result.devices[0].model, 'HP 1111');
  assert.equal(result.devices[0].type, 'Printer');
  assert.equal(calls.some((pathname) => decodeURIComponent(new URL(pathname, 'http://cmdbuild.local').pathname).endsWith('/classes/DetailOnlyChildDevice')), true);
  assert.equal(calls.some((pathname) => {
    const requestUrl = new URL(pathname, 'http://cmdbuild.local');
    return decodeURIComponent(requestUrl.pathname).endsWith('/classes/DetailOnlyChildDevice/cards') &&
      (requestUrl.searchParams.get('filter') || '').includes('"attribute":"sn"');
  }), true);
});

test('resolveDrafts uses detail metadata when list parent has display description only', async () => {
  const calls = [];
  const result = await resolveDrafts([{ sn: 'SN-DESCRIPTION-PARENT' }], 'auth-description-parent', mergeLabelConfig(), {
    classRootPath: '/classes/ZabbixMonitoring',
    cmdbuildRequest: recordingCmdbuildRequest(calls, inheritedAttributesCmdbuildRequest)
  });

  assert.equal(result.ok, true);
  assert.equal(result.devices[0]._sourceClass, 'DescriptionParentChildDevice');
  assert.equal(result.devices[0].sn, 'SN-DESCRIPTION-PARENT');
  assert.equal(result.devices[0].model, 'HP 1111');
  assert.equal(result.devices[0].type, 'Printer');
  assert.equal(calls.some((pathname) => decodeURIComponent(new URL(pathname, 'http://cmdbuild.local').pathname).endsWith('/classes/DescriptionParentChildDevice')), true);
});

test('resolveDrafts keeps large rooted catalog within default REST budget', async () => {
  const result = await resolveDrafts([{ sn: 'SN-LARGE-120' }], 'auth-large-catalog', mergeLabelConfig(), {
    classRootPath: '/classes/ZabbixMonitoring',
    cmdbuildRequest: largeCatalogCmdbuildRequest
  });

  assert.equal(result.ok, true);
  assert.equal(result.devices[0]._sourceClass, 'LargeDevice120');
  assert.equal(result.devices[0].sn, 'SN-LARGE-120');
  assert.ok(result.meta.cmdbuildRestCalls > 610);
  assert.ok(result.meta.cmdbuildRestCalls < 1010);
});

test('resolveDrafts lets child serial attribute override inherited serial attribute', async () => {
  const calls = [];
  const result = await resolveDrafts([{ sn: 'SN-CHILD' }], 'auth-child-sn', mergeLabelConfig(), {
    classRootPath: '/classes/ZabbixMonitoring',
    cmdbuildRequest: recordingCmdbuildRequest(calls, inheritedAttributesCmdbuildRequest)
  });

  assert.equal(result.ok, true);
  assert.equal(result.devices[0]._sourceClass, 'ChildOverrideDevice');
  assert.equal(result.devices[0].sn, 'SN-CHILD');
  assert.equal(calls.some((pathname) => {
    const requestUrl = new URL(pathname, 'http://cmdbuild.local');
    return decodeURIComponent(requestUrl.pathname).endsWith('/classes/ChildOverrideDevice/cards') &&
      (requestUrl.searchParams.get('filter') || '').includes('"attribute":"sn"');
  }), true);
});

test('resolveDrafts protects inherited attribute traversal from superclass cycles', async () => {
  const result = await resolveDrafts([{ sn: 'SN-LOOP' }], 'auth-cycle-sn', mergeLabelConfig(), {
    classRootPath: '/classes/ZabbixMonitoring',
    cmdbuildRequest: inheritedAttributesCmdbuildRequest
  });

  assert.equal(result.ok, true);
  assert.equal(result.devices[0]._sourceClass, 'LoopDevice');
  assert.equal(result.devices[0].sn, 'SN-LOOP');
});

test('resolveDrafts keeps direct parent attributes above distant ancestors', async () => {
  const calls = [];
  const result = await resolveDrafts([{ sn: 'SN-ORDER' }], 'auth-ordered-ancestors', mergeLabelConfig(), {
    classRootPath: '/classes/ZabbixMonitoring',
    cmdbuildRequest: recordingCmdbuildRequest(calls, inheritedAttributesCmdbuildRequest)
  });

  assert.equal(result.ok, true);
  assert.equal(result.devices[0]._sourceClass, 'OrderedChildDevice');
  assert.equal(result.devices[0].sn, 'SN-ORDER');
  assert.equal(calls.some((pathname) => {
    const requestUrl = new URL(pathname, 'http://cmdbuild.local');
    return decodeURIComponent(requestUrl.pathname).endsWith('/classes/OrderedChildDevice/cards') &&
      (requestUrl.searchParams.get('filter') || '').includes('"attribute":"sn"');
  }), true);
  assert.equal(calls.some((pathname) => {
    const requestUrl = new URL(pathname, 'http://cmdbuild.local');
    return decodeURIComponent(requestUrl.pathname).endsWith('/classes/OrderedChildDevice/cards') &&
      (requestUrl.searchParams.get('filter') || '').includes('"attribute":"legacySN"');
  }), false);
});

test('resolveDrafts caches missing superclass metadata during catalog discovery', async () => {
  const calls = [];
  const result = await resolveDrafts([{ sn: 'SN-MISSING-PARENT' }], 'auth-missing-parent-cache', mergeLabelConfig(), {
    classRootPath: '/classes/ZabbixMonitoring',
    cmdbuildRequest: recordingCmdbuildRequest(calls, inheritedAttributesCmdbuildRequest)
  });

  assert.equal(result.ok, true);
  assert.equal(result.devices[0]._sourceClass, 'MissingParentChildA');
  assert.equal(calls.filter((pathname) => decodeURIComponent(new URL(pathname, 'http://cmdbuild.local').pathname).endsWith('/classes/MissingParent')).length, 1);
});

async function fakeCmdbuildRequest(pathname) {
  return fakeCmdbuildRequestWithCalls(pathname);
}

function recordingCmdbuildRequest(calls, handler = fakeCmdbuildRequestWithCalls) {
  return async (pathname) => {
    calls.push(pathname);
    return handler(pathname);
  };
}

async function fakeCmdbuildRequestWithCalls(pathname) {
  const requestUrl = new URL(pathname, 'http://cmdbuild.local');
  const decodedPath = decodeURIComponent(requestUrl.pathname);

  if (decodedPath === '/cmdbuild/services/rest/v3/classes') {
    return ok({
      data: [
        { name: 'ZabbixMonitoring', description: 'Zabbix Monitoring', active: true, prototype: true },
        ...Object.keys(fixtures).map((name) => ({
          name,
          description: name,
          active: true,
          parent_name: name === 'ExternalAsset' ? '' : 'ZabbixMonitoring'
        }))
      ]
    });
  }

  const classMatch = decodedPath.match(/^\/cmdbuild\/services\/rest\/v3\/classes\/([^/]+)$/);
  if (classMatch) {
    const className = classMatch[1];
    if (className === 'ZabbixMonitoring') {
      return ok({ data: { name: 'ZabbixMonitoring', description: 'Zabbix Monitoring', active: true, prototype: true } });
    }
    return fixtures[className] ? ok({ data: { name: className, description: className, active: true } }) : notFound();
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
    const parsedFilter = filter ? JSON.parse(filter) : null;
    const searchedAttribute = parsedFilter && parsedFilter.attribute && parsedFilter.attribute.simple && parsedFilter.attribute.simple.attribute;
    const searchedValues = parsedFilter && parsedFilter.attribute && parsedFilter.attribute.simple && parsedFilter.attribute.simple.value;
    const searchedValue = Array.isArray(searchedValues) ? searchedValues[0] : '';
    const matchesSerial = fixture && searchedAttribute && searchedValue === fixture.serial && ['serialnum', 'SerialNumber'].includes(searchedAttribute);
    const matchesInventory = fixture && fixture.inventory && searchedValue === fixture.inventory && searchedAttribute === 'InventoryId';
    return ok({ data: matchesSerial || matchesInventory ? [fixture.card] : [] });
  }

  const lookupMatch = decodedPath.match(/^\/cmdbuild\/services\/rest\/v3\/lookup_types\/([^/]+)\/values$/);
  if (lookupMatch) {
    return ok({ data: lookupValues[lookupMatch[1]] || [] });
  }

  return notFound();
}

async function rootEndpointCmdbuildRequest(pathname) {
  const requestUrl = new URL(pathname, 'http://cmdbuild.local');
  const decodedPath = decodeURIComponent(requestUrl.pathname);

  if (decodedPath === '/cmdbuild/services/rest/v3/classes') {
    return ok({
      data: [
        { name: 'MetadataAsset', description: 'MetadataAsset', active: true, parent_name: 'ZabbixMonitoring' },
        { name: 'ExternalAsset', description: 'ExternalAsset', active: true }
      ]
    });
  }

  return fakeCmdbuildRequestWithCalls(pathname);
}

async function splitRootCmdbuildRequest(pathname) {
  const requestUrl = new URL(pathname, 'http://cmdbuild.local');
  const decodedPath = decodeURIComponent(requestUrl.pathname);

  if (decodedPath === '/cmdbuild/services/rest/v3/classes') {
    return ok({
      data: [
        { name: 'RootA', active: true },
        { name: 'AssetA', active: true, parent_name: 'RootA' },
        { name: 'RootB', active: true },
        { name: 'AssetB', active: true, parent_name: 'RootB' }
      ]
    });
  }

  const classMatch = decodedPath.match(/^\/cmdbuild\/services\/rest\/v3\/classes\/([^/]+)$/);
  if (classMatch) return ok({ data: { name: classMatch[1], active: true } });

  const attributesMatch = decodedPath.match(/^\/cmdbuild\/services\/rest\/v3\/classes\/([^/]+)\/attributes$/);
  if (attributesMatch && ['AssetA', 'AssetB'].includes(attributesMatch[1])) {
    return ok({
      data: [
        { name: 'Code', description: 'Инв. номер', type: 'string' },
        { name: 'serialnum', description: 'Серийный номер', type: 'string' },
        { name: 'model', description: 'Модель', type: 'lookup', lookupType: 'ModelMeta' }
      ]
    });
  }

  const cardsMatch = decodedPath.match(/^\/cmdbuild\/services\/rest\/v3\/classes\/([^/]+)\/cards$/);
  if (cardsMatch) {
    const className = cardsMatch[1];
    const serial = className === 'AssetA' ? 'SN-A' : className === 'AssetB' ? 'SN-B' : '';
    const filter = requestUrl.searchParams.get('filter') || '';
    return ok({
      data: filter.includes(serial)
        ? [{ _id: className, Code: `INV-${className}`, serialnum: serial, model: 101, _model_description: 'HP 1111' }]
        : []
    });
  }

  return fakeCmdbuildRequestWithCalls(pathname);
}

async function inheritedAttributesCmdbuildRequest(pathname) {
  const requestUrl = new URL(pathname, 'http://cmdbuild.local');
  const decodedPath = decodeURIComponent(requestUrl.pathname);

  if (decodedPath === '/cmdbuild/services/rest/v3/classes') {
    return ok({
      data: [
        { name: 'ZabbixMonitoring', active: true, prototype: true },
        { name: 'BaseDevice', active: true, parent_name: 'ZabbixMonitoring' },
        { name: 'CustomerDevice', active: true, parent_name: 'BaseDevice', superclass: 'BaseDevice' },
        { name: 'DetailOnlyChildDevice', active: true },
        { name: 'DescriptionParentChildDevice', active: true, parent: { description: 'Zabbix Monitoring' } },
        { name: 'ChildOverrideDevice', active: true, parent_name: 'BaseDevice', superclass: 'BaseDevice' },
        { name: 'RootSerialDevice', active: true, parent_name: 'ZabbixMonitoring' },
        { name: 'ParentSerialDevice', active: true, parent_name: 'RootSerialDevice' },
        { name: 'OrderedChildDevice', active: true, parent_name: 'ParentSerialDevice', ancestors: [{ name: 'ZabbixMonitoring' }, { name: 'RootSerialDevice' }, { name: 'ParentSerialDevice' }] },
        { name: 'MissingParentChildA', active: true, parent_name: 'ZabbixMonitoring', superclass: 'MissingParent' },
        { name: 'MissingParentChildB', active: true, parent_name: 'ZabbixMonitoring', superclass: 'MissingParent' },
        { name: 'LoopBase', active: true, parent_name: 'ZabbixMonitoring', superclass: 'LoopDevice' },
        { name: 'LoopDevice', active: true, parent_name: 'LoopBase', superclass: 'LoopBase' }
      ]
    });
  }

  const classMatch = decodedPath.match(/^\/cmdbuild\/services\/rest\/v3\/classes\/([^/]+)$/);
  if (classMatch && classMatch[1] === 'DetailOnlyChildDevice') {
    return ok({ data: { name: 'DetailOnlyChildDevice', active: true, parent_name: 'BaseDevice', superclass: 'BaseDevice' } });
  }
  if (classMatch && classMatch[1] === 'DescriptionParentChildDevice') {
    return ok({ data: { name: 'DescriptionParentChildDevice', active: true, parent_name: 'BaseDevice', superclass: 'BaseDevice' } });
  }
  if (classMatch) return ok({ data: { name: classMatch[1], active: true } });

  const attributesMatch = decodedPath.match(/^\/cmdbuild\/services\/rest\/v3\/classes\/([^/]+)\/attributes$/);
  if (attributesMatch) {
    const attributesByClass = {
      ZabbixMonitoring: [],
      BaseDevice: [
        { name: 'sn', description: 'Серийный номер', type: 'string', active: true }
      ],
      CustomerDevice: [
        { name: 'Code', description: 'Инв. номер', type: 'string', active: true },
        { name: 'brlSN', description: 'Серийный номер', type: 'string', active: false },
        { name: 'model', description: 'Модель', type: 'lookup', lookupType: 'ModelMeta', active: true }
      ],
      DetailOnlyChildDevice: [
        { name: 'Code', description: 'Инв. номер', type: 'string', active: true },
        { name: 'model', description: 'Модель', type: 'lookup', lookupType: 'ModelMeta', active: true }
      ],
      DescriptionParentChildDevice: [
        { name: 'Code', description: 'Инв. номер', type: 'string', active: true },
        { name: 'model', description: 'Модель', type: 'lookup', lookupType: 'ModelMeta', active: true }
      ],
      ChildOverrideDevice: [
        { name: 'Code', description: 'Инв. номер', type: 'string', active: true },
        { name: 'sn', description: 'Customer serial number', type: 'string', active: true },
        { name: 'model', description: 'Модель', type: 'lookup', lookupType: 'ModelMeta', active: true }
      ],
      RootSerialDevice: [
        { name: 'legacySN', description: 'Серийный номер', type: 'string', active: true }
      ],
      ParentSerialDevice: [
        { name: 'sn', description: 'Серийный номер', type: 'string', active: true }
      ],
      OrderedChildDevice: [
        { name: 'Code', description: 'Инв. номер', type: 'string', active: true },
        { name: 'model', description: 'Модель', type: 'lookup', lookupType: 'ModelMeta', active: true }
      ],
      MissingParentChildA: [
        { name: 'Code', description: 'Инв. номер', type: 'string', active: true },
        { name: 'sn', description: 'Серийный номер', type: 'string', active: true },
        { name: 'model', description: 'Модель', type: 'lookup', lookupType: 'ModelMeta', active: true }
      ],
      MissingParentChildB: [
        { name: 'Code', description: 'Инв. номер', type: 'string', active: true },
        { name: 'sn', description: 'Серийный номер', type: 'string', active: true },
        { name: 'model', description: 'Модель', type: 'lookup', lookupType: 'ModelMeta', active: true }
      ],
      LoopBase: [
        { name: 'sn', description: 'Серийный номер', type: 'string', active: true }
      ],
      LoopDevice: [
        { name: 'Code', description: 'Инв. номер', type: 'string', active: true },
        { name: 'model', description: 'Модель', type: 'lookup', lookupType: 'ModelMeta', active: true }
      ]
    };
    return ok({ data: attributesByClass[attributesMatch[1]] || [] });
  }

  const cardsMatch = decodedPath.match(/^\/cmdbuild\/services\/rest\/v3\/classes\/([^/]+)\/cards$/);
  if (cardsMatch) {
    const className = cardsMatch[1];
    const filter = requestUrl.searchParams.get('filter') || '';
    const parsedFilter = filter ? JSON.parse(filter) : null;
    const searchedAttribute = parsedFilter && parsedFilter.attribute && parsedFilter.attribute.simple && parsedFilter.attribute.simple.attribute;
    const searchedValues = parsedFilter && parsedFilter.attribute && parsedFilter.attribute.simple && parsedFilter.attribute.simple.value;
    const searchedValue = Array.isArray(searchedValues) ? searchedValues[0] : '';
    if (className === 'CustomerDevice' && searchedAttribute === 'sn' && searchedValue === 'SN-INHERITED') {
      return ok({ data: [{ _id: 201, Code: 'INV-INHERITED', sn: 'SN-INHERITED', model: 101, _model_description: 'HP 1111' }] });
    }
    if (className === 'DetailOnlyChildDevice' && searchedAttribute === 'sn' && searchedValue === 'SN-DETAIL') {
      return ok({ data: [{ _id: 206, Code: 'INV-DETAIL', sn: 'SN-DETAIL', model: 101, _model_description: 'HP 1111' }] });
    }
    if (className === 'DescriptionParentChildDevice' && searchedAttribute === 'sn' && searchedValue === 'SN-DESCRIPTION-PARENT') {
      return ok({ data: [{ _id: 207, Code: 'INV-DESCRIPTION-PARENT', sn: 'SN-DESCRIPTION-PARENT', model: 101, _model_description: 'HP 1111' }] });
    }
    if (className === 'ChildOverrideDevice' && searchedAttribute === 'sn' && searchedValue === 'SN-CHILD') {
      return ok({ data: [{ _id: 202, Code: 'INV-CHILD', sn: 'SN-CHILD', model: 101, _model_description: 'HP 1111' }] });
    }
    if (className === 'OrderedChildDevice' && searchedAttribute === 'sn' && searchedValue === 'SN-ORDER') {
      return ok({ data: [{ _id: 203, Code: 'INV-ORDER', sn: 'SN-ORDER', model: 101, _model_description: 'HP 1111' }] });
    }
    if (className === 'MissingParentChildA' && searchedAttribute === 'sn' && searchedValue === 'SN-MISSING-PARENT') {
      return ok({ data: [{ _id: 204, Code: 'INV-MISSING-A', sn: 'SN-MISSING-PARENT', model: 101, _model_description: 'HP 1111' }] });
    }
    if (className === 'LoopDevice' && searchedAttribute === 'sn' && searchedValue === 'SN-LOOP') {
      return ok({ data: [{ _id: 205, Code: 'INV-LOOP', sn: 'SN-LOOP', model: 101, _model_description: 'HP 1111' }] });
    }
    return ok({ data: [] });
  }

  const lookupMatch = decodedPath.match(/^\/cmdbuild\/services\/rest\/v3\/lookup_types\/([^/]+)\/values$/);
  if (lookupMatch) {
    return ok({ data: lookupValues[lookupMatch[1]] || [] });
  }

  return notFound();
}

async function largeCatalogCmdbuildRequest(pathname) {
  const requestUrl = new URL(pathname, 'http://cmdbuild.local');
  const decodedPath = decodeURIComponent(requestUrl.pathname);

  if (decodedPath === '/cmdbuild/services/rest/v3/classes') {
    return ok({
      data: [
        { name: 'ZabbixMonitoring', active: true, prototype: true },
        ...Array.from({ length: 400 }, (_, index) => ({
          name: `LargeDevice${index + 1}`,
          active: true,
          parent_name: 'ZabbixMonitoring'
        }))
      ]
    });
  }

  const classMatch = decodedPath.match(/^\/cmdbuild\/services\/rest\/v3\/classes\/([^/]+)$/);
  if (classMatch) return ok({ data: { name: classMatch[1], active: true, parent_name: 'ZabbixMonitoring' } });

  const attributesMatch = decodedPath.match(/^\/cmdbuild\/services\/rest\/v3\/classes\/([^/]+)\/attributes$/);
  if (attributesMatch) {
    const className = attributesMatch[1];
    if (!className.startsWith('LargeDevice')) return ok({ data: [] });
    return ok({
      data: [
        { name: 'Code', description: 'Инв. номер', type: 'string', active: true },
        { name: 'sn', description: 'Серийный номер', type: 'string', active: true },
        { name: 'model', description: 'Модель', type: 'lookup', lookupType: 'ModelMeta', active: true }
      ]
    });
  }

  const cardsMatch = decodedPath.match(/^\/cmdbuild\/services\/rest\/v3\/classes\/([^/]+)\/cards$/);
  if (cardsMatch) {
    const className = cardsMatch[1];
    const filter = requestUrl.searchParams.get('filter') || '';
    const parsedFilter = filter ? JSON.parse(filter) : null;
    const searchedAttribute = parsedFilter && parsedFilter.attribute && parsedFilter.attribute.simple && parsedFilter.attribute.simple.attribute;
    const searchedValues = parsedFilter && parsedFilter.attribute && parsedFilter.attribute.simple && parsedFilter.attribute.simple.value;
    const searchedValue = Array.isArray(searchedValues) ? searchedValues[0] : '';
    if (className === 'LargeDevice120' && searchedAttribute === 'sn' && searchedValue === 'SN-LARGE-120') {
      return ok({ data: [{ _id: 120, Code: 'INV-LARGE-120', sn: 'SN-LARGE-120', model: 101, _model_description: 'HP 1111' }] });
    }
    return ok({ data: [] });
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
