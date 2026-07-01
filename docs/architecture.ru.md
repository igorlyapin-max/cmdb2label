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
      "cls": "HP",
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
- для каждого доступного класса читает `/attributes`;
- выбирает классы, где найдены алиасы `inv` или `sn`;
- ищет карточки по `inv` и `sn`;
- поле `cls` на этикетке означает `Группа модели`; по умолчанию оно выводится из parent lookup значения атрибута, mapped как `model`;
- если CMDBuild filter отличается в конкретной версии, использует ограниченный fallback чтения карточек класса.

Каталог кэшируется per session/config hash, потому что разные пользователи и alias/derived настройки могут видеть разные классы и атрибуты.

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
CMDB_LABELS_MAX_RESOLVE_DEVICES=100
CMDB_LABELS_ENABLE_CMDBUILD_PROXY=false
CMDB_LABELS_ALIAS_CONFIG_FILE=/run/config/cmdb2label-aliases.json
```

В `NODE_ENV=production` кроме `stdout` должен быть задан дополнительный operational sink, например `CMDB_LABELS_LOG_TARGET=stdout,syslog`.

Пример alias/derive config:

```json
{
  "aliases": {
    "inv": ["Code", "invnet"],
    "model": ["Модель", "model"],
    "cls": ["Группа модели", "Производитель"],
    "sn": ["serialnum", "SerialNumber"]
  },
  "derivedFields": {
    "groupFromLookupParent": {
      "enabled": true,
      "sourceField": "model",
      "targetField": "cls"
    }
  }
}
```

`Verbose` diagnostics включается только временно. Cookie, auth headers, CSRF token, raw CMDBuild payloads и строки результата не пишутся в логи.
