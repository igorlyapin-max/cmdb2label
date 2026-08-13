# Архитектурные артефакты cmdb2label

Артефакты подготовлены по стандарту `~/projects/aa.txt`. Исходники ведутся в Markdown/Mermaid/YAML, чтобы их можно было версионировать в git и экспортировать в VSDX/PNG при необходимости.

## Индекс

| Артефакт | Файл |
| --- | --- |
| Описание бизнес-процессов | [business-processes.md](business-processes.md) |
| Информационная модель | [information-model.md](information-model.md) |
| Схема развертывания | [deployment.md](deployment.md) |
| OpenAPI | [openapi.yaml](openapi.yaml) |
| Карта HealthCheck | [healthcheck-map.md](healthcheck-map.md) |
| Карта метрик | [metrics-map.md](metrics-map.md) |
| Карта секретов | [secrets-map.md](secrets-map.md) |
| Карта регистрации событий | [event-logging-map.md](event-logging-map.md) |
| AsyncAPI применимость | [asyncapi-applicability.md](asyncapi-applicability.md) |
| Карта доступов Kafka | [kafka-access-map.md](kafka-access-map.md) |

## Граница системы

`cmdb2label` - Node.js backend и статический UI для генерации печатных этикеток оборудования из данных CMDBuild. CMDBuild остается источником сессий, пользователей, ролей, карточек и справочников. Browser JavaScript не читает `CMDBuild-Authorization`; backend получает cookie server-side и вызывает CMDBuild REST от имени текущего пользователя.

Custom page `CmdbLabels` является тонким launcher'ом. Реальные UI/API принадлежат backend-owned маршрутам `/cmdbuild/labels/*` и `/cmdbuild/custom-api/labels/*`.

## Соглашения

- Информационные потоки имеют вид `IF-XXX` и являются источником ссылок для карт health, metrics, secrets и events.
- Все сетевые соединения указываются с протоколом и портом.
- Реальные cookies, tokens, пароли, customer CA, fingerprints, private keys и raw payload карточек CMDBuild не включаются в артефакты.
- `aa/` фиксирует архитектурный контракт; операционные процедуры и команды остаются в `docs/runbook.ru.md`.
- Kafka/RabbitMQ и прямой SQL-доступ к CMDBuild в текущей версии не используются и зафиксированы как not applicable.
