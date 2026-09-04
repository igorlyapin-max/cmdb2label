# Карта метрик

`cmdb2label` отдает Prometheus text format на `GET /metrics`. Endpoint должен опрашиваться через внутренний или защищенный маршрут и не должен публиковаться как неаутентифицированный internet-facing endpoint.

## Контракт сбора

| Collector | Collection model | Source service | Endpoint / protocol / port | Поток | Cadence | Expected response | Failure semantics | Operational purpose |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Требует согласования` | Prometheus scrape / pull | `cmdb2label backend` | `GET /metrics`, HTTP `8094` или protected platform route, `text/plain; version=0.0.4; charset=utf-8` | `M0` | `Требует согласования` | HTTP `200` и Prometheus text format без business payload | Ошибка scrape означает потерю observability текущего процесса; не должна блокировать пользовательский поток печати | Наблюдение доступности, нагрузки, ошибок backend, обращений к CMDBuild REST и build identity |

## Каталог метрик

| Метрика | Тип | Unit | Поток | Labels | Назначение | Implementation status | Alert rule / dashboard | Чувствительные данные |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `cmdb2label_http_requests_total` | counter | requests | `IF1`, `OAPI0`, `H0`, `M0` | `route`, `status` | Считает завершенные HTTP requests по bounded route class и status class | Implemented | `Требует согласования` | Нет raw path, query, cookies, tokens, payloads |
| `cmdb2label_http_request_duration_seconds` | histogram | seconds | `IF1`, `OAPI0`, `H0`, `M0` | `route`, `status`, `le` | Измеряет длительность HTTP requests по bounded route class и status class | Implemented | `Требует согласования` | Нет raw path, query, cookies, tokens, payloads |
| `cmdb2label_cmdbuild_requests_total` | counter | requests | `OAPI1` | `method`, `status` | Считает прямые consumed CMDBuild REST calls по HTTP method и status class | Implemented | `Требует согласования` | Нет CMDBuild URL query, card payload, session identifiers |
| `cmdb2label_cmdbuild_request_duration_seconds` | histogram | seconds | `OAPI1` | `method`, `status`, `le` | Измеряет длительность прямых consumed CMDBuild REST calls | Implemented | `Требует согласования` | Нет CMDBuild URL query, card payload, session identifiers |
| `cmdb2label_cmdbuild_proxy_requests_total` | counter | requests | Отключенный generic proxy path | `method`, `status` | Считает generic CMDBuild proxy calls, когда proxy явно включен | Implemented, inactive by default | `Требует согласования` | Generic proxy по умолчанию отключен; path/query/payload не пишутся в labels |
| `cmdb2label_cmdbuild_proxy_request_duration_seconds` | histogram | seconds | Отключенный generic proxy path | `method`, `status`, `le` | Измеряет длительность generic CMDBuild proxy calls, когда proxy явно включен | Implemented, inactive by default | `Требует согласования` | Generic proxy по умолчанию отключен; path/query/payload не пишутся в labels |
| `cmdb2label_build_info` | gauge | constant `1` | `M0` | `version`, `revision`, `source_state`, `build_mode` | Публикует safe build identity для сверки версии, revision и provenance | Implemented | `Требует согласования` | Не содержит origin, cookies, tokens, secrets или customer payload |

## Контракт labels

Labels должны быть ограниченными и управляемыми конфигурацией развертывания. Запрещено помещать в labels идентификаторы объектов, имена пользователей, request payloads, тексты ошибок, tokens, динамически обнаруженные значения, инвентарные номера, серийные номера, CMDBuild session identifiers и raw CMDBuild payloads.

## Примечания

- Metrics являются in-memory process counters/histograms и сбрасываются при restart процесса.
- Histogram buckets фиксированы в секундах: `0.005`, `0.01`, `0.025`, `0.05`, `0.1`, `0.25`, `0.5`, `1`, `2.5`, `5`, `10`, `+Inf`.
- Для consumed external HTTP API CMDBuild REST карта покрывает result counter и request-duration histogram через `OAPI1`.
- Kafka/RabbitMQ в проекте не используется, поэтому Kafka connectivity, consumer lag, DLQ depth и oldest unprocessed event metrics неприменимы.
