# Runbook cmdb2label

Не помещайте live cookies, CMDBuild tokens, CSRF tokens и raw payload карточек CMDBuild в tickets, логи или документацию.

## Health

```bash
curl -fsS http://127.0.0.1:8094/health/live
curl -i http://127.0.0.1:8094/health/ready
curl -i http://127.0.0.1:8094/cmdbuild/custom-api/labels/health/live
curl -i http://127.0.0.1:8094/cmdbuild/custom-api/labels/health/ready
```

- `/health/live` проверяет, что Node process отвечает на HTTP.
- `/health/ready` проверяет доступность CMDBuild upstream.
- `503` на readiness при недоступном CMDBuild является корректным fail-closed состоянием.

## Diagnostics

Diagnostic mode выключен по умолчанию.

```bash
CMDB_LABELS_DIAGNOSTIC_MODE=Basic npm start
CMDB_LABELS_DIAGNOSTIC_MODE=Verbose npm start
```

`Basic` пишет безопасные события без payload. `Verbose` добавляет sanitized request/upstream details, но не должен использоваться постоянно.

## Logging

Логи структурированные и всегда идут в `stdout`/`stderr`.

```bash
CMDB_LABELS_LOG_TARGET=stdout
CMDB_LABELS_LOG_TARGET=stdout,syslog
CMDB_LABELS_SYSLOG_HOST=127.0.0.1
CMDB_LABELS_SYSLOG_PORT=514
CMDB_LABELS_SYSLOG_PROTOCOL=udp
CMDB_LABELS_SYSLOG_FACILITY=local0
```

В `NODE_ENV=production` используйте `CMDB_LABELS_LOG_TARGET=stdout,syslog` или другой поддержанный дополнительный sink; один `stdout` не проходит startup validation.

Статус логирования:

```bash
curl -i \
  -H 'Cookie: CMDBuild-Authorization=<session>' \
  http://127.0.0.1:8094/cmdbuild/custom-api/labels/logging/status
```

Endpoint проверяет живую CMDBuild session cookie. Без cookie или с истекшей сессией ответ должен быть `401`.

## Metrics

```bash
curl -fsS http://127.0.0.1:8094/metrics
```

В shared nginx не публикуйте `/metrics` как пользовательский route без отдельной защиты. Для мониторинга предпочтителен scrape backend process по loopback или internal network.

## Alias config

Если реальные коды атрибутов отличаются от defaults, добавьте config file:

```json
{
  "aliases": {
    "inv": ["InventoryId", "AssetInventoryNumber", "Code"],
    "model": ["ModelName", "Модель"],
    "type": ["Тип", "ModelGroup", "Группа модели"],
    "sn": ["SerialNumber", "FactorySN", "serialnum"]
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

По умолчанию `type` на этикетке означает `Тип`: backend берет CMDBuild-атрибут, mapped как `model`, читает его lookup value и выводит parent lookup. Если в конкретной модели CMDBuild это поле заполняется вручную из CSV, можно оставить alias для `type`; если нужно отключить derive, задайте `"enabled": false`.

Где править:

- Файл конфигурации: `/etc/cmdb2label/aliases.json`.
- Подключение файла: `CMDB_LABELS_ALIAS_CONFIG_FILE=/etc/cmdb2label/aliases.json`.
- Альтернатива без файла: передать тот же JSON в env `CMDB_LABELS_ALIAS_CONFIG`.

Lookup-настройки:

- `sourceLookupType` - lookup type, где лежат модели. Заполняйте, если CMDBuild metadata атрибута модели не отдает `lookupType`.
- `parentLookupType` - parent lookup type, где лежат типы. Заполняйте, если lookup value модели не отдает `parent_type`.
- `typeField` оставляйте `"type"` или не задавайте: UI и payload этикетки используют только поле `Тип`.

Старые ключи `aliases.cls`, `derivedFields.groupFromLookupParent`, `sourceField` и `targetField` временно принимаются для миграции, но backend пишет startup warning. Новый конфиг должен использовать `aliases.type`, `derivedFields.typeFromModelLookupParent`, `modelField` и `typeField`.

Если JSON в `CMDB_LABELS_ALIAS_CONFIG` или файл из `CMDB_LABELS_ALIAS_CONFIG_FILE` не читается или не проходит schema validation, backend не стартует, а `/health/ready` возвращает `503` без раскрытия внутреннего `CMDBUILD_ORIGIN`.

Запуск:

```bash
CMDB_LABELS_ALIAS_CONFIG_FILE=/etc/cmdb2label/aliases.json npm start
```

## Типовые incidents

### Custom page не появилась в CMDBuild

Проверьте, что ZIP не только собран, но и зарегистрирован:

```bash
npm run build:zip
CMDBUILD_ORIGIN=http://localhost:8088 CMDBUILD_COOKIE_JAR=/tmp/cmdbuild-ui-cookie.txt npm run register:custompage:dry-run
CMDBUILD_ORIGIN=http://localhost:8088 CMDBUILD_COOKIE_JAR=/tmp/cmdbuild-ui-cookie.txt npm run register:custompage
```

Если регистрация прошла успешно, но страница не видна конкретному пользователю, проверьте grants/меню CMDBuild для `CmdbLabels`.

### Custom page открывается пустой

В dev рабочий вход для `cmdb2label` - `http://localhost:8088/cmdbuild/` через существующий nginx `cmdbcustompages`. Прямой `http://localhost:8090/cmdbuild/` является только upstream CMDBuild и не обслуживает `/cmdbuild/labels/ui`.

Сначала проверьте, что CMDBuild UI config остается на reverse proxy origin:

```bash
curl -i http://<host>/cmdbuild/ui/config.js
```

В ответе должны быть URL на `<host>/cmdbuild/services/rest/v3`, а не прямой upstream `127.0.0.1:8090`.

Проверьте, что CMDBuild resource loader отдает launcher через тот же reverse proxy, где открыт browser:

```bash
curl -i http://<host>/cmdbuild/ui/app/view/custompages/CmdbLabels/CmdbLabels.js
```

С авторизованной CMDBuild cookie должен быть `200` и `application/javascript`. Если после логина снова видна форма авторизации, проверьте, что общий `location /cmdbuild/` остается в рабочем `cmdbcustompages` proxy на `8093` и передает `Host $http_host`.

Если `location /cmdbuild/` указывает на `cmdb2label` или порт `8094`, это ошибка wiring: `cmdb2label` должен обслуживать только `/cmdbuild/labels/*` и `/cmdbuild/custom-api/labels/*`.

Если пользователь открывает `http://localhost:8090/cmdbuild/ui/#custompages/CmdbLabels`, это unsupported path для `cmdb2label`: прямой `8090` не обслуживает backend UI/API routes. Нужно открыть `http://localhost:8088/cmdbuild/` и уже там custom page `CmdbLabels`.

### UI открывается, но статус CMDBuild неактивен

Проверьте:

```bash
curl -i http://<host>/cmdbuild/custom-api/labels/session
```

Без browser cookie endpoint вернет `401`. Проверять реальную сессию нужно через browser или cookie jar.

### `/resolve` возвращает `403`

Причины:

- запрос идет не через same-origin nginx;
- отсутствует `Origin` или `Referer`;
- не получен или устарел `X-CMDB2Label-CSRF`.

### Не находятся карточки

Проверьте:

- права текущего пользователя на классы и атрибуты оборудования;
- что в модели есть атрибуты, совпадающие с aliases для `inv` или `sn`;
- что атрибут модели совпадает с aliases для `model` и является lookup с parent lookup, если нужно автоматически заполнить `Тип`;
- `sourceLookupType` и `parentLookupType` в `/etc/cmdb2label/aliases.json`, если CMDBuild не отдает lookup metadata или parent lookup type;
- `CMDB_LABELS_ALIAS_CONFIG_FILE`, если коды атрибутов нестандартные;
- лимиты `CMDB_LABELS_MAX_CLASSES`, `CMDB_LABELS_MAX_SEARCH_CLASSES`, `CMDB_LABELS_MAX_REST_CALLS`.

### Readiness `503`

Проверьте `CMDBUILD_ORIGIN` и доступность CMDBuild REST:

```bash
curl -i http://127.0.0.1:8090/cmdbuild/services/rest/v3/sessions/current
```

Любой `4xx` без cookie означает, что upstream доступен и REST endpoint отвечает. Network error или `5xx` означает, что `cmdb2label` не готов.
