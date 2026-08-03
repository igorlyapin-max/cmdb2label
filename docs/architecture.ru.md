# Архитектура cmdb2label

## Схема

```text
Browser -> CMDBuild UI custom page CmdbLabels
Browser -> /cmdbuild/* through existing cmdbcustompages proxy
Browser -> /cmdbuild/labels/ui
UI      -> /cmdbuild/custom-api/labels/*
Backend -> /cmdbuild/services/rest/v3/* on CMDBUILD_ORIGIN
```

Custom page содержит только launcher `src/CmdbLabels.js` и редиректит пользователя на backend-owned UI route.

В совместном dev/reverse-proxy режиме общий `/cmdbuild/` остается за существующим proxy `cmdbcustompages`. `cmdb2label` получает только backend-owned routes `/cmdbuild/labels/*` и `/cmdbuild/custom-api/labels/*`, поэтому не перехватывает CMDBuild UI и dynamicpages routes соседнего проекта.

Generic proxy `/cmdbuild/*` внутри `cmdb2label` по умолчанию выключен. Он не нужен для штатной схемы, где основной CMDBuild UI обслуживает существующий reverse proxy.

## Auth model

CMDBuild остается источником сессии, пользователя, ролей и прав на бизнес-объекты.

- Browser автоматически отправляет `CMDBuild-Authorization` cookie на same-origin маршруты.
- Browser JavaScript не читает cookie и не пересылает ее вручную.
- Backend извлекает cookie server-side и вызывает CMDBuild REST с header `CMDBuild-Authorization`.
- Если CMDBuild возвращает меньше классов, атрибутов или карточек из-за прав пользователя, это считается нормальной permission semantics.

Прямой SQL-доступ к базе CMDBuild в v1 не используется.

## Public routes

```text
GET  /cmdbuild/labels/ui
GET  /cmdbuild/custom-api/labels/session
GET  /cmdbuild/custom-api/labels/csrf
POST /cmdbuild/custom-api/labels/resolve
GET  /cmdbuild/custom-api/labels/logging/status
GET  /cmdbuild/custom-api/labels/health/live
GET  /cmdbuild/custom-api/labels/health/ready
GET  /health/live
GET  /health/ready
GET  /metrics
```

`/metrics` является operational endpoint backend process. В shared nginx его не нужно публиковать наружу; scrape выполняйте напрямую с `127.0.0.1:8094` или через отдельный защищенный internal route.

`POST /resolve` принимает черновики карточек оборудования и возвращает нормализованные строки этикеток:

```json
{
  "devices": [
    {
      "sn": "C2M-CITY-20260523-SN-300"
    }
  ]
}
```

Ответ:

```json
{
  "ok": true,
  "devices": [
    {
      "inv": "Принтер-001",
      "model": "HP LaserJet",
      "type": "HP",
      "sn": "C2M-CITY-20260523-SN-300"
    }
  ],
  "errors": [],
  "meta": {
    "inputCount": 1,
    "outputCount": 1,
    "cmdbuildRestCalls": 12
  }
}
```

## CMDBuild discovery

Backend строит каталог доступных классов автоматически:

- читает `/classes`;
- если задан `CMDB_LABELS_CLASS_ROOT_PATH`, ограничивает список root class и его descendants до чтения атрибутов;
- для каждого доступного класса читает `/attributes`;
- выбирает классы, где найдены алиасы `inv` или `sn`;
- ищет карточки по `inv` и `sn`;
- поле `type` на этикетке означает `Тип`; по умолчанию оно выводится из parent lookup значения атрибута, mapped как `model`;
- если CMDBuild filter отличается в конкретной версии, использует ограниченный fallback чтения карточек класса.

Каталог кэшируется per session/config hash, потому что разные пользователи и alias/derived настройки могут видеть разные классы и атрибуты.

`CMDB_LABELS_CLASS_ROOT_PATH` задается как путь от корня namespace classes, например `/classes/ZabbixMonitoring`. Backend использует последний сегмент как root class name/code и включает descendants по metadata `/classes`: `parent`, `_parent`, `parent_name`, `parentName`, `superclass`, `superClass`, `_superclass`, `ancestors`. Если CMDBuild не отдает связь классов в metadata, будет выбран только сам root class.

## Runtime controls

Основные env vars:

```text
CMDB_LABELS_HOST=127.0.0.1
CMDB_LABELS_PORT=8094
CMDBUILD_ORIGIN=http://127.0.0.1:8090
CMDB_LABELS_CSRF_SECRET=<required-in-production>
CMDB_LABELS_DIAGNOSTIC_MODE=off|Basic|Verbose
CMDB_LABELS_LOG_TARGET=stdout|stdout,syslog
CMDB_LABELS_SYSLOG_HOST=127.0.0.1
CMDB_LABELS_SYSLOG_PORT=514
CMDB_LABELS_REQUEST_TIMEOUT_MS=10000
CMDB_LABELS_HEALTH_TIMEOUT_MS=2000
CMDB_LABELS_CATALOG_TTL_MS=300000
CMDB_LABELS_MAX_CLASSES=400
CMDB_LABELS_MAX_SEARCH_CLASSES=160
CMDB_LABELS_MAX_REST_CALLS=610
CMDB_LABELS_MAX_RESOLVE_DEVICES=100
CMDB_LABELS_MAX_MATCHES=50
CMDB_LABELS_CARD_SEARCH_LIMIT=20
CMDB_LABELS_CARD_FALLBACK_LIMIT=100
CMDB_LABELS_BODY_LIMIT_BYTES=524288
CMDB_LABELS_CLASS_ROOT_PATH=/classes/ZabbixMonitoring
CMDB_LABELS_ENABLE_CMDBUILD_PROXY=false
CMDB_LABELS_ALIAS_CONFIG_FILE=/run/config/cmdb2label-aliases.json
```

Версия, видимая в правом нижнем углу UI, читается только из root `VERSION` в формате `XX.YY.ZZ.NN`. До первого explicit git handoff файл может отсутствовать; в этом случае UI показывает нейтральный fallback `0.0.0.0`. Версия не вычисляется из `package.json`, branch name или Git metadata.

`stdout`/`stderr` обязательны всегда. App-level syslog включается опционально через `CMDB_LABELS_LOG_TARGET=stdout,syslog`; при `CMDB_LABELS_LOG_TARGET=stdout` внешний operational sink должен быть обеспечен deployment/platform слоем, например Docker logging driver, sidecar/agent или централизованный collector.

Пример alias/derive config:

```json
{
  "aliases": {
    "inv": ["InventoryId", "AssetInventoryNumber", "Инвентарный номер"],
    "model": ["ModelName", "Модель", "model"],
    "type": ["Тип", "Группа модели", "Производитель"],
    "sn": ["serialnum", "SerialNumber", "FactorySN", "Заводской номер"]
  },
  "derivedFields": {
    "typeFromModelLookupParent": {
      "enabled": true,
      "modelField": "model",
      "typeField": "type",
      "sourceLookupType": "Model",
      "parentLookupType": "ModelGroup"
    }
  }
}
```

Config validation выполняется на старте и в readiness path. Некорректный JSON, нечитаемый файл, alias entry не массивом или `derivedFields.typeFromModelLookupParent.typeField` не равный `"type"` считаются ошибкой конфигурации. Legacy keys `aliases.cls`, `derivedFields.groupFromLookupParent`, `sourceField` и `targetField` принимаются только как migration path и дают warning.

Backend выбирает CMDBuild attributes по alias priority, а не по порядку `/attributes`. Business aliases инвентарного номера (`Инвентарный номер`, `InventoryId`, `AssetInventoryNumber`) приоритетнее технического `Code`; `Code` используется только как fallback, когда другого совпадения нет.

Lookup derivation читает parent lookup модели. Если CMDBuild metadata атрибута модели отдает `lookupType`, `sourceLookupType` можно не задавать. Если parent id приходит как scalar `parent`, задайте `parentLookupType`, чтобы backend резолвил тип по lookup values.

`Verbose` diagnostics включается только временно. Cookie, auth headers, CSRF token, raw CMDBuild payloads и строки результата не пишутся в логи.
