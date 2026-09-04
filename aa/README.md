# Архитектурные артефакты cmdb2label

Артефакты подготовлены по стандарту `~/projects/aa.txt`. Исходники ведутся в Markdown/Mermaid/YAML, чтобы их можно было версионировать в git и экспортировать в VSDX/PNG при необходимости.

## Индекс

| Артефакт | Файл |
| --- | --- |
| Описание бизнес-процессов | [business-processes.md](business-processes.md) |
| Информационная модель | [information-model.md](information-model.md) |
| Схема развертывания | [deployment.md](deployment.md) |
| OpenAPI публичного API cmdb2label | [openapi.yaml](openapi.yaml) |
| OpenAPI используемых CMDBuild endpoint | [openapi/cmdbuild-consumed.openapi.yaml](openapi/cmdbuild-consumed.openapi.yaml) |
| Карта HealthCheck | [healthcheck-map.md](healthcheck-map.md) |
| Карта метрик | [metrics-map.md](metrics-map.md) |
| Карта секретов | [secrets-map.md](secrets-map.md) |
| Карта регистрации событий | [event-logging-map.md](event-logging-map.md) |
| AsyncAPI применимость | [asyncapi-applicability.md](asyncapi-applicability.md) |
| Карта доступов Kafka | [kafka-access-map.md](kafka-access-map.md) |

## XLSX delivery maps

Markdown/YAML файлы выше остаются source of truth. XLSX-файлы являются delivery-представлением применимых карт и сформированы из canonical templates `${AA_XLSX_TEMPLATE_DIR:-$HOME/projects/files/aa}`.

| Карта | XLSX | Основание применимости |
| --- | --- | --- |
| Карта HealthCheck | [xlsx/healthcheck-map.xlsx](xlsx/healthcheck-map.xlsx) | Есть `/health/live`, `/health/ready`, `/about`, Docker `HEALTHCHECK` и same-origin health aliases |
| Карта метрик | [xlsx/metrics-map.xlsx](xlsx/metrics-map.xlsx) | Есть `GET /metrics` с Prometheus text format |
| Карта регистрации событий | [xlsx/event-logging-map.xlsx](xlsx/event-logging-map.xlsx) | Backend пишет structured JSON events в stdout/stderr и optional syslog |
| Смена секретов | [xlsx/secrets-rotation-map.xlsx](xlsx/secrets-rotation-map.xlsx) | Используются cookie/session, CSRF secret, customer CA, registry/admin credentials и deployment config |

XLSX для Kafka не создается, потому что Kafka/RabbitMQ/async broker exchange не используется; применимость зафиксирована в [kafka-access-map.md](kafka-access-map.md) и [asyncapi-applicability.md](asyncapi-applicability.md). XLSX для file access не создается, потому что network file-share или equivalent file-transfer permission отсутствуют; работа с customer CA описана как certificate artifact в [secrets-map.md](secrets-map.md), а не как файловый обмен между системами.

## Граница системы

`cmdb2label` - Node.js backend и статический UI для генерации печатных этикеток оборудования из данных CMDBuild. CMDBuild остается источником сессий, пользователей, ролей, карточек и справочников. JavaScript в браузере не читает `CMDBuild-Authorization`; backend получает cookie на серверной стороне и вызывает CMDBuild REST от имени текущего пользователя.

Custom page `CmdbLabels` является тонким launcher'ом. Реальные UI/API принадлежат backend-owned маршрутам `/cmdbuild/labels/*` и `/cmdbuild/custom-api/labels/*`.

## Соглашения

- Информационные потоки имеют вид `IF-XXX` и являются источником ссылок для карт health, metrics, secrets и events.
- Все сетевые соединения указываются с протоколом и портом.
- Реальные cookies, tokens, пароли, customer CA, fingerprints, private keys и raw payload карточек CMDBuild не включаются в артефакты.
- `aa/openapi.yaml` описывает backend-owned API `cmdb2label`; consumed endpoint внешнего CMDBuild REST описаны отдельно в `aa/openapi/cmdbuild-consumed.openapi.yaml`.
- `aa/` фиксирует архитектурный контракт; операционные процедуры и команды остаются в `docs/runbook.ru.md`.
- Kafka/RabbitMQ и прямой SQL-доступ к CMDBuild в текущей версии не используются и зафиксированы как неприменимые.
