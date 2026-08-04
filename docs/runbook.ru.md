# Runbook cmdb2label

Не помещайте live cookies, CMDBuild tokens, CSRF tokens и raw payload карточек CMDBuild в tickets, логи или документацию.

## Health

```bash
curl -fsS http://127.0.0.1:8094/health/live
curl -i http://127.0.0.1:8094/health/ready
curl -fsS http://127.0.0.1:8094/about
curl -i http://127.0.0.1:8094/cmdbuild/custom-api/labels/health/live
curl -i http://127.0.0.1:8094/cmdbuild/custom-api/labels/health/ready
curl -fsS http://127.0.0.1:8094/cmdbuild/custom-api/labels/about
```

- `/health/live` проверяет, что Node process отвечает на HTTP.
- `/health/ready` проверяет runtime config и доступность CMDBuild upstream.
- `/about` и `/cmdbuild/custom-api/labels/about` отдают safe build identity: `VERSION`, full Git revision, source state и SHA256 runtime artifact.
- `503` на readiness при невалидном config или недоступном CMDBuild является корректным fail-closed состоянием.

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

Syslog является опциональной app-level возможностью. Если используется `CMDB_LABELS_LOG_TARGET=stdout`, внешний operational sink должен быть обеспечен deployment/platform слоем: Docker logging driver, syslog/Fluent Bit/Filebeat sidecar, collector/agent, ELK/OpenSearch pipeline или аналог.

Если используется `CMDB_LABELS_LOG_TARGET=stdout,syslog`, backend валидирует `CMDB_LABELS_SYSLOG_HOST`, `CMDB_LABELS_SYSLOG_PORT`, `CMDB_LABELS_SYSLOG_PROTOCOL` и `CMDB_LABELS_SYSLOG_FACILITY` на старте и в readiness.

Статус логирования:

```bash
curl -i \
  -H 'Cookie: CMDBuild-Authorization=<session>' \
  http://127.0.0.1:8094/cmdbuild/custom-api/labels/logging/status
```

Endpoint проверяет живую CMDBuild session cookie. Без cookie или с истекшей сессией ответ должен быть `401`.

## Версия UI

В правом нижнем углу UI отображается версия приложения.

- Source of truth: root `VERSION`.
- Формат файла: `XX.YY.ZZ.NN` плюс trailing newline.
- Если `VERSION` отсутствует до первого explicit git handoff, UI показывает fallback `0.0.0.0`.
- Не создавайте `VERSION` вручную для локального запуска; файл обновляется в handoff/release workflow вместе с Git tag.
- Runtime не берет версию из `package.json`, branch name или Git metadata.
- Docker image должен включать тот же root `VERSION`; иначе контейнер покажет fallback или старую версию.
- Raw `docker build` считается `unverified-local`. Для customer delivery используйте canonical helper, который проверяет tracked clean source, OCI labels, `/app/VERSION` и SHA256 `cmdb2label.html`.

Рекомендуемая сборка customer image из release tag:

```bash
git clone ssh://git@github.com/igorlyapin-max/cmdb2label.git
cd cmdb2label
git fetch --tags
git checkout v00.00.00.04

npm run build:image -- \
  --verified \
  --tag ghcr.io/igorlyapin-max/cmdb2label:00.00.00.04 \
  --tag ghcr.io/igorlyapin-max/cmdb2label:latest
```

`latest` допустим для стенда, но для rollback/audit всегда сохраняйте версионный tag.

Проверка identity после запуска контейнера:

```bash
curl -fsS http://127.0.0.1:8094/about
docker image inspect ghcr.io/igorlyapin-max/cmdb2label:00.00.00.04 \
  --format '{{json .Config.Labels}}'
```

Для delivery image `identity.sourceState` должен быть `verified`, `identity.revision` должен совпадать с release commit, а `identity.runtimeArtifact.matchesExpected` должен быть `true`. `--no-cache` сам по себе не доказывает свежесть source и не заменяет identity check.

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
    "inv": ["InventoryId", "AssetInventoryNumber", "Инвентарный номер"],
    "model": ["ModelName", "Модель", "Тип/Модель"],
    "type": ["Тип", "ModelGroup", "Группа модели"],
    "sn": ["SerialNumber", "FactorySN", "serialnum", "Заводской номер"]
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

`Code` остается fallback-алиасом для `inv`, но business aliases имеют приоритет. Если у заказчика есть отдельный атрибут инвентарного номера, добавьте его в `aliases.inv`; не используйте `Code` как единственный inventory alias, если это технический код карточки.

При copy/paste из UI CMDBuild поле `Тип / Модель` считается display path и разбирается до REST-дозапроса: значение вида `ТД WiFi / HPE Aruba IAP-207` дает `type = "ТД WiFi"` и `model = "HPE Aruba IAP-207"`. Явное поле `Тип` имеет приоритет. Обычное поле `Модель` со slash, например `HP / HP 1111`, не разбирается как display path.

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

## Ограничение области поиска классов

По умолчанию backend строит catalog по всем доступным пользователю CMDBuild classes до лимита `CMDB_LABELS_MAX_CLASSES`. Для customer runtime задайте виртуальный корень поиска:

```bash
CMDB_LABELS_CLASS_ROOT_PATH=/classes/ZabbixMonitoring
```

Формат значения - путь от корня namespace classes, сегменты разделяются `/`: `/classes/<ClassName>` или `/classes/<ParentName>/<ClassName>`. Backend использует последний сегмент как root class name/code и включает root plus descendants по metadata `/classes`: `parent`, `_parent`, `parent_name`, `parentName`, `superclass`, `superClass`, `_superclass`, `ancestors`.

Для текущего стенда используйте `/classes/ZabbixMonitoring`. Если CMDBuild не отдает parent/ancestor metadata в `/classes`, backend сможет выбрать только сам `ZabbixMonitoring`; в этом случае нужные asset classes должны быть видимы как descendants в metadata или root нужно выставить ближе к реальным searchable classes.

REST/search лимиты:

```bash
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
- что `aliases.inv` указывает на бизнес-атрибут инвентарного номера, а не только на технический `Code`;
- что атрибут модели совпадает с aliases для `model` и является lookup с parent lookup, если нужно автоматически заполнить `Тип`;
- `sourceLookupType` и `parentLookupType` в `/etc/cmdb2label/aliases.json`, если CMDBuild не отдает lookup metadata или parent lookup type;
- `CMDB_LABELS_ALIAS_CONFIG_FILE`, если коды атрибутов нестандартные;
- `CMDB_LABELS_CLASS_ROOT_PATH`: root class должен быть видим текущему CMDBuild-пользователю, а нужные классы оборудования должны входить в его subtree;
- лимиты `CMDB_LABELS_MAX_CLASSES`, `CMDB_LABELS_MAX_SEARCH_CLASSES`, `CMDB_LABELS_MAX_REST_CALLS`.

### Readiness `503`

Проверьте `CMDBUILD_ORIGIN` и доступность CMDBuild REST:

```bash
curl -i http://127.0.0.1:8090/cmdbuild/services/rest/v3/sessions/current
```

Любой `4xx` без cookie означает, что upstream доступен и REST endpoint отвечает. Network error или `5xx` означает, что `cmdb2label` не готов.
