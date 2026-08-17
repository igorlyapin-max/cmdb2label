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
CMDB_LABELS_LOG_EXTERNAL_SINK=platform
```

Если заказчик переносит настройки из `.env.example` в свой `.env`, для stdout-only режима нужно переносить обе строки: `CMDB_LABELS_LOG_TARGET=stdout` и `CMDB_LABELS_LOG_EXTERNAL_SINK=platform`. Если указать только `CMDB_LABELS_LOG_TARGET=stdout`, production startup завершится ошибкой `external_log_sink_required`.

`CMDB_LABELS_LOG_EXTERNAL_SINK` не включает дополнительный app-level отправитель логов. Это декларация, что внешний operational sink обеспечен deployment/platform слоем: Docker logging driver, syslog/Fluent Bit/Filebeat sidecar, collector/agent, ELK/OpenSearch pipeline или аналог. Допустимые значения: `platform`, `collector`, `sidecar`, `docker-driver`. Базовый Compose не навязывает конкретный Docker logging driver; его выбирает площадка эксплуатации.

Syslog является опциональной app-level возможностью:

```bash
CMDB_LABELS_LOG_TARGET=stdout,syslog
CMDB_LABELS_SYSLOG_HOST=127.0.0.1
CMDB_LABELS_SYSLOG_PORT=514
CMDB_LABELS_SYSLOG_PROTOCOL=udp
CMDB_LABELS_SYSLOG_FACILITY=local0
```

Если используется `CMDB_LABELS_LOG_TARGET=stdout,syslog`, backend валидирует `CMDB_LABELS_SYSLOG_HOST`, `CMDB_LABELS_SYSLOG_PORT`, `CMDB_LABELS_SYSLOG_PROTOCOL` и `CMDB_LABELS_SYSLOG_FACILITY` на старте и в readiness. В этом режиме `CMDB_LABELS_LOG_EXTERNAL_SINK` не требуется, потому что syslog является вторым operational sink.

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
- Если `VERSION` отсутствует до первого explicit git handoff, статический UI показывает fallback `0.0.0.0`, а backend `/about` и `/health/*` используют sentinel `00.00.00.00`.
- Не создавайте `VERSION` вручную для локального запуска; файл обновляется в handoff/release workflow вместе с Git tag.
- Runtime не берет версию из `package.json`, branch name или Git metadata.
- Docker image должен включать тот же root `VERSION`; иначе контейнер покажет fallback или старую версию.
- Plain `docker build` поддержан для ручной customer source build и всегда считается `unverified-local`. Он не требует `npm`, Git metadata или build args на build host, но генерирует `/app/build-identity.json` из переданного Docker build context.
- Для verified customer delivery используйте canonical helper, который проверяет tracked clean source, OCI labels, `/app/VERSION` и SHA256 `cmdb2label.html`.

Рядом с версией отображается footer. По умолчанию:

```html
<div class="page-footer">
  <div class="footer-title">Разработано Департаментом информационных технологий</div>
  <div>Предложения и замечания направлять на почту: <a href="mailto:ritm.all@gkm.ru?subject=Предложения по CMDBuild Label">ritm.all@gkm.ru</a></div>
</div>
```

Настройки footer:

```bash
CMDB_LABELS_FOOTER_ENABLED=true
CMDB_LABELS_FOOTER_TITLE=Разработано Департаментом информационных технологий
CMDB_LABELS_FOOTER_TEXT=Предложения и замечания направлять на почту:
CMDB_LABELS_FOOTER_EMAIL=ritm.all@gkm.ru
CMDB_LABELS_FOOTER_SUBJECT=Предложения по CMDBuild Label
```

Footer hidden при печати. Env-значения передаются как base64url JSON в `data-footer-config` и применяются в браузере через DOM API (`textContent`, `href`, `hidden`); raw HTML в env не поддерживается.

Ручная сборка customer image из release tag:

```bash
git clone ssh://git@github.com/igorlyapin-max/cmdb2label.git
cd cmdb2label
git fetch --tags
git checkout v00.00.00.05

docker build --pull --no-cache \
  -t ghcr.io/igorlyapin-max/cmdb2label:00.00.00.05-local \
  .
```

Проверка manual image:

```bash
docker run --rm ghcr.io/igorlyapin-max/cmdb2label:00.00.00.05-local cat /app/VERSION
docker run -d --rm --name cmdb2label-manual-smoke \
  -p 127.0.0.1:18095:8094 \
  -e CMDB_LABELS_CSRF_SECRET=replace-with-stable-secret \
  ghcr.io/igorlyapin-max/cmdb2label:00.00.00.05-local
curl -fsS http://127.0.0.1:18095/about
docker stop cmdb2label-manual-smoke
```

Для manual image `identity.sourceState` должен быть `unverified-local`, `identity.buildMode` должен быть `manual`, а `identity.runtimeArtifact.matchesExpected` должен быть `true`. Это runnable image для локальной/customer проверки, но не verified release artifact.

Verified сборка release image:

```bash
npm run build:image -- \
  --verified \
  --tag ghcr.io/igorlyapin-max/cmdb2label:00.00.00.05 \
  --tag ghcr.io/igorlyapin-max/cmdb2label:latest
```

`latest` допустим для стенда, но для rollback/audit всегда сохраняйте версионный tag. Runtime compose для customer delivery должен ссылаться на prebuilt `image:`, а не использовать `build:`.

Image-only запуск на customer/admin host:

```bash
cp .env.example .env
editor .env
CMDB2LABEL_IMAGE=ghcr.io/igorlyapin-max/cmdb2label:00.00.00.05 \
CMDB2LABEL_ENV_FILE=.env \
docker compose -f docker-compose.customer.yml up -d
```

Перед запуском замените placeholders в `.env`: `CMDB_LABELS_CSRF_SECRET`, `CMDBUILD_ORIGIN`, logging sink, aliases path и class root. Runtime host не требует `npm` и не выполняет `build:`.

Проверка identity после запуска контейнера:

```bash
curl -fsS http://127.0.0.1:8094/about
docker image inspect ghcr.io/igorlyapin-max/cmdb2label:00.00.00.05 \
  --format '{{json .Config.Labels}}'
```

Для verified delivery image `identity.sourceState` должен быть `verified`, `identity.buildMode` должен быть `canonical`, `identity.revision` должен совпадать с release commit, а `identity.runtimeArtifact.matchesExpected` должен быть `true`. `--no-cache` сам по себе не доказывает свежесть source и не заменяет identity check.

## Customer CA / certificates

Реальные сертификаты заказчика являются deployment artifacts. Не коммитьте `*.crt`, `*.pem`, `*.key`, `*.p12`, customer archives и fingerprint-файлы в public source. В репозитории оставлены видимые contract-файлы `certs/customer-ca/README.ru.md` и `certs/customer-ca/customer-ca.crt.example`; реальный CA должен быть передан отдельно и подготовлен перед build или mount.

Сертификаты нужны только если контур использует private CA для одного из путей:

- private registry или registry mirror;
- `CMDBUILD_ORIGIN=https://...` с корпоративным/private CA;
- reverse proxy или corporate proxy с TLS inspection;
- OS package repositories или корпоративный apt proxy во время Docker build;
- любой internal HTTPS endpoint, к которому обращается контейнер.

Default mode - runtime mount:

```bash
mkdir -p certs/customer-ca
cp /secure/customer/CheckPoint.crt certs/customer-ca/customer-ca.crt
sha256sum certs/customer-ca/customer-ca.crt

CMDB2LABEL_IMAGE=ghcr.io/igorlyapin-max/cmdb2label:00.00.00.05 \
CMDB2LABEL_ENV_FILE=.env \
CMDB_LABELS_CUSTOM_CA_HOST_FILE=./certs/customer-ca/customer-ca.crt \
docker compose \
  -f docker-compose.customer.yml \
  -f docker-compose.customer-ca.yml \
  up -d --force-recreate
```

В `.env` при mount mode:

```bash
CMDB_LABELS_CUSTOM_CA_MODE=mount
CMDB_LABELS_CUSTOM_CA_FILE=/etc/cmdb2label/customer-ca/customer-ca.crt
NODE_EXTRA_CA_CERTS=/etc/cmdb2label/customer-ca/customer-ca.crt
```

Backend валидирует, что файл CA существует и читается. Smoke для TLS выполняйте без `--insecure`; использование `--insecure` скрывает проблему trust store и не принимается как delivery evidence.

Embedded mode допускается только для customer-specific immutable image. В этом режиме Dockerfile копирует `certs/customer-ca` и подключает реальный `*.crt`/`*.pem` сразу после `FROM`, до первого `apt-get update`. Это нужно, если private CA используется не только приложением, но и OS package repositories или корпоративным proxy во время build. Подготовьте CA:

```bash
node scripts/prepare-customer-ca.mjs --source /secure/customer/CheckPoint.crt
```

APT sources берутся из `apt/debian.sources` внутри build context. Если этот файл не заменить перед build, используется стандартный Debian repo (`deb.debian.org`). Для внутреннего mirror/proxy положите файл в проект перед build:

```bash
mkdir -p apt
cp /etc/apt/debian.sources apt/debian.sources
docker build -t cmdb2label .
```

`COPY apt/debian.sources /etc/apt/sources.list.d/debian.sources` копирует именно `./apt/debian.sources` из проекта, а не файл из host `/etc/apt` напрямую. Не добавляйте credentials в committed APT sources; auth для proxy должен решаться инфраструктурно.

Затем соберите image в fail-closed режиме:

```bash
docker build \
  --build-arg CMDB_LABELS_EMBED_CUSTOM_CA=required \
  -t ghcr.io/igorlyapin-max/cmdb2label:00.00.00.05-customer-ca \
  .
```

Если `CMDB_LABELS_EMBED_CUSTOM_CA=required`, но в `certs/customer-ca/` нет реального `*.crt` или `*.pem`, Docker build должен завершиться ошибкой. Placeholder `*.example` не считается сертификатом. После rotation сертификата пересоберите image, проверьте fingerprint и `/about` identity.

Registry trust настраивается на Docker host отдельно от приложения. Для private registry администратор должен настроить `docker login`, corporate CA для Docker daemon или registry mirror согласно политике площадки, затем проверить:

```bash
docker pull ghcr.io/igorlyapin-max/cmdb2label:00.00.00.05
docker image inspect ghcr.io/igorlyapin-max/cmdb2label:00.00.00.05 \
  --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.version"}}'
```

DNS/proxy/firewall prerequisites:

- runtime host должен резолвить и достигать `CMDBUILD_ORIGIN`;
- backend port `8094` публикуется только на loopback/internal interface, если shared nginx обслуживает user-facing `/cmdbuild/*`;
- shared nginx должен проксировать только `/cmdbuild/labels/*` и `/cmdbuild/custom-api/labels/*` в `cmdb2label`;
- `/metrics` не публикуется наружу без отдельной защиты.

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

CSV с одной колонкой:

- заголовок `SN` или `Серийный номер` означает список серийных номеров;
- заголовок `Инв. номер` или `Инвентарный номер` означает список инвентарных номеров;
- если заголовка нет или он не распознан, UI передает значение как внутренний `lookupKey`; backend ищет карточку сначала по `SN`, затем по `Инв. номер`;
- `lookupKey` не печатается и не подставляется в `Инв. номер` без найденной карточки CMDBuild.

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
